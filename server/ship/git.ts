import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { GITHUB_SETUP_HINT, parseGithubRepo, type ShipGitRemote, type ShipGitState } from "../../shared/ship-types";
import { git, headCommit, isRepository, readRecentCommits } from "../agentos/git";
import { patchProject } from "../agentos/mutations/projects";
import { pullChanges, pushChanges, getGitStatus } from "../coder/git-operations";
import { defaultPublishDeps, ensurePrivateRepo, PublishError, pushRef, type GithubRepo, type PublishDeps } from "../website-rebuild/publish";
import { ShipError } from "./error";
import { requireKnownProject, requireShipRoot, resolveShipRoot } from "./root";
import { rememberGithub } from "./store";

const run = promisify(execFile);
const AUTHOR = ["-c", "user.name=AgentOS", "-c", "user.email=agentos@localhost"] as const;

export async function resolveGithubToken(): Promise<string | undefined> {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await run("gh", ["auth", "token"], { timeout: 5_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function publishEnv(token?: string): PublishDeps {
  return {
    ...defaultPublishDeps,
    env: () => ({ ...process.env, ...(token ? { GITHUB_TOKEN: token } : {}) }),
  };
}

async function remoteUrl(folder: string): Promise<string | undefined> {
  try {
    const { stdout } = await git(folder, ["remote", "get-url", "origin"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function remoteFromUrl(url: string | undefined): ShipGitRemote | undefined {
  if (!url) return undefined;
  const parsed = parseGithubRepo(url);
  if (!parsed) return undefined;
  return { owner: parsed.owner, name: parsed.name, fullName: parsed.fullName, htmlUrl: parsed.htmlUrl };
}

export async function readShipGit(slug: string): Promise<ShipGitState> {
  await requireKnownProject(slug);
  const folder = await resolveShipRoot(slug);
  if (!folder) {
    return { isRepo: false, dirty: false, changedFiles: [], setup: "There is no project folder yet. Generate the site, or link a repository." };
  }

  if (!(await isRepository(folder))) {
    return { folder, isRepo: false, dirty: false, changedFiles: [] };
  }

  const [status, head, commits, origin] = await Promise.all([
    getGitStatus(folder).catch(() => undefined),
    headCommit(folder),
    readRecentCommits(folder, 1),
    remoteUrl(folder),
  ]);

  return {
    folder,
    isRepo: true,
    branch: status?.branch,
    head: head?.slice(0, 7),
    subject: commits[0]?.subject,
    dirty: status ? !status.clean : false,
    changedFiles: (status?.files ?? []).map((file) => file.path),
    ahead: status?.ahead,
    behind: status?.behind,
    remoteUrl: origin,
    remote: remoteFromUrl(origin),
  };
}

async function ensureGitIdentity(folder: string): Promise<void> {
  await git(folder, [...AUTHOR, "status"]).catch(() => undefined);
}

export async function initShipRepo(slug: string): Promise<ShipGitState> {
  await requireKnownProject(slug);
  const folder = await requireShipRoot(slug);
  if (!(await isRepository(folder))) {
    try {
      await git(folder, ["init", "-b", "main"]);
    } catch {
      await git(folder, ["init"]);
    }
  }
  await ensureGitIdentity(folder);
  const head = await headCommit(folder);
  if (!head) {
    await git(folder, ["add", "-A"]);
    const staged = await git(folder, ["diff", "--cached", "--name-only"]);
    if (staged.stdout.trim()) {
      await git(folder, [...AUTHOR, "commit", "--no-verify", "-m", "Start the project"]);
    }
  }
  await persistFolder(slug, folder);
  return readShipGit(slug);
}

async function persistFolder(slug: string, folder: string): Promise<void> {
  await patchProject({ slug, repoPath: folder, configuration: { localPath: folder } }).catch(() => {
    // A workspace without PROJECT.md still has the folder; git works either way.
  });
}

export async function setOrigin(folder: string, cloneUrl: string): Promise<void> {
  const existing = await remoteUrl(folder);
  if (existing) await git(folder, ["remote", "set-url", "origin", cloneUrl]);
  else await git(folder, ["remote", "add", "origin", cloneUrl]);
}

export async function linkExistingRepo(slug: string, repoInput: string): Promise<ShipGitState> {
  await requireKnownProject(slug);
  const parsed = parseGithubRepo(repoInput);
  if (!parsed) throw new ShipError("Use owner/name or a github.com URL.");
  if (/[;&|]/.test(repoInput)) throw new ShipError("That repository URL is not allowed.");

  let folder = await resolveShipRoot(slug);
  if (!folder) {
    folder = path.join((await import("../agentos/filesystem")).agentOSRoot(), "projects", slug, "site");
    await fs.mkdir(folder, { recursive: true });
    await git(path.dirname(folder), ["clone", "--", parsed.cloneUrl, folder]);
  } else if (!(await isRepository(folder))) {
    const entries = await fs.readdir(folder).catch(() => []);
    if (entries.length === 0) {
      await git(path.dirname(folder), ["clone", "--", parsed.cloneUrl, folder]);
    } else {
      try {
        await git(folder, ["init", "-b", "main"]);
      } catch {
        await git(folder, ["init"]);
      }
      await setOrigin(folder, parsed.cloneUrl);
    }
  } else {
    await setOrigin(folder, parsed.cloneUrl);
  }

  await persistFolder(slug, folder);
  await rememberGithub(slug, { owner: parsed.owner, name: parsed.name, fullName: parsed.fullName, htmlUrl: parsed.htmlUrl });
  return readShipGit(slug);
}

export async function createGithubRepo(slug: string, name?: string): Promise<ShipGitState> {
  await requireKnownProject(slug);
  const folder = await requireShipRoot(slug);
  const gitState = await initShipRepo(slug);
  const token = await resolveGithubToken();
  if (!token) throw new ShipError(GITHUB_SETUP_HINT, 409);

  const repoName = (name?.trim() || slug).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
  const deps = publishEnv(token);
  const ensured = await ensurePrivateRepo(repoName, `AgentOS project ${slug}`, deps).catch((error: unknown) => {
    if (error instanceof PublishError) throw new ShipError(error.message, 409);
    throw error;
  });
  const remote: GithubRepo = ensured.repo;
  await setOrigin(folder, `https://github.com/${remote.fullName}.git`);
  const commit = await headCommit(folder);
  if (!commit) throw new ShipError("The folder has nothing to push yet. Add files and try again.", 409);
  const branch = gitState.branch || "main";
  try {
    await pushRef(folder, remote, commit, branch, false, deps);
  } catch (error) {
    if (error instanceof PublishError) throw new ShipError(error.message, 409);
    throw error;
  }
  await persistFolder(slug, folder);
  await rememberGithub(slug, { owner: remote.owner, name: remote.name, fullName: remote.fullName, htmlUrl: remote.htmlUrl });
  return readShipGit(slug);
}

export async function pullShipRepo(slug: string): Promise<{ git: ShipGitState; message: string }> {
  const folder = await requireShipRoot(slug);
  const result = await pullChanges(folder);
  if (!result.success) throw new ShipError(result.message, 409);
  return { git: await readShipGit(slug), message: result.message };
}

export async function pushShipRepo(slug: string): Promise<{ git: ShipGitState; message: string }> {
  const folder = await requireShipRoot(slug);
  const token = await resolveGithubToken();
  const origin = await remoteUrl(folder);
  const parsed = origin ? parseGithubRepo(origin) : undefined;
  const commit = await headCommit(folder);
  const branch = (await readShipGit(slug)).branch || "main";
  if (token && parsed && commit) {
    try {
      await pushRef(folder, { ...parsed, private: true, defaultBranch: branch }, commit, branch, false, publishEnv(token));
      return { git: await readShipGit(slug), message: `Pushed ${branch} to ${parsed.fullName}` };
    } catch (error) {
      if (error instanceof Error && /Authentication|Permission|token/i.test(error.message)) {
        throw new ShipError(error.message, 409);
      }
    }
  }
  const result = await pushChanges(folder);
  if (!result.success) throw new ShipError(result.message.includes("Authentication") ? `${result.message} ${GITHUB_SETUP_HINT}` : result.message, 409);
  return { git: await readShipGit(slug), message: result.message };
}
