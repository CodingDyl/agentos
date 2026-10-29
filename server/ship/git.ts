import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { GITHUB_SETUP_HINT, parseGithubRepo, type ShipGitRemote, type ShipGitState } from "../../shared/ship-types";
import { git, headCommit, isRepository, readRecentCommits } from "../agentos/git";
import { patchProject } from "../agentos/mutations/projects";
import { getGitStatus, pullChanges, pushChanges } from "../coder/git-operations";
import { assertClientDrivePresent, ClientRepoUnavailable, clientSitesDir, repoFolderName } from "../website-rebuild/client-repo";
import { defaultPublishDeps, ensurePrivateRepo, PublishError, pushRef, type GithubRepo, type PublishDeps } from "../website-rebuild/publish";
import { ShipError } from "./error";
import { assertPushAllowed, pushDeploysProduction } from "./production-gate";
import { guardProjectFolder, requireKnownProject, requireShipRoot, resolveInside, resolveShipRoot } from "./root";
import { rememberGithub } from "./store";

/**
 * Git for Ship: status, init, link, create-and-push, pull and push.
 *
 * Every command is `git` with an argument array (no shell), run in the
 * guarded project folder. The GitHub token reaches git only through the
 * environment (`GIT_CONFIG_*` headers, via the rebuild's `pushRef`), so it is
 * never in a remote URL, the repo's config, a log line or a response.
 */

const run = promisify(execFile);
const AUTHOR = ["-c", "user.name=AgentOS", "-c", "user.email=agentos@localhost"] as const;
const DEFAULT_GITIGNORE = ["node_modules/", ".next/", "out/", "dist/", ".vercel/", ".env", ".env.*", "!.env.example", "*.log", "._*", ".DS_Store", ""].join("\n");
/** Never part of a first commit, whatever the project's own .gitignore says. */
const SECRET_FILE = /(^|\/)\.env(\.(?!example$)[^/]*)?$/;

const GH_CACHE_MS = 60_000;
let ghToken: { value: string | undefined; until: number } | undefined;

/** Where the token comes from. Replaced in tests so the machine's `gh` login is never used. */
export const githubTokenSource = {
  async resolve(): Promise<string | undefined> {
    const fromEnv = process.env.GITHUB_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    // The panel polls; `gh` is asked at most once a minute.
    if (ghToken && ghToken.until > Date.now()) return ghToken.value;
    let value: string | undefined;
    try {
      value = (await run("gh", ["auth", "token"], { timeout: 5_000 })).stdout.trim() || undefined;
    } catch {
      value = undefined;
    }
    ghToken = { value, until: Date.now() + GH_CACHE_MS };
    return value;
  },
};

export function resolveGithubToken(): Promise<string | undefined> {
  return githubTokenSource.resolve();
}

function publishDeps(token: string): PublishDeps {
  return { ...defaultPublishDeps, env: () => ({ ...process.env, GITHUB_TOKEN: token }) };
}

function asShipError(error: unknown): never {
  if (error instanceof PublishError) throw new ShipError(error.message, 409);
  throw error;
}

async function remoteUrl(folder: string): Promise<string | undefined> {
  try {
    const { stdout } = await git(folder, ["remote", "get-url", "origin"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function remoteOf(url: string | undefined): ShipGitRemote | undefined {
  const parsed = url ? parseGithubRepo(url) : undefined;
  return parsed ? { owner: parsed.owner, name: parsed.name, fullName: parsed.fullName, htmlUrl: parsed.htmlUrl } : undefined;
}

export async function readShipGit(slug: string): Promise<ShipGitState> {
  const folder = await resolveShipRoot(slug);
  if (!folder) {
    return { isRepo: false, dirty: false, changedFiles: [], setup: "There is no project folder yet. Run Motion Design, or link a GitHub repository." };
  }
  if (!(await isRepository(folder))) return { folder, isRepo: false, dirty: false, changedFiles: [] };

  const [status, head, commits, origin] = await Promise.all([
    getGitStatus(folder).catch(() => undefined),
    headCommit(folder),
    readRecentCommits(folder, 1).catch(() => []),
    remoteUrl(folder),
  ]);
  const branch = status?.branch && status.branch !== "HEAD" ? status.branch : undefined;
  const remote = remoteOf(origin);

  return {
    folder,
    isRepo: true,
    branch,
    head: head?.slice(0, 7),
    subject: commits[0]?.subject,
    dirty: status ? !status.clean : false,
    changedFiles: (status?.files ?? []).map((file) => file.path),
    ahead: status?.ahead,
    behind: status?.behind,
    remote,
    pushDeploysProduction: remote ? await pushDeploysProduction(slug, branch) : undefined,
  };
}

async function initRepository(folder: string): Promise<void> {
  if (await isRepository(folder)) return;
  try {
    await git(folder, ["init", "-b", "main"]);
  } catch {
    await git(folder, ["init"]);
  }
}

/** The first commit: everything except `.env` files, with a .gitignore that keeps them out from now on. */
async function commitEverything(folder: string, message: string): Promise<void> {
  const ignore = await resolveInside(folder, ".gitignore");
  await fs.writeFile(ignore, DEFAULT_GITIGNORE, { flag: "wx" }).catch(() => undefined);
  await git(folder, ["add", "-A"]);
  const staged = (await git(folder, ["diff", "--cached", "--name-only", "-z"])).stdout.split("\0").filter(Boolean);
  const secrets = staged.filter((file) => SECRET_FILE.test(file));
  if (secrets.length > 0) await git(folder, ["rm", "--cached", "--quiet", "--", ...secrets]);
  if (staged.length > secrets.length) await git(folder, [...AUTHOR, "commit", "--no-verify", "-m", message]);
}

/** Records the folder as the workspace's Local repository, so the Dev tab, workers and Ship agree on it. */
async function recordFolder(slug: string, folder: string): Promise<void> {
  await patchProject({ slug, repoPath: folder }).catch(() => {
    // A workspace whose PROJECT.md cannot be edited still has the folder; git works either way.
  });
}

export async function initShipRepo(slug: string): Promise<ShipGitState> {
  const folder = await requireShipRoot(slug);
  await initRepository(folder);
  if (!(await headCommit(folder))) await commitEverything(folder, "Start the project");
  await recordFolder(slug, folder);
  return readShipGit(slug);
}

async function setOrigin(folder: string, cloneUrl: string): Promise<void> {
  if (await remoteUrl(folder)) await git(folder, ["remote", "set-url", "origin", cloneUrl]);
  else await git(folder, ["remote", "add", "origin", cloneUrl]);
}

/** After a push by URL, point the local tracking branch at what was pushed so ahead/behind read true. */
async function trackPushed(folder: string, branch: string, commit: string): Promise<void> {
  await git(folder, ["update-ref", `refs/remotes/origin/${branch}`, commit]).catch(() => undefined);
  await git(folder, ["config", `branch.${branch}.remote`, "origin"]).catch(() => undefined);
  await git(folder, ["config", `branch.${branch}.merge`, `refs/heads/${branch}`]).catch(() => undefined);
}

/** Clones into the client-projects folder, the same place Motion Design and rebuilds put new code. */
async function cloneFresh(slug: string, cloneUrl: string): Promise<string> {
  const parent = clientSitesDir();
  try {
    await assertClientDrivePresent(parent);
  } catch (error) {
    if (error instanceof ClientRepoUnavailable) throw new ShipError(error.message, 409);
    throw error;
  }
  await fs.mkdir(parent, { recursive: true });
  const target = await resolveInside(parent, repoFolderName(slug));
  const entries = await fs.readdir(target).catch(() => undefined);
  if (entries && entries.length > 0) {
    throw new ShipError(`${target} already exists and is not empty. Add it as the Local repository instead.`, 409);
  }

  const token = await resolveGithubToken();
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  try {
    await run("git", ["clone", "--", cloneUrl, target], { cwd: parent, env, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    throw new ShipError(`Cloning ${cloneUrl} failed. Check the repository exists and that GitHub access is set up. ${GITHUB_SETUP_HINT}`, 409);
  }
  const real = await guardProjectFolder(target);
  if (!real) throw new ShipError("The clone did not produce a folder.", 500);
  return real;
}

export async function linkExistingRepo(slug: string, repoInput: string): Promise<ShipGitState> {
  await requireKnownProject(slug);
  const parsed = parseGithubRepo(repoInput);
  if (!parsed) throw new ShipError("Use owner/name or a github.com URL.");

  let folder = await resolveShipRoot(slug);
  if (!folder) {
    folder = await cloneFresh(slug, parsed.cloneUrl);
  } else {
    await initRepository(folder);
    await setOrigin(folder, parsed.cloneUrl);
  }

  await recordFolder(slug, folder);
  await rememberGithub(slug, { owner: parsed.owner, name: parsed.name, fullName: parsed.fullName, htmlUrl: parsed.htmlUrl });
  return readShipGit(slug);
}

function repoNameFor(slug: string, name?: string): string {
  const cleaned = (name?.trim() || slug).replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "").slice(0, 100);
  if (!cleaned) throw new ShipError("That is not a repository name GitHub accepts.");
  return cleaned;
}

export async function createGithubRepo(slug: string, name?: string, confirmProduction?: string): Promise<ShipGitState> {
  const folder = await requireShipRoot(slug);
  const token = await resolveGithubToken();
  if (!token) throw new ShipError(GITHUB_SETUP_HINT, 409);

  const state = await initShipRepo(slug);
  const commit = await headCommit(folder);
  if (!commit) throw new ShipError("The folder has nothing to push yet. Add files and try again.", 409);
  const branch = state.branch || "main";
  await assertPushAllowed(slug, branch, confirmProduction);

  const deps = publishDeps(token);
  const { repo } = await ensurePrivateRepo(repoNameFor(slug, name), `AgentOS project ${slug}`, deps).catch(asShipError);
  await setOrigin(folder, `https://github.com/${repo.fullName}.git`);
  await pushRef(folder, repo, commit, branch, false, deps).catch(asShipError);
  await trackPushed(folder, branch, commit);
  await rememberGithub(slug, { owner: repo.owner, name: repo.name, fullName: repo.fullName, htmlUrl: repo.htmlUrl });
  return readShipGit(slug);
}

export async function pullShipRepo(slug: string): Promise<{ git: ShipGitState; message: string }> {
  const folder = await requireShipRoot(slug);
  if (!(await isRepository(folder))) throw new ShipError("Init the folder or link a repository first.", 409);
  const result = await pullChanges(folder);
  if (!result.success) throw new ShipError(result.message, 409);
  return { git: await readShipGit(slug), message: result.message };
}

export async function pushShipRepo(slug: string, confirmProduction?: string): Promise<{ git: ShipGitState; message: string }> {
  const folder = await requireShipRoot(slug);
  if (!(await isRepository(folder))) throw new ShipError("Init the folder or link a repository first.", 409);
  const state = await readShipGit(slug);
  if (!state.branch) throw new ShipError("The folder is not on a branch, so there is nothing to push.", 409);
  await assertPushAllowed(slug, state.branch, confirmProduction);

  const token = await resolveGithubToken();
  const parsed = state.remote ? parseGithubRepo(state.remote.fullName) : undefined;
  const commit = await headCommit(folder);
  if (token && parsed && commit) {
    const repo: GithubRepo = { ...parsed, private: true, defaultBranch: state.branch, htmlUrl: parsed.htmlUrl };
    await pushRef(folder, repo, commit, state.branch, false, publishDeps(token)).catch(asShipError);
    await trackPushed(folder, state.branch, commit);
    return { git: await readShipGit(slug), message: `Pushed ${state.branch} to ${parsed.fullName}.` };
  }

  // No token: git's own credentials (a credential helper or SSH key) for whatever origin is.
  const result = await pushChanges(folder);
  if (!result.success) throw new ShipError(/auth|permission|denied|credential/i.test(result.message) ? `${result.message} ${GITHUB_SETUP_HINT}` : result.message, 409);
  return { git: await readShipGit(slug), message: result.message };
}

