import type { TaskCompletionProposal } from "../../shared/delegation-types";
import type { WorkerJob } from "../../shared/worker-types";
import { readOptionalFile, writeAgentOSFile } from "./filesystem";

/**
 * Closing a task, once the work is actually finished.
 *
 * The rule this module exists to enforce: **a task closes on integration, not
 * on a claim.** Not when the worker says it is done, not when validation
 * passes, not when Hermes passes the review. Those are all evidence. What
 * closes a task is a person approving it and the change landing in the
 * repository — anything less would put a tick in a hand-written file against
 * work that is not in the codebase.
 *
 * The edit itself is as small as it can be. One line changes, the box goes
 * from `[ ]` to `[x]`, and every other byte of the file is left exactly as the
 * person who wrote it left it — including the ordering, the prose between
 * sections, and whatever they had written on the task line after the title.
 */

const PROJECTS_DIR = "projects";

/** The one status that means the work is in the repository. */
const INTEGRATED = "completed";

function tasksPath(project: string): string {
  return `${PROJECTS_DIR}/${project}/TASKS.md`;
}

/**
 * Finds the line for one task id.
 *
 * Matched on the id in brackets rather than on the title, because the title is
 * what a person edits: a task renamed between delegation and completion is the
 * same task, and matching on text would silently fail to find it — or worse,
 * find a different one.
 */
function findTaskLine(
  markdown: string,
  taskId: string,
): { index: number; line: string } | undefined {
  const lines = markdown.split("\n");
  const wanted = taskId.trim().toUpperCase();

  for (const [index, line] of lines.entries()) {
    const match = /^\s*[-*+]\s+\[([ xX])\]\s+\[([A-Z][A-Z0-9]{0,7}-\d{1,5})\]/.exec(
      line,
    );

    if (match && match[2].toUpperCase() === wanted) {
      return { index, line };
    }
  }

  return undefined;
}

/** The same line with its box ticked, and nothing else touched. */
function tick(line: string): string {
  return line.replace(/\[ \]/, "[x]");
}

/**
 * Whether a task is ready to close, and what closing it would change.
 *
 * Always returns a proposal, even when the answer is no: an operator asking
 * why a task cannot be closed yet deserves the reason, not a missing button.
 */
export async function proposeCompletion(
  project: string,
  taskId: string,
  job: WorkerJob | undefined,
): Promise<TaskCompletionProposal | undefined> {
  const markdown = await readOptionalFile(tasksPath(project));
  if (!markdown) return undefined;

  const found = findTaskLine(markdown, taskId);
  if (!found) return undefined;

  const base = {
    project,
    taskId,
    before: found.line.trim(),
    after: tick(found.line).trim(),
    jobId: job?.id ?? "",
  };

  if (!job) {
    return {
      ...base,
      ready: false,
      blockedReason: "This task has not been delegated.",
    };
  }

  if (job.status !== INTEGRATED) {
    return {
      ...base,
      ready: false,
      // Named precisely, because the difference between these states is the
      // whole point: passing review is not the same as being in the codebase.
      blockedReason:
        job.status === "awaiting_review" || job.status === "reviewing"
          ? "The implementation is still waiting on review and approval."
          : job.status === "approved" || job.status === "integrating"
            ? "The implementation is approved but not integrated yet."
            : `The worker job is ${job.status.replace(/_/g, " ")}, so the work is not in the repository.`,
    };
  }

  if (/^\s*[-*+]\s+\[[xX]\]/.test(found.line)) {
    return {
      ...base,
      ready: false,
      blockedReason: "This task is already marked complete.",
    };
  }

  return { ...base, ready: true };
}

/**
 * Ticks one task off.
 *
 * Re-reads and re-checks rather than trusting the proposal it was shown: the
 * file is hand-maintained and may have changed since, and writing a stale
 * rewrite of someone's file would undo whatever they did in between.
 */
export async function applyCompletion(
  project: string,
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const markdown = await readOptionalFile(tasksPath(project));

  if (!markdown) {
    return { ok: false, error: "That project has no TASKS.md." };
  }

  const found = findTaskLine(markdown, taskId);

  if (!found) {
    return { ok: false, error: `${taskId} is not in TASKS.md.` };
  }

  if (/^\s*[-*+]\s+\[[xX]\]/.test(found.line)) {
    // Not an error worth failing on: the desired state is the actual state.
    return { ok: true };
  }

  const lines = markdown.split("\n");
  lines[found.index] = tick(found.line);

  await writeAgentOSFile(tasksPath(project), lines.join("\n"));

  return { ok: true };
}
