import { VERCEL_SETUP_HINT, type ShipDeployState, type ShipDeployTarget } from "../../shared/ship-types";
import { authorize } from "../connectors/policy";
import { isVercelConfigured } from "../vercel/client";
import { parseConfiguration } from "../agentos/mutations/configuration";
import { patchProject } from "../agentos/mutations/projects";
import { findProject } from "../agentos/projects";
import { readOptionalFile } from "../agentos/filesystem";
import {
  defaultPublishDeps,
  ensureVercelProject,
  readDeployment,
  requestPreviewDeployment,
  PublishError,
  type GithubRepo,
  type PublishDeps,
  type VercelDeploymentState,
} from "../website-rebuild/publish";
import { PREVIEW_BRANCH } from "../website-rebuild/deploy-policy";
import { git, headCommit } from "../agentos/git";
import { ShipError } from "./error";
import { readShipGit } from "./git";
import { requireKnownProject, requireShipRoot } from "./root";
import { readShipRecord, rememberDeploy } from "./store";

function publishEnv(): PublishDeps {
  return defaultPublishDeps;
}

function requireVercel(): void {
  if (!isVercelConfigured()) throw new ShipError(VERCEL_SETUP_HINT, 409);
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

async function requestProductionDeployment(
  project: { id: string; name: string },
  repo: GithubRepo,
  branch: string,
  commit: string,
  deps: PublishDeps,
): Promise<VercelDeploymentState> {
  const decision = authorize("vercel.deploy_production", { initiator: "person", detail: `Production deploy of ${repo.fullName}@${commit.slice(0, 7)}` });
  if (!decision.allowed) throw new ShipError(decision.reason, 409);
  const token = deps.env().VERCEL_API_TOKEN?.trim();
  if (!token) throw new ShipError(VERCEL_SETUP_HINT, 409);
  const team = deps.env().VERCEL_TEAM_ID?.trim();
  const url = `https://api.vercel.com/v13/deployments${team ? `?teamId=${encodeURIComponent(team)}` : ""}`;
  const response = await deps.fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(productionDeploymentBody(project, repo, branch, commit)),
    signal: AbortSignal.timeout(30_000),
  });
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
    throw new ShipError(data.error?.message ?? data.errorMessage ?? `Vercel responded with ${response.status}.`, 409);
  }
  return {
    id: data.uid ?? data.id ?? "",
    url: data.url ? (data.url.startsWith("http") ? data.url : `https://${data.url}`) : "",
    state: data.readyState ?? data.state ?? "QUEUED",
    target: data.target,
    errorMessage: data.errorMessage,
  };
}

async function linkedVercel(slug: string): Promise<{ id: string; name: string } | undefined> {
  const markdown = await readOptionalFile(`projects/${slug}/PROJECT.md`);
  const config = parseConfiguration(markdown);
  if (!config.vercelProjectId) return undefined;
  return { id: config.vercelProjectId, name: config.vercelProjectName || config.vercelProjectId };
}

export async function readShipDeploy(slug: string): Promise<ShipDeployState> {
  await requireKnownProject(slug);
  const record = await readShipRecord(slug);
  const linked = await linkedVercel(slug);
  const last = record.lastDeploy;
  if (last?.id && isVercelConfigured()) {
    const fresh = await readDeployment(last.id, publishEnv()).catch(() => undefined);
    if (fresh) {
      last.state = fresh.state;
      last.url = fresh.url;
      last.error = fresh.errorMessage;
      last.updatedAt = new Date().toISOString();
      await rememberDeploy(slug, last);
    }
  }
  return {
    configured: isVercelConfigured(),
    setup: isVercelConfigured() ? undefined : VERCEL_SETUP_HINT,
    vercelProjectId: linked?.id,
    vercelProjectName: linked?.name,
    target: last?.target,
    id: last?.id,
    state: last?.state,
    url: last?.url,
    logs: last?.logs,
    error: last?.error,
    updatedAt: last?.updatedAt,
  };
}

export async function linkVercelProject(slug: string, projectId: string, projectName?: string): Promise<ShipDeployState> {
  await requireKnownProject(slug);
  requireVercel();
  await patchProject({
    slug,
    configuration: { vercelProjectId: projectId, vercelProjectName: projectName?.trim() || projectId },
  });
  return readShipDeploy(slug);
}

export async function createVercelProject(slug: string): Promise<ShipDeployState> {
  await requireKnownProject(slug);
  requireVercel();
  const gitState = await readShipGit(slug);
  const remote = gitState.remote;
  if (!remote) throw new ShipError("Connect a GitHub repository first, then create the Vercel project.", 409);
  const name = (await findProject(slug))?.name ?? slug;
  const vercelName = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 80);
  const repo: GithubRepo = { owner: remote.owner, name: remote.name, fullName: remote.fullName, private: true, defaultBranch: gitState.branch || "main", htmlUrl: remote.htmlUrl };
  const created = await ensureVercelProject(vercelName, repo, publishEnv()).catch((error: unknown) => {
    if (error instanceof PublishError) throw new ShipError(error.message, 409);
    throw error;
  });
  await patchProject({
    slug,
    configuration: { vercelProjectId: created.project.id, vercelProjectName: created.project.name || name },
  });
  return readShipDeploy(slug);
}

export async function deployShip(slug: string, target: ShipDeployTarget): Promise<ShipDeployState> {
  await requireKnownProject(slug);
  requireVercel();
  const folder = await requireShipRoot(slug);
  const gitState = await readShipGit(slug);
  const remote = gitState.remote;
  if (!remote) throw new ShipError("Connect a GitHub repository first.", 409);
  const commit = await headCommit(folder);
  if (!commit) throw new ShipError("There is no commit to deploy.", 409);
  let linked = await linkedVercel(slug);
  if (!linked) {
    await createVercelProject(slug);
    linked = await linkedVercel(slug);
  }
  if (!linked) throw new ShipError("Link or create a Vercel project first.", 409);

  const repo: GithubRepo = {
    owner: remote.owner,
    name: remote.name,
    fullName: remote.fullName,
    private: true,
    defaultBranch: gitState.branch || "main",
    htmlUrl: remote.htmlUrl,
  };
  const branch = target === "preview" ? PREVIEW_BRANCH : gitState.branch || "main";
  if (target === "preview" && gitState.branch && gitState.branch !== PREVIEW_BRANCH) {
    await git(folder, ["branch", PREVIEW_BRANCH, commit]).catch(async () => {
      await git(folder, ["branch", "-f", PREVIEW_BRANCH, commit]);
    });
  }

  let deployment;
  try {
    deployment =
      target === "preview"
        ? await requestPreviewDeployment({ ...linked, protected: false }, repo, branch, commit, publishEnv())
        : await requestProductionDeployment(linked, repo, branch, commit, publishEnv());
  } catch (error) {
    if (error instanceof PublishError || error instanceof ShipError) {
      throw error instanceof ShipError ? error : new ShipError(error.message, 409);
    }
    throw error;
  }

  await rememberDeploy(slug, {
    target,
    id: deployment.id,
    state: deployment.state,
    url: deployment.url,
    error: deployment.errorMessage,
  });
  return readShipDeploy(slug);
}
