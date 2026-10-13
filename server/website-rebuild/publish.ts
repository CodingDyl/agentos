import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { authorize } from "../connectors/policy";
import { PRODUCTION_BRANCH, previewDeploymentBody } from "./deploy-policy";
import { backoffDelayMs, decideGithubCall } from "./github-rate-limit";

/**
 * The only outward-facing writes in the website rebuild: create a private
 * GitHub repo, push to it, and create a Vercel project linked to it. Vercel
 * then builds a preview from the git push. An extra create-deployment call
 * is a second clone of the same commit and is how GitHub's secondary rate
 * limit gets hit, so this file does not request production, and does not
 * request a preview that the push already triggered.
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
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const defaultPublishDeps: PublishDeps = {
  fetch: (input, init) => fetch(input, init),
  env: () => process.env,
  git: async (repo, args, env) => (await run("git", [...args], { cwd: repo, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 16 * 1024 * 1024 })).stdout.trim(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const inflight = new Map<string, Promise<{ status: number; data: unknown }>>();

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
  const method = init.method ?? "GET";
  const url = `${base === "github" ? GITHUB : VERCEL}${path}${team ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}` : ""}`;
  const key = `${method}:${url}:${init.body !== undefined ? JSON.stringify(init.body) : ""}`;
  const existing = inflight.get(key);
  if (existing) return existing as Promise<{ status: number; data: T }>;

  const run = (async () => {
    const service = base === "github" ? "GitHub" : "Vercel";
    const maxAttempts = 4;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await deps.fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${secret}`,
            "User-Agent": "AgentOS",
            ...(base === "github" ? { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } : {}),
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt < maxAttempts) {
          await sleep(backoffDelayMs(attempt, { random: deps.random }));
          continue;
        }
        throw new PublishError(`Could not reach ${service}.`);
      }
      const data = (await response.json().catch(() => ({}))) as T;
      const decision = decideGithubCall({
        status: response.status,
        body: data,
        headers: response.headers,
        attempt,
        maxAttempts,
        random: deps.random,
      });
      if (decision.action === "rate-limited") throw new PublishError(decision.message);
      if (decision.action === "auth") {
        throw new PublishError(`${service} refused the token (${response.status}). Check its permissions, then retry.`);
      }
      if (decision.action === "retry") {
        await sleep(decision.waitMs);
        continue;
      }
      return { status: response.status, data };
    }
  })();

  inflight.set(key, run);
  try {
    return (await run) as { status: number; data: T };
  } finally {
    inflight.delete(key);
  }
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

/** `main` stays the production branch. A repo whose default is `preview` is how Vercel deploys previews as production. */
export async function pinGithubDefaultBranch(repo: GithubRepo, branch = PRODUCTION_BRANCH, deps: PublishDeps = defaultPublishDeps): Promise<GithubRepo> {
  if (repo.defaultBranch === branch) return repo;
  allow("github.push", `Set ${repo.fullName} default branch to ${branch}`);
  const result = await api<Parameters<typeof toRepo>[0]>(deps, "github", `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`, { method: "PATCH", body: { default_branch: branch } });
  if (result.status !== 200) throw apiError("GitHub", result.status, result.data);
  return toRepo(result.data);
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

/** What a cleanup needs to know about a repo before deleting it. */
export interface GithubRepoFacts {
  fullName: string;
  private: boolean;
  /** ISO time GitHub says it was created. */
  createdAt?: string;
}

const REPO_FULL_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** A repo's facts, or undefined when it no longer exists. */
export async function inspectGithubRepo(fullName: string, deps: PublishDeps = defaultPublishDeps): Promise<GithubRepoFacts | undefined> {
  if (!REPO_FULL_NAME.test(fullName)) throw new PublishError(`${fullName} is not a repository name.`);
  const [owner, name] = fullName.split("/");
  const result = await api<{ full_name?: string; private?: boolean; created_at?: string }>(deps, "github", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  if (result.status === 404) return undefined;
  if (result.status !== 200) throw apiError("GitHub", result.status, result.data);
  return { fullName: result.data.full_name ?? fullName, private: Boolean(result.data.private), createdAt: result.data.created_at };
}

/**
 * Deletes a repository. Not recoverable from here. Needs the connector's
 * "Delete repositories" capability switched on, and a token with the
 * `delete_repo` scope. Already gone counts as done.
 */
export async function deleteGithubRepo(fullName: string, deps: PublishDeps = defaultPublishDeps): Promise<void> {
  if (!REPO_FULL_NAME.test(fullName)) throw new PublishError(`${fullName} is not a repository name.`);
  allow("github.delete_repository", `Deleted the repo ${fullName}`);
  const [owner, name] = fullName.split("/");
  const result = await api<unknown>(deps, "github", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (result.status === 204 || result.status === 404) return;
  throw apiError("GitHub", result.status, result.data);
}

// ------------------------------------------------------------------- Vercel

export interface VercelProject {
  id: string;
  name: string;
  linkedRepo?: string;
  protected: boolean;
  productionBranch?: string;
}

interface VercelProjectData {
  id: string;
  name: string;
  link?: { type?: string; org?: string; repo?: string; productionBranch?: string };
  ssoProtection?: unknown;
  passwordProtection?: unknown;
}

const toProject = (data: VercelProjectData): VercelProject => ({
  id: data.id,
  name: data.name,
  linkedRepo: data.link?.org && data.link.repo ? `${data.link.org}/${data.link.repo}` : undefined,
  protected: Boolean(data.ssoProtection) || Boolean(data.passwordProtection),
  productionBranch: data.link?.productionBranch,
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

/** What a cleanup needs to know about a Vercel project before deleting it. */
export interface VercelProjectFacts {
  id: string;
  name: string;
  /** Milliseconds since the epoch, as Vercel reports it. */
  createdAt?: number;
  linkedRepo?: string;
}

/** A project's facts, or undefined when it no longer exists. */
export async function inspectVercelProject(id: string, deps: PublishDeps = defaultPublishDeps): Promise<VercelProjectFacts | undefined> {
  const result = await api<VercelProjectData & { createdAt?: number }>(deps, "vercel", `/v9/projects/${encodeURIComponent(id)}`);
  if (result.status === 404) return undefined;
  if (result.status !== 200) throw apiError("Vercel", result.status, result.data);
  return { id: result.data.id, name: result.data.name, createdAt: typeof result.data.createdAt === "number" ? result.data.createdAt : undefined, linkedRepo: toProject(result.data).linkedRepo };
}

/** Deletes a project and its deployments. Not recoverable from here. Needs the "Delete projects" capability switched on. Already gone counts as done. */
export async function deleteVercelProject(id: string, deps: PublishDeps = defaultPublishDeps): Promise<void> {
  allow("vercel.delete_project", `Deleted the Vercel project ${id.slice(0, 40)}`);
  const result = await api<unknown>(deps, "vercel", `/v9/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (result.status === 200 || result.status === 204 || result.status === 404) return;
  throw apiError("Vercel", result.status, result.data);
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

/** Every unfinished-or-live deployment of this commit. Production is included so the caller can refuse a second trigger. */
export async function listCommitDeployments(project: VercelProject, commit: string, deps: PublishDeps = defaultPublishDeps): Promise<VercelDeploymentState[]> {
  const list = await api<{ deployments?: DeploymentData[] }>(deps, "vercel", `/v6/deployments?projectId=${encodeURIComponent(project.id)}&limit=20`);
  if (list.status !== 200) throw apiError("Vercel", list.status, list.data);
  return (list.data.deployments ?? []).map(toDeployment).filter((deployment) => deployment.sha === commit && deployment.state !== "CANCELED");
}

/** A preview deployment of exactly this commit, if Vercel has one (or is building one). Production deployments never count. */
export async function findPreviewDeployment(project: VercelProject, commit: string, deps: PublishDeps = defaultPublishDeps): Promise<VercelDeploymentState | undefined> {
  return (await listCommitDeployments(project, commit, deps)).find((deployment) => deployment.target !== "production");
}

/** Asks Vercel to build a preview of `branch` at `commit`. Only for projects with no Git integration: a git-push already triggers one. */
export async function requestPreviewDeployment(project: VercelProject, repo: GithubRepo, branch: string, commit: string, deps: PublishDeps = defaultPublishDeps): Promise<VercelDeploymentState> {
  allow("vercel.create_preview", `Requested a preview of ${repo.fullName}@${commit.slice(0, 7)}`);
  const result = await api<DeploymentData>(deps, "vercel", "/v13/deployments", {
    method: "POST",
    body: previewDeploymentBody(project, repo, branch, commit),
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
