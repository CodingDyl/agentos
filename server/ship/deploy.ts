import { GITHUB_SETUP_HINT, VERCEL_SETUP_HINT, type ShipDeployRequest, type ShipDeployState } from "../../shared/ship-types";
import { headCommit } from "../agentos/git";
import { patchProject } from "../agentos/mutations/projects";
import { authorize } from "../connectors/policy";
import { isVercelConfigured } from "../vercel/client";
import { PREVIEW_BRANCH } from "../website-rebuild/deploy-policy";
import {
  defaultPublishDeps,
  ensureVercelProject,
  findPreviewDeployment,
  PublishError,
  pushRef,
  readDeployment,
  readVercelProject,
  requestPreviewDeployment,
  type GithubRepo,
  type PublishDeps,
  type VercelDeploymentState,
  type VercelProject,
} from "../website-rebuild/publish";
import { ShipError } from "./error";
import { readShipGit, resolveGithubToken } from "./git";
import { assertProductionConfirmed, linkedVercel, type LinkedVercel } from "./production-gate";
import { requireKnownProject, requireShipRoot } from "./root";
import { readShipRecord, rememberDeploy } from "./store";

/**
 * Vercel for Ship: link or create a project, deploy a preview, and — only
 * from the Production button, with the project's name typed back — deploy
 * production.
 *
 * Previews reuse the website rebuild's helpers: the commit is pushed to
 * AgentOS' own `preview` branch, which a Git-linked project builds by itself;
 * a project without a Git link is asked for a preview deployment instead.
 * Production is the one Vercel write the rebuild never makes, so it lives
 * here, behind the Connectors capability `vercel.deploy_production` (an
 * `approval` capability: a person's press is the approval) and the typed
 * confirmation. No code path calls it except the route.
 */

const SETTLED = new Set(["READY", "ERROR", "CANCELED"]);

function requireVercel(): void {
  if (!isVercelConfigured()) throw new ShipError(VERCEL_SETUP_HINT, 409);
}

function asShipError(error: unknown): never {
  if (error instanceof PublishError) throw new ShipError(error.message, 409);
  throw error;
}

export function productionDeploymentBody(
  project: { name: string; id: string },
  repo: { owner: string; name: string },
  branch: string,
  commit: string,
): {
  name: string;
  project: string;
  gitSource: { type: "github"; org: string; repo: string; ref: string; sha: string };
  target: "production";
} {
  return {
    name: project.name,
    project: project.id,
    gitSource: { type: "github", org: repo.owner, repo: repo.name, ref: branch, sha: commit },
    target: "production",
  };
}

/** One production deployment of `commit`. Callers have already checked the confirmation. */
export async function requestProductionDeployment(
  project: LinkedVercel,
  repo: { owner: string; name: string; fullName: string },
  branch: string,
  commit: string,
  deps: PublishDeps = defaultPublishDeps,
): Promise<VercelDeploymentState> {
  const decision = authorize("vercel.deploy_production", { initiator: "person", detail: `Production deploy of ${repo.fullName}@${commit.slice(0, 7)}` });
  if (!decision.allowed) throw new ShipError(decision.reason, 409);
  const token = deps.env().VERCEL_API_TOKEN?.trim();
  if (!token) throw new ShipError(VERCEL_SETUP_HINT, 409);
  const team = deps.env().VERCEL_TEAM_ID?.trim();
  const url = `https://api.vercel.com/v13/deployments${team ? `?teamId=${encodeURIComponent(team)}` : ""}`;

  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "AgentOS" },
      body: JSON.stringify(productionDeploymentBody(project, repo, branch, commit)),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ShipError("Could not reach Vercel.", 502);
  }
  const data = (await response.json().catch(() => ({}))) as {
    uid?: string;
    id?: string;
    url?: string;
    readyState?: string;
    state?: string;
    target?: string | null;
    errorMessage?: string;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new ShipError(`Vercel said: ${(data.error?.message ?? data.errorMessage ?? `status ${response.status}`).slice(0, 300)}`, 409);
  }
  return {
    id: data.uid ?? data.id ?? "",
    url: data.url ? (data.url.startsWith("http") ? data.url : `https://${data.url}`) : "",
    state: data.readyState ?? data.state ?? "QUEUED",
    target: data.target,
    errorMessage: data.errorMessage,
  };
}

/** Refreshes a deployment that has not settled, and finds the one a preview push started. */
async function refreshLastDeploy(slug: string, linked: LinkedVercel | undefined) {
  const record = await readShipRecord(slug);
  const last = record.lastDeploy;
  if (!last || !isVercelConfigured() || (last.state && SETTLED.has(last.state))) return last;

  try {
    let fresh: VercelDeploymentState | undefined;
    if (last.id) fresh = await readDeployment(last.id);
    else if (last.commit && linked && last.target === "preview") {
      fresh = await findPreviewDeployment({ id: linked.id, name: linked.name, protected: false }, last.commit);
    }
    if (!fresh || (fresh.id === last.id && fresh.state === last.state && fresh.url === last.url)) return last;
    return rememberDeploy(slug, { ...last, id: fresh.id || last.id, state: fresh.state, url: fresh.url || last.url, error: fresh.errorMessage });
  } catch {
    return last;
  }
}

export async function readShipDeploy(slug: string): Promise<ShipDeployState> {
  await requireKnownProject(slug);
  const linked = await linkedVercel(slug);
  const last = await refreshLastDeploy(slug, linked);
  const configured = isVercelConfigured();
  return {
    configured,
    setup: configured ? undefined : VERCEL_SETUP_HINT,
    vercelProjectId: linked?.id,
    vercelProjectName: linked?.name,
    target: last?.target,
    id: last?.id,
    commit: last?.commit,
    state: last?.state,
    url: last?.url,
    error: last?.error,
    updatedAt: last?.updatedAt,
  };
}

/** Links a project the token can see. The id is checked with Vercel, never stored as typed. */
export async function linkVercelProject(slug: string, projectId: string): Promise<ShipDeployState> {
  await requireKnownProject(slug);
  requireVercel();
  const project = await readVercelProject(projectId).catch(asShipError);
  if (!project) throw new ShipError("Vercel has no project with that id the token can see.", 404);
  await patchProject({ slug, configuration: { vercelProjectId: project.id, vercelProjectName: project.name } });
  return readShipDeploy(slug);
}

function githubRepoOf(remote: { owner: string; name: string; fullName: string; htmlUrl: string }, branch: string): GithubRepo {
  return { ...remote, private: true, defaultBranch: branch };
}

export async function createVercelProject(slug: string): Promise<ShipDeployState> {
  await requireKnownProject(slug);
  requireVercel();
  const state = await readShipGit(slug);
  if (!state.remote) throw new ShipError("Connect a GitHub repository first, then create the Vercel project.", 409);
  const vercelName = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 80);
  const { project } = await ensureVercelProject(vercelName, githubRepoOf(state.remote, state.branch || "main")).catch(asShipError);
  await patchProject({ slug, configuration: { vercelProjectId: project.id, vercelProjectName: project.name } });
  return readShipDeploy(slug);
}

async function deployPreview(folder: string, project: VercelProject, repo: GithubRepo, commit: string): Promise<VercelDeploymentState | { id?: undefined; state: string; url?: undefined; errorMessage?: undefined }> {
  if (project.productionBranch === PREVIEW_BRANCH) {
    throw new ShipError(`${project.name} builds the ${PREVIEW_BRANCH} branch as production, so a preview push would go live. Change its production branch in Vercel first.`, 409);
  }
  const token = await resolveGithubToken();
  if (!token) throw new ShipError(GITHUB_SETUP_HINT, 409);
  const deps: PublishDeps = { ...defaultPublishDeps, env: () => ({ ...process.env, GITHUB_TOKEN: token }) };
  // `preview` is AgentOS' own branch, so it is moved to this commit (forced), exactly as the rebuild does.
  await pushRef(folder, repo, commit, PREVIEW_BRANCH, true, deps).catch(asShipError);

  if (project.linkedRepo?.toLowerCase() === repo.fullName.toLowerCase()) {
    // Vercel's Git integration builds the push. The deployment is found by commit on the next read.
    return { state: "QUEUED" };
  }
  return requestPreviewDeployment(project, repo, PREVIEW_BRANCH, commit).catch(asShipError);
}

export async function deployShip(slug: string, request: ShipDeployRequest, deps: PublishDeps = defaultPublishDeps): Promise<ShipDeployState> {
  await requireKnownProject(slug);
  const linked = await linkedVercel(slug);
  if (!linked) throw new ShipError("Link or create a Vercel project first.", 409);
  // The gate comes before anything that touches the network.
  if (request.target === "production") assertProductionConfirmed(linked, request.confirm, "This deploy");

  requireVercel();
  const folder = await requireShipRoot(slug);
  const state = await readShipGit(slug);
  if (!state.remote) throw new ShipError("Connect a GitHub repository first.", 409);
  const commit = await headCommit(folder);
  if (!commit) throw new ShipError("There is no commit to deploy.", 409);
  const branch = state.branch || "main";
  const repo = githubRepoOf(state.remote, branch);

  let deployment;
  if (request.target === "preview") {
    const project = await readVercelProject(linked.id, deps).catch(asShipError);
    if (!project) throw new ShipError(`The Vercel project ${linked.name} no longer exists. Link another.`, 409);
    deployment = await deployPreview(folder, project, repo, commit);
  } else {
    if (state.ahead === undefined || state.ahead > 0) {
      throw new ShipError(`Push ${branch} to GitHub first: Vercel builds production from what GitHub has.`, 409);
    }
    deployment = await requestProductionDeployment(linked, repo, branch, commit, deps);
  }

  await rememberDeploy(slug, {
    target: request.target,
    id: deployment.id || undefined,
    commit,
    state: deployment.state,
    url: deployment.url || undefined,
    error: deployment.errorMessage,
  });
  return readShipDeploy(slug);
}
