import type {
  RepositoryAction,
  RepositoryStatus,
} from "../../shared/repository-types";
import { isRunning } from "../workers/job-manager";
import { listJobs } from "../workers/job-store";
import {
  currentBranch,
  git,
  headCommit,
  isClean,
  isRepository,
  listBranches,
  readRecentCommits,
  repositoryProblem,
  uncommittedFiles,
} from "./git";
import { readOptionalFile } from "./filesystem";
import { parseRepositoryPath } from "./projects";

/**
 * A project's real repository, as something the console can see and act on.
 *
 * AgentOS has always *read* git — enough to tell an operator that a job could
 * not be integrated because the repository was on the wrong branch, or dirty.
 * It could not do anything about either, so the answer was to leave the
 * console, open a terminal, and come back. This module is the other half:
 * the same facts, plus the small set of actions that resolve them.
 *
 * Two rules shape everything here.
 *
 * **Nothing is ever destroyed.** There is no discard, no hard reset, no force.
 * Uncommitted work is stashed, never dropped, so the worst outcome of any
 * button on this path is that something is somewhere the operator did not
 * expect rather than gone.
 *
 * **No rebase, and no merge that is not a fast-forward.** Those live in
 * `workers/review.ts` for a reason: a job is reviewed as a specific tree, and
 * rebasing it would integrate code nobody reviewed. Offering it here would
 * quietly remove the guarantee the whole review step exists to provide, so
 * the advanced-base blocker gets an explanation and a re-run instead of a
 * button.
 *
 * There is no model anywhere in this file. Git has exactly one right answer.
 */

/** Where a project's repository lives, from `PROJECT.md`. */
export async function repositoryPathFor(
  slug: string,
): Promise<string | undefined> {
  const markdown = await readOptionalFile(`projects/${slug}/PROJECT.md`);
  return markdown ? parseRepositoryPath(markdown) : undefined;
}

/**
 * Why a write is refused, or `undefined` when it may go ahead.
 *
 * The job check is the one that matters. Worker jobs run in this process
 * against worktrees derived from the source repository, and changing what is
 * checked out underneath a running job is how a job that looked healthy
 * produces a diff of something else entirely. A job that is live owns the
 * repository until it is not.
 */
export async function writeBlocker(
  slug: string,
  repoPath: string,
): Promise<string | undefined> {
  if (!(await isRepository(repoPath))) {
    return repositoryProblem(repoPath);
  }

  const live = (await listJobs(200)).filter(
    (job) =>
      job.project === slug &&
      job.sourceRepoPath === repoPath &&
      isRunning(job.id),
  );

  if (live.length > 0) {
    return `${
      live.length === 1 ? "A job is" : `${live.length} jobs are`
    } running against this repository. Changing it now would change what ${
      live.length === 1 ? "it is" : "they are"
    } working from.`;
  }

  return undefined;
}

/**
 * Everything the repository view shows, in one read.
 *
 * Total: a project with no linked repository, or a path that has moved, still
 * renders. `unavailable` carries the reason and every list comes back empty,
 * because a page that throws is worse than a page that explains.
 */
export async function readRepositoryStatus(
  slug: string,
): Promise<RepositoryStatus> {
  const repositoryPath = await repositoryPathFor(slug);

  const empty = {
    slug,
    repositoryPath,
    branches: [],
    uncommitted: [],
    recentCommits: [],
    pins: [],
  };

  if (!repositoryPath) {
    return {
      ...empty,
      unavailable:
        "No local repository is linked. Add one under Connected Systems in PROJECT.md.",
    };
  }

  if (!(await isRepository(repositoryPath))) {
    return { ...empty, unavailable: await repositoryProblem(repositoryPath) };
  }

  const [branch, head, clean, branches, uncommitted, recentCommits, jobs] =
    await Promise.all([
      currentBranch(repositoryPath),
      headCommit(repositoryPath),
      isClean(repositoryPath),
      listBranches(repositoryPath),
      uncommittedFiles(repositoryPath),
      readRecentCommits(repositoryPath, 15),
      listJobs(200),
    ]);

  // Which job is waiting on which branch. Only jobs that still have something
  // to integrate are worth showing — a completed or rejected job's branch is
  // history, and pinning it here would suggest there is something to do.
  const pins = jobs
    .filter(
      (job) =>
        job.project === slug &&
        job.sourceRepoPath === repositoryPath &&
        job.targetBranch &&
        ["awaiting_review", "changes_required", "running", "preparing"].includes(
          job.status,
        ),
    )
    .map((job) => ({
      jobId: job.id,
      branch: job.targetBranch as string,
      status: job.status,
      objective: job.objective,
      /** True when the branch has moved past what this job was reviewed on. */
      baseMoved: Boolean(job.baseCommit && head && job.baseCommit !== head),
      live: isRunning(job.id),
    }));

  return {
    slug,
    repositoryPath,
    branch,
    head,
    workingTree: clean ? "clean" : "modified",
    branches,
    uncommitted,
    recentCommits,
    pins,
    writeBlocker: await writeBlocker(slug, repositoryPath),
  };
}

/** What an action did, in the words the console repeats back. */
export interface ActionResult {
  ok: boolean;
  /** What actually happened, not what was intended. */
  detail: string;
  status?: RepositoryStatus;
}

function refuse(detail: string): ActionResult {
  return { ok: false, detail };
}

/** git's own complaint, first line only — it is usually the useful one. */
function gitComplaint(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);

  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("Command failed")) ??
    text.split("\n")[0]
  );
}

/**
 * Branch names AgentOS is willing to create.
 *
 * Deliberately narrower than git's own rules. Everything here eventually
 * reaches a command line, and while arguments are passed as an array and can
 * never become shell, a name beginning with `-` would still be read as a flag
 * by git itself.
 */
const BRANCH_NAME = /^(?!-)(?!\/)[A-Za-z0-9._/-]{1,120}(?<!\/)(?<!\.lock)$/;

/**
 * Runs one write against a project's repository.
 *
 * Every action funnels through here so the job guard, the refusal wording and
 * the returned status are identical whichever button was pressed.
 */
export async function runRepositoryAction(
  slug: string,
  action: RepositoryAction,
): Promise<ActionResult> {
  const repoPath = await repositoryPathFor(slug);

  if (!repoPath) return refuse("No local repository is linked to this project.");

  const blocked = await writeBlocker(slug, repoPath);
  if (blocked) return refuse(blocked);

  const withStatus = async (detail: string): Promise<ActionResult> => ({
    ok: true,
    detail,
    status: await readRepositoryStatus(slug),
  });

  try {
    switch (action.kind) {
      case "switch": {
        const branches = await listBranches(repoPath);

        if (!branches.some((entry) => entry.name === action.branch)) {
          return refuse(`${action.branch} is not a local branch.`);
        }

        // Refused rather than resolved: git would either carry the changes
        // across or refuse on conflict, and neither is something to do to an
        // operator silently. Stashing is one deliberate click away.
        if (!(await isClean(repoPath))) {
          const count = (await uncommittedFiles(repoPath)).length;

          return refuse(
            `There ${count === 1 ? "is 1 uncommitted change" : `are ${count} uncommitted changes`}. Stash or commit ${count === 1 ? "it" : "them"} first.`,
          );
        }

        await git(repoPath, ["checkout", action.branch]);
        return withStatus(`Switched to ${action.branch}.`);
      }

      case "stash": {
        const files = await uncommittedFiles(repoPath);

        if (files.length === 0) return refuse("There is nothing to stash.");

        // `-u` so untracked files travel too. Without it a switch would still
        // be blocked by exactly the files this was meant to clear.
        await git(repoPath, [
          "stash",
          "push",
          "-u",
          "-m",
          action.message?.trim() || `AgentOS: ${slug}`,
        ]);

        return withStatus(
          `Stashed ${files.length} ${files.length === 1 ? "change" : "changes"}. Restore with \`git stash pop\`.`,
        );
      }

      case "commit": {
        const message = action.message?.trim();

        if (!message) return refuse("A commit needs a message.");

        const files = await uncommittedFiles(repoPath);
        if (files.length === 0) return refuse("There is nothing to commit.");

        await git(repoPath, ["add", "-A"]);
        // Identity is the operator's here, unlike a worker commit: this is a
        // person committing their own work through a different window.
        await git(repoPath, ["commit", "-m", message]);

        return withStatus(
          `Committed ${files.length} ${files.length === 1 ? "file" : "files"} on ${await currentBranch(repoPath)}.`,
        );
      }

      case "branch": {
        const name = action.name?.trim() ?? "";

        if (!BRANCH_NAME.test(name)) {
          return refuse(
            "A branch name may use letters, numbers, dot, dash, underscore and slash, and may not start with a dash or slash.",
          );
        }

        const branches = await listBranches(repoPath);

        if (branches.some((entry) => entry.name === name)) {
          return refuse(`${name} already exists.`);
        }

        if (!(await isClean(repoPath))) {
          return refuse(
            "There are uncommitted changes. Stash or commit them first.",
          );
        }

        await git(repoPath, ["checkout", "-b", name]);
        return withStatus(`Created ${name} and switched to it.`);
      }

      default: {
        // Exhaustive: a new action must be handled, not fall through to a
        // silent success.
        const unreachable: never = action;
        return refuse(`Unknown action: ${JSON.stringify(unreachable)}`);
      }
    }
  } catch (error) {
    return refuse(gitComplaint(error));
  }
}
