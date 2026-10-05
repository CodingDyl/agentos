import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { authorize } from "../connectors/policy";

/**
 * The only outward-facing writes in the website rebuild: create a private
 * GitHub repo, push to it, create a Vercel project for it, and ask Vercel for
 * a preview deployment. Nothing here touches production, domains or DNS.
 *
 * `server/vercel/client.ts` stays read-only; this file is where the rebuild's
 * Vercel writes live, each one behind its own connector capability.
 *
 * Tokens are sent only as request headers. For `git push` the token reaches
 * git through environment variables (`GIT_CONFIG_*`), so it is never in the
 * command line, the repository's remote URL or its config, and errors are
 * scrubbed of it before they are shown.
 */

const run = promisify(execFile);
const GITHUB = "https://api.github.com";
const VERCEL = "https://api.vercel.com";

export class PublishError extends Error {}

export interface PublishDeps {
  fetch: typeof fetch;
  env: () => NodeJS.ProcessEnv;
  git: (repo: string, args: readonly string[], env: Record<string, string>) => Promise<string>;
}

export const defaultPublishDeps: PublishDeps = {
  fetch: (input, init) => fetch(input, init),
  env: () => process.env,
  git: async (repo, args, env) => (await run("git", [...args], { cwd: repo, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 16 * 1024 * 1024 })).stdout.trim(),
};

function token(deps: PublishDeps, name: "GITHUB_TOKEN" | "VERCEL_API_TOKEN"): string {
  const value = deps.env()[name]?.trim();
  if (!value) {
    throw new PublishError(
      name === "GITHUB_TOKEN"
        ? "GITHUB_TOKEN is not set. Add a token that can create private repositories (classic `repo` scope) to .env, then retry."
        : "VERCEL_API_TOKEN is not set. Add a Vercel token that can create projects to .env, then retry.",
    );
  }
  return value;
}

function scrub(text: string, secrets: readonly string[]): string {
  return secrets.reduce((current, secret) => (secret ? current.split(secret).join("***") : current), text);
}

function allow(capability: string, detail: string): void {
  const decision = authorize(capability, { initiator: "person", detail });
  if (!decision.allowed) throw new PublishError(decision.reason);
}

async function api<T>(deps: PublishDeps, base: "github" | "vercel", path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  const secret = token(deps, base === "github" ? "GITHUB_TOKEN" : "VERCEL_API_TOKEN");
  const team = base === "vercel" ? deps.env().VERCEL_TEAM_ID?.trim() : undefined;
  const url = `${base === "github" ? GITHUB : VERCEL}${path}${team ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}` : ""}`;
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(base === "github" ? { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PublishError(`Could not reach ${base === "github" ? "GitHub" : "Vercel"}.`);
  }
  const data = (await response.json().catch(() => ({}))) as T;
  if (response.status === 401 || response.status === 403) {
    throw new PublishError(`${base === "github" ? "GitHub" : "Vercel"} refused the token (${response.status}). Check its permissions, then retry.`);
  }
  return { status: response.status, data };
}

function apiError(service: string, status: number, data: unknown): PublishError {
  const message = typeof data === "object" && data && "message" in data && typeof (data as { message: unknown }).message === "string"
    ? (data as { message: string }).message
    : typeof data === "object" && data && "error" in data && typeof (data as { error: { message?: unknown } }).error?.message === "string"
      ? String((data as { error: { message: string } }).error.message)
      : `status ${status}`;
  return new PublishError(`${service} said: ${message.slice(0, 300)}`);
}

// ------------------------------------------------------------------- GitHub

export interface GithubRepo {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

function toRepo(data: { name: string; full_name: string; private: boolean; default_branch?: string; html_url: string; owner: { login: string } }): GithubRepo {
  return { owner: data.owner.login, name: data.name, fullName: data.full_name, private: data.private, defaultBranch: data.default_branch ?? "main", htmlUrl: data.html_url };
}

/** The client's repo on the token owner's account: found if it exists, created private if not. Never made public. */
export async function ensurePrivateRepo(name: string, description: string, deps: PublishDeps = defaultPublishDeps): Promise<{ repo: GithubRepo; created: boolean }> {
  const me = await api<{ login?: string }>(deps, "github", "/user");
  if (!me.data.login) throw apiError("GitHub", me.status, me.data);
  const existing = await api<Parameters<typeof toRepo>[0]>(deps, "github", `/repos/${encodeURIComponent(me.data.login)}/${encodeURIComponent(name)}`);
  if (existing.status === 200) {
    const repo = toRepo(existing.data);
    if (!repo.private) throw new PublishError(`${repo.fullName} already exists and is public. Client previews only go to private repos; rename or make it private, then retry.`);
    return { repo, created: false };
  }
  if (existing.status !== 404) throw apiError("GitHub", existing.status, existing.data);

  allow("github.create_repository", `Created the private repo ${name}`);
  const created = await api<Parameters<typeof toRepo>[0]>(deps, "github", "/user/repos", { method: "POST", body: { name, description: description.slice(0, 300), private: true, has_wiki: false, has_projects: false, auto_init: false } });
  if (created.status !== 201) throw apiError("GitHub", created.status, created.data);
  return { repo: toRepo(created.data), created: true };
}

/** Pushes a commit to a branch of the GitHub repo. `force` only for AgentOS' own `preview` branch. */
export async function pushRef(localRepo: string, repo: GithubRepo, commit: string, branch: string, force: boolean, deps: PublishDeps = defaultPublishDeps): Promise<void> {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new PublishError(`Not a commit: ${commit}`);
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes("..")) throw new PublishError(`Not a branch name: ${branch}`);
  const secret = token(deps, "GITHUB_TOKEN");
  allow("github.push", `Pushed ${branch} to ${repo.fullName}`);
  const basic = Buffer.from(`x-access-token:${secret}`).toString("base64");
  try {
    await deps.git(localRepo, ["push", ...(force ? ["--force"] : []), `https://github.com/${repo.fullName}.git`, `${commit}:refs/heads/${branch}`], {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    });
  } catch (error) {
    const detail = error instanceof Error ? (error as Error & { stderr?: string }).stderr || error.message : String(error);
    throw new PublishError(`Pushing to ${repo.fullName} failed: ${scrub(detail, [secret, basic]).slice(0, 400)}`);
  }
}

// ------------------------------------------------------------------- Vercel

export interface VercelProject {
  id: string;
  name: string;
  linkedRepo?: string;
  protected: boolean;
}

interface VercelProjectData {
  id: string;
  name: string;
  link?: { type?: string; org?: string; repo?: string };
  ssoProtection?: unknown;
  passwordProtection?: unknown;
}

const toProject = (data: VercelProjectData): VercelProject => ({
  id: data.id,
  name: data.name,
  linkedRepo: data.link?.org && data.link.repo ? `${data.link.org}/${data.link.repo}` : undefined,
  protected: Boolean(data.ssoProtection) || Boolean(data.passwordProtection),
});

/**
 * The client's Vercel project, linked to its GitHub repo: found by name, or
 * created as a Next.js project. A project with that name linked to a
 * different repo is refused rather than repointed.
 */
export async function ensureVercelProject(name: string, repo: GithubRepo, deps: PublishDeps = defaultPublishDeps): Promise<{ project: VercelProject; created: boolean }> {
  const existing = await api<VercelProjectData>(deps, "vercel", `/v9/projects/${encodeURIComponent(name)}`);
  if (existing.status === 200) {
    const project = toProject(existing.data);
    if (project.linkedRepo && project.linkedRepo.toLowerCase() !== repo.fullName.toLowerCase()) {
      throw new PublishError(`The Vercel project ${name} is linked to ${project.linkedRepo}, not ${repo.fullName}. Rename one of them, then retry.`);
    }
    return { project, created: false };
  }
  if (existing.status !== 404) throw apiError("Vercel", existing.status, existing.data);

  allow("vercel.create_project", `Created the Vercel project ${name}`);
  const created = await api<VercelProjectData>(deps, "vercel", "/v11/projects", { method: "POST", body: { name, framework: "nextjs", gitRepository: { type: "github", repo: repo.fullName } } });
  if (created.status !== 200 && created.status !== 201) {
    throw apiError("Vercel", created.status, created.data);
  }
  return { project: toProject(created.data), created: true };
}

/**
 * Anyone with the link can view the previews: Vercel Authentication and
 * password protection are switched off for this client project only. Chosen
 * by the person running AgentOS; a pitch site has nothing private on it.
 */
export async function openPreviewsToLinkHolders(project: VercelProject, deps: PublishDeps = defaultPublishDeps): Promise<void> {
  if (!project.protected) return;
  allow("vercel.create_preview", `Opened previews of ${project.name} to anyone with the link`);
  const result = await api<VercelProjectData>(deps, "vercel", `/v9/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", body: { ssoProtection: null, passwordProtection: null } });
  if (result.status !== 200) throw apiError("Vercel", result.status, result.data);
}

export interface VercelDeploymentState {
  id: string;
  url: string;
  state: string;
  sha?: string;
  target?: string | null;
  errorMessage?: string;
}

interface DeploymentData {
  uid?: string;
  id?: string;
  url: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  meta?: { githubCommitSha?: string };
  errorMessage?: string;
}

const toDeployment = (data: DeploymentData): VercelDeploymentState => ({
  id: data.uid ?? data.id ?? "",
  url: data.url.startsWith("http") ? data.url : `https://${data.url}`,
  state: data.readyState ?? data.state ?? "UNKNOWN",
  sha: data.meta?.githubCommitSha,
  target: data.target,
  errorMessage: data.errorMessage,
});

/** A preview deployment of exactly this commit, if Vercel has one (or is building one). Production deployments never count. */
export async function findPreviewDeployment(project: VercelProject, commit: string, deps: PublishDeps = defaultPublishDeps): Promise<VercelDeploymentState | undefined> {
  const list = await api<{ deployments?: DeploymentData[] }>(deps, "vercel", `/v6/deployments?projectId=${encodeURIComponent(project.id)}&limit=20`);
  if (list.status !== 200) throw apiError("Vercel", list.status, list.data);
  return (list.data.deployments ?? []).map(toDeployment).find((deployment) => deployment.sha === commit && deployment.target !== "production" && deployment.state !== "CANCELED");
}

/** Asks Vercel to build a preview of `branch` at `commit` from the linked repo. Used when the push did not trigger one. */
export async function requestPreviewDeployment(project: VercelProject, repo: GithubRepo, branch: string, commit: string, deps: PublishDeps = defaultPublishDeps): Promise<VercelDeploymentState> {
  allow("vercel.create_preview", `Requested a preview of ${repo.fullName}@${commit.slice(0, 7)}`);
  const result = await api<DeploymentData>(deps, "vercel", "/v13/deployments", {
    method: "POST",
    body: { name: project.name, project: project.id, gitSource: { type: "github", org: repo.owner, repo: repo.name, ref: branch, sha: commit } },
  });
  if (result.status !== 200 && result.status !== 201) throw apiError("Vercel", result.status, result.data);
  const deployment = toDeployment(result.data);
  if (deployment.target === "production") throw new PublishError("Vercel started a production deployment instead of a preview. Stop it in Vercel and check the project's production branch.");
  return deployment;
}

export async function readDeployment(id: string, deps: PublishDeps = defaultPublishDeps): Promise<VercelDeploymentState> {
  const result = await api<DeploymentData>(deps, "vercel", `/v13/deployments/${encodeURIComponent(id)}`);
  if (result.status !== 200) throw apiError("Vercel", result.status, result.data);
  return toDeployment(result.data);
}
