import fs from "node:fs/promises";
import path from "node:path";
import {
  currentBranch,
  git,
  gitCommonDir,
  gitDir,
  gitToplevel,
  headCommit,
  isClean,
  isRepository,
  repositoryProblem,
  uncommittedFiles,
} from "../agentos/git";
import { uiStateDir } from "../agentos/session-store";

// Re-exported because these are repository questions rather than worktree
// ones, and they now live in the git layer. Callers that already ask this
// module for them keep working.
export { currentBranch, headCommit, isClean, isRepository };

/**
 * Isolation for coding jobs.
 *
 * A worker never edits the live working copy. It gets its own git worktree on
 * its own branch, so whatever it does can be reviewed as a diff, kept, or
 * thrown away without touching what the operator has open. This is the rule
 * that makes delegating implementation safe at all.
 *
 * Worktrees live beside the other UI state rather than inside the repository:
 * a worker's scratch space is not something the repository should carry.
 */

export function worktreeRoot(): string {
  return path.join(uiStateDir(), "worktrees");
}

/** Branch names are derived from the job id, never from operator text. */
function branchFor(jobId: string): string {
  return `agentos-worker/${jobId}`;
}

export interface WorktreeHandle {
  path: string;
  branch: string;
  baseRef: string;
  /** The branch the work will eventually be merged back into. */
  targetBranch: string;
  /** Directory the worker should treat as cwd (the project, not a parent vault). */
  cwd: string;
  gitDir?: string;
  gitCommonDir?: string;
}

/**
 * Creates an isolated checkout for one job.
 *
 * The base is resolved to a commit before branching, so a job records exactly
 * what it started from rather than "whatever HEAD was at the time".
 */
export async function createWorktree(
  repoPath: string,
  jobId: string,
  baseRef = "HEAD",
): Promise<WorktreeHandle> {
  const gitRoot = (await gitToplevel(repoPath)) ?? repoPath;

  if (!(await isRepository(gitRoot))) {
    throw new Error(await repositoryProblem(repoPath));
  }

  let resolvedBase: string;

  try {
    const { stdout } = await git(gitRoot, ["rev-parse", baseRef]);
    resolvedBase = stdout.trim();
  } catch {
    throw new Error(`Could not resolve ${baseRef} in ${gitRoot}.`);
  }

  const target = path.join(worktreeRoot(), jobId);
  const branch = branchFor(jobId);

  await fs.mkdir(worktreeRoot(), { recursive: true });

  try {
    await git(gitRoot, ["worktree", "add", "-b", branch, target, resolvedBase]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not create a worktree for ${jobId}: ${detail}`, {
      cause: error,
    });
  }

  // What the work will merge back into. Recorded now rather than at
  // integration time, so a job says which branch it was ever meant for.
  const targetBranch = (await currentBranch(gitRoot)) ?? "HEAD";
  const cwd = await projectDirIn(target, repoPath);
  const dir = await gitDir(target);
  const common = await gitCommonDir(target);

  return {
    path: target,
    branch,
    baseRef: resolvedBase,
    targetBranch,
    cwd,
    gitDir: dir,
    gitCommonDir: common,
  };
}

/**
 * Commits everything in a worker's worktree.
 *
 * Workers are denied `git commit` outright; this is the one place a commit is
 * made, by AgentOS, after a person approved the work. Identity is set on the
 * command rather than in config so the commit never depends on what the
 * operator happens to have configured globally.
 */
export async function commitWorktree(
  worktreePath: string,
  message: string,
): Promise<string> {
  await git(worktreePath, ["add", "-A"]);

  // A retry that continues earlier work can finish with nothing new to commit:
  // the work is already the branch's tip, and `git commit` refuses to make an
  // empty one. The tip is then what gets integrated.
  if (!(await git(worktreePath, ["status", "--porcelain"])).stdout.trim()) {
    const tip = await headCommit(worktreePath);
    if (tip) return tip;
  }

  await git(worktreePath, [
      "-c",
      "user.name=AgentOS",
      "-c",
      "user.email=agentos@localhost",
      "commit",
      "--no-verify",
      "-m",
      message,
  ]);

  const commit = await headCommit(worktreePath);

  if (!commit) throw new Error("The worker commit could not be read back.");

  return commit;
}

/** Scratch space a worker leaves behind that a retry should not inherit. */
const SNAPSHOT_EXCLUDES = [":(glob)**/.scratch/**", ":(glob)**/node_modules/**"];

/** Files above this stay out of a snapshot: renders and caches, not work. */
const SNAPSHOT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Commits an unfinished attempt's work on its own branch, so a retry can start
 * from it instead of from nothing.
 *
 * Only for a job that died (quota, crash, cancel): nobody reviewed this, and
 * it never reaches the source branch except through the retry's own review.
 * Scratch directories and very large files are left out. Returns the commit
 * the retry should branch from, or `undefined` when there was nothing to keep.
 */
export async function snapshotWorktree(
  worktreePath: string,
  message: string,
): Promise<string | undefined> {
  if (!(await isRepository(worktreePath))) return undefined;

  await git(worktreePath, ["add", "-A"]);
  await git(worktreePath, ["reset", "-q", "--", ...SNAPSHOT_EXCLUDES]).catch(() => undefined);

  const { stdout } = await git(worktreePath, ["diff", "--cached", "--name-only", "-z"]);
  const staged = stdout.split("\0").filter(Boolean);
  const oversize: string[] = [];
  for (const file of staged) {
    const stat = await fs.stat(path.join(worktreePath, file)).catch(() => undefined);
    if (stat && stat.size > SNAPSHOT_MAX_FILE_BYTES) oversize.push(file);
  }
  if (oversize.length > 0) await git(worktreePath, ["reset", "-q", "--", ...oversize]);

  // Nothing new to keep: the attempt's own base is still the right start.
  if (staged.length === oversize.length) return (await headCommit(worktreePath)) ?? undefined;

  await git(worktreePath, [
    "-c",
    "user.name=AgentOS",
    "-c",
    "user.email=agentos@localhost",
    "commit",
    "--no-verify",
    "-m",
    message,
  ]);

  return (await headCommit(worktreePath)) ?? undefined;
}

/**
 * Fast-forwards the source branch onto the worker's.
 *
 * `--ff-only` is the whole point: it can only succeed when the source has not
 * moved, which means the tree that gets integrated is exactly the tree that was
 * reviewed. A merge that had to resolve anything would produce code nobody
 * reviewed, so git is asked to refuse instead.
 */
export async function fastForward(
  repoPath: string,
  branch: string,
): Promise<void> {
  try {
    await git(repoPath, ["merge", "--ff-only", branch]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw new Error(
      `The reviewed work could not be fast-forwarded onto ${branch}: ${detail}`,
      { cause: error },
    );
  }
}

/**
 * Removes a job's worktree and its branch.
 *
 * Only called for work that produced nothing worth reviewing — a finished job's
 * worktree is the thing Hermes and the operator look at, so it stays until
 * somebody decides otherwise.
 */
export async function removeWorktree(
  repoPath: string,
  jobId: string,
): Promise<void> {
  const target = path.join(worktreeRoot(), jobId);
  const gitRoot = (await gitToplevel(repoPath)) ?? repoPath;

  try {
    await git(gitRoot, ["worktree", "remove", "--force", target]);
  } catch {
    // Already gone, or never created — which is the state we wanted.
  }

  try {
    await git(gitRoot, ["branch", "-D", branchFor(jobId)]);
  } catch {
    // Same: a branch that is not there needs no deleting.
  }
}

/**
 * Where a job's own project sits inside its checkout.
 *
 * A job's repository can be a subfolder of a larger git repository (a site in
 * the vault, a package in a monorepo). The worktree is a checkout of the whole
 * repository, so the project is at the same subpath inside it. Commands that
 * belong to the project (`npm run build`) must run there; at the worktree root
 * there is no package.json and they fail at once, whatever the worker built.
 */
export async function projectDirIn(
  worktreePath: string,
  sourceRepoPath: string | undefined,
): Promise<string> {
  if (!sourceRepoPath) return worktreePath;

  try {
    const { stdout } = await git(sourceRepoPath, ["rev-parse", "--show-prefix"]);
    const prefix = stdout.trim();
    if (!prefix) return worktreePath;

    const target = path.join(worktreePath, prefix.replace(/\/$/, ""));
    await fs.access(target);
    return target;
  } catch {
    return worktreePath;
  }
}

/**
 * Fast-forwards this checkout onto later commits on `branch`.
 *
 * AgentOS does this outside the worker sandbox. Workers are told not to run
 * git fetch, pull or merge: those need the gitdir, which a workspace-write
 * sandbox cannot see unless extra writable roots were granted.
 */
export async function bringWorktreeUpToDate(
  worktreePath: string,
  branch: string | undefined,
): Promise<string | undefined> {
  if (!branch || branch === "HEAD") return undefined;

  try {
    await git(worktreePath, ["fetch", "--quiet", "origin", branch]);
  } catch {
    // No remote, no network, or the branch is only local. Local merge still applies.
  }

  try {
    await git(worktreePath, ["merge", "--ff-only", branch]);
  } catch {
    return undefined;
  }

  return (await headCommit(worktreePath)) ?? undefined;
}

/**
 * The commit a worker moved its checkout to by pulling, or `undefined`.
 *
 * AgentOS now fast-forwards the checkout itself. A worker that still managed
 * to pull (an older prompt, a tool that slipped through) is handled the same
 * way: HEAD that has moved past the base can only be commits that already
 * existed, so they become the new base rather than the worker's work.
 */
export async function pulledBase(worktreePath: string, baseCommit: string | undefined): Promise<string | undefined> {
  if (!baseCommit) return undefined;

  const head = await headCommit(worktreePath);
  if (!head || head === baseCommit) return undefined;

  try {
    await git(worktreePath, ["merge-base", "--is-ancestor", baseCommit, head]);
    return head;
  } catch {
    return undefined;
  }
}

/** Files the worker changed, relative to the branch point. */
export async function changedFiles(worktreePath: string): Promise<string[]> {
  return (await uncommittedFiles(worktreePath)).map((entry) => entry.path);
}
