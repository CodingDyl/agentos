import fs from "node:fs/promises";
import path from "node:path";
import {
  currentBranch,
  git,
  headCommit,
  isClean,
  isRepository,
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
  if (!(await isRepository(repoPath))) {
    throw new Error(`${repoPath} is not a git repository.`);
  }

  let resolvedBase: string;

  try {
    const { stdout } = await git(repoPath, ["rev-parse", baseRef]);
    resolvedBase = stdout.trim();
  } catch {
    throw new Error(`Could not resolve ${baseRef} in ${repoPath}.`);
  }

  const target = path.join(worktreeRoot(), jobId);
  const branch = branchFor(jobId);

  await fs.mkdir(worktreeRoot(), { recursive: true });

  try {
    await git(repoPath, ["worktree", "add", "-b", branch, target, resolvedBase]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not create a worktree for ${jobId}: ${detail}`, {
      cause: error,
    });
  }

  // What the work will merge back into. Recorded now rather than at
  // integration time, so a job says which branch it was ever meant for.
  const targetBranch = (await currentBranch(repoPath)) ?? "HEAD";

  return { path: target, branch, baseRef: resolvedBase, targetBranch };
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

  try {
    await git(repoPath, ["worktree", "remove", "--force", target]);
  } catch {
    // Already gone, or never created — which is the state we wanted.
  }

  try {
    await git(repoPath, ["branch", "-D", branchFor(jobId)]);
  } catch {
    // Same: a branch that is not there needs no deleting.
  }
}

/** Files the worker changed, relative to the branch point. */
export async function changedFiles(worktreePath: string): Promise<string[]> {
  return (await uncommittedFiles(worktreePath)).map((entry) => entry.path);
}
