import type {
  MilestoneDelegationPreview,
  MilestoneDelegationResult,
  MilestoneDelegationStartRequest,
} from "../../shared/delegation-types";
import type { RoadmapTask } from "../../shared/agentos-types";
import type { WorkerId } from "../../shared/worker-types";
import { getMilestoneDetail } from "./roadmap";
import { delegateTask, prepareDelegation } from "./task-delegation";

/**
 * Why a task is left out of a milestone's batch before Hermes is ever asked
 * about it — `undefined` means it is eligible. Pulled out on its own so the
 * three rules are testable without a vault, Hermes, or a worker to run them
 * against.
 */
export function skipReasonFor(task: RoadmapTask): string | undefined {
  if (task.status === "done") return "Already done.";
  if (task.status === "blocked") return `Blocked by ${task.blockedBy.join(", ")}.`;
  if (task.status === "in_progress" || task.status === "review") return "Already has an active worker job.";
  return undefined;
}

/**
 * Batch-delegating every eligible task in a milestone.
 *
 * Two phases, same as a single task's delegation and for the same reason: a
 * plan is proposed, never started by the call that produced it (see
 * `task-delegation.ts`). This just does that N times and reports the results
 * together, so a milestone with several ready tasks is one review instead of
 * N separate trips through the single-task flow.
 *
 * Sequential, not parallel: preparing a task's plan is a Hermes call, and
 * Hermes is one local process — asking it several things at once would only
 * make every one of them slower. Once a plan is approved and started, the
 * resulting jobs *do* run in parallel (each gets its own git worktree), so
 * nothing here throttles execution — only the scoping step in front of it.
 */
export async function prepareMilestoneDelegation(
  slug: string,
  milestoneId: string,
  requestedWorker: WorkerId | "auto",
): Promise<{ preview?: MilestoneDelegationPreview; error?: string }> {
  const milestone = await getMilestoneDetail(slug, milestoneId);
  if (!milestone) return { error: `No such milestone.` };

  const ready: MilestoneDelegationPreview["ready"] = [];
  const skipped: MilestoneDelegationPreview["skipped"] = [];

  for (const task of milestone.tasks) {
    const reason = skipReasonFor(task);

    if (reason) {
      skipped.push({ taskId: task.id, taskTitle: task.title, reason });
      continue;
    }

    const { preview, error } = await prepareDelegation(slug, task.id, requestedWorker);
    ready.push({ taskId: task.id, taskTitle: task.title, preview, error });
  }

  return { preview: { milestoneId, ready, skipped } };
}

/**
 * Starts every task a person approved out of a prepared batch.
 *
 * One task failing to start (its plan grew stale, something else delegated it
 * in the meantime) does not stop the rest — each is independent, and a
 * milestone that got 4 of 5 tasks running is worth more than one that aborted
 * on the first problem.
 */
export async function startMilestoneDelegation(
  slug: string,
  request: MilestoneDelegationStartRequest,
): Promise<MilestoneDelegationResult> {
  const started: MilestoneDelegationResult["started"] = [];
  const failed: MilestoneDelegationResult["failed"] = [];

  for (const { taskId, plan, worker, routing, repoPath } of request.tasks) {
    const { job, error } = await delegateTask(slug, taskId, { plan, worker, routing, repoPath });

    if (job) started.push({ taskId, jobId: job.id });
    else failed.push({ taskId, error: error ?? "Could not start this task." });
  }

  return { started, failed };
}
