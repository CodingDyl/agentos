import fs from "node:fs/promises";
import path from "node:path";
import {
  git,
  gitToplevel,
  hasOwnGit,
  isGitRoot,
  isRepository,
} from "../agentos/git";

/**
 * A project's own git identity, as opposed to the vault it happens to sit in.
 *
 * Jobs must worktree from *this* repository. A site folder inside a larger
 * AgentOS vault is a git checkout of the vault, not of the site: worktree-ing
 * from there checks out the whole vault, puts git metadata outside the
 * worktree, and sandboxed workers cannot even run `git status`.
 */

const DEFAULT_GITIGNORE = [
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  "coverage/",
  ".DS_Store",
  "*.log",
  ".env",
  ".env.*",
  "!.env.example",
  ".scratch/",
  ".agentos/",
].join("\n") + "\n";

export interface ProjectRepo {
  /** The project folder the job was aimed at. */
  projectPath: string;
  /** Git root worktrees are created from. After isolation, this is the project. */
  gitRoot: string;
  /**
   * Path of the project inside `gitRoot`. Empty when they are the same folder.
   * Non-empty only as a fallback: the parent repo could not be isolated.
   */
  projectPrefix: string;
  /** True when AgentOS ran `git init` so this folder is its own repository. */
  initialized: boolean;
  /** True when the folder sat inside a larger parent repository. */
  nestedInParent: boolean;
  parentGitRoot?: string;
  /** Said out loud so the operator can see what happened, and what to do locally. */
  note?: string;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function relativePrefix(gitRoot: string, projectPath: string): string {
  const relative = path.relative(gitRoot, projectPath);
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  return relative.split(path.sep).join("/");
}

async function writeGitignoreIfMissing(projectPath: string): Promise<void> {
  const target = path.join(projectPath, ".gitignore");
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, DEFAULT_GITIGNORE, "utf8");
  }
}

async function initialCommit(projectPath: string): Promise<void> {
  await git(projectPath, ["add", "-A"]);
  const status = (await git(projectPath, ["status", "--porcelain"])).stdout.trim();
  if (!status) {
    await git(projectPath, [
      "-c",
      "user.name=AgentOS",
      "-c",
      "user.email=agentos@localhost",
      "commit",
      "--allow-empty",
      "--no-verify",
      "-m",
      "Initial commit from AgentOS",
    ]);
    return;
  }

  await git(projectPath, [
    "-c",
    "user.name=AgentOS",
    "-c",
    "user.email=agentos@localhost",
    "commit",
    "--no-verify",
    "-m",
    "Initial commit from AgentOS (project isolated from parent repository)",
  ]);
}

/**
 * Makes `projectPath` a git root we can worktree from.
 *
 * A folder that already is its own repository is left alone. A folder that
 * sits inside a larger repo, or is not a repo at all, is initialised in place
 * so worktrees are of the project, not of the vault.
 */
export async function ensureProjectRepo(projectPath: string): Promise<ProjectRepo> {
  const resolved = path.resolve(projectPath);

  if (!(await isDirectory(resolved))) {
    throw new Error(
      `${resolved} doesn't exist. If it moved, update Local repository in the workspace's settings.`,
    );
  }

  const ownGit = await hasOwnGit(resolved);
  if (ownGit && (await isGitRoot(resolved))) {
    return {
      projectPath: resolved,
      gitRoot: resolved,
      projectPrefix: "",
      initialized: false,
      nestedInParent: false,
    };
  }

  const parent = await gitToplevel(resolved);
  const nested = Boolean(parent && path.resolve(parent) !== resolved);

  await writeGitignoreIfMissing(resolved);
  await git(resolved, ["init", "-q", "-b", "main"]);
  await initialCommit(resolved);

  const note = nested
    ? `This project folder sat inside ${parent}, so AgentOS made it its own git repository. Worktrees are now of the project, not the parent vault. On the machine that owns the files, keep this folder as its own repo (or point Ship at the linked remote) so later jobs stay isolated.`
    : `This project folder was not a git repository, so AgentOS ran git init. Point Ship at a remote if you want it published.`;

  return {
    projectPath: resolved,
    gitRoot: resolved,
    projectPrefix: "",
    initialized: true,
    nestedInParent: nested,
    parentGitRoot: nested ? parent : undefined,
    note,
  };
}

/**
 * Describes how a project path relates to git, without changing anything.
 *
 * Used by tests and preflight. Launch uses `ensureProjectRepo`.
 */
export async function inspectProjectRepo(projectPath: string): Promise<{
  exists: boolean;
  isRepository: boolean;
  isGitRoot: boolean;
  hasOwnGit: boolean;
  toplevel?: string;
  nestedInParent: boolean;
}> {
  const resolved = path.resolve(projectPath);
  if (!(await isDirectory(resolved))) {
    return {
      exists: false,
      isRepository: false,
      isGitRoot: false,
      hasOwnGit: false,
      nestedInParent: false,
    };
  }

  const inside = await isRepository(resolved);
  const toplevel = inside ? await gitToplevel(resolved) : undefined;
  const root = inside ? await isGitRoot(resolved) : false;
  const own = await hasOwnGit(resolved);
  const nested = Boolean(toplevel && path.resolve(toplevel) !== resolved);

  return {
    exists: true,
    isRepository: inside,
    isGitRoot: root,
    hasOwnGit: own,
    toplevel,
    nestedInParent: nested,
  };
}

export { relativePrefix };
