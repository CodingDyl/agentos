import type { WorkerJob } from "../../shared/worker-types";
import { recordActivity } from "../activity/ui-events";
import { completeTask } from "../agentos/mutations/tasks";
import { projectTaskLinks, saveTaskLink } from "../agentos/task-jobs";

/**
 * Marks a delegated task done once its job has landed.
 *
 * The rule in `task-completion.ts` stands: a task closes on integration, not
 * on a claim. This is called only where a job has just become `completed`,
 * which is after a person approved it, it was integrated, and it was
 * validated in the source repository. The task is ticked and moved to Done
 * through the same revision-checked writer as the checkbox, so it is backed up
 * and undoable.
 *
 * Never throws and never fails the job: the work has landed whatever happens
 * here, so a task that cannot be ticked (renamed away, file locked) is
 * reported to the caller and left for the person to tick by hand.
 */
export async function markTaskDone(job: WorkerJob): Promise<{ marked: boolean; taskId?: string; error?: string }> {
  try {
    const link = (await projectTaskLinks(job.project)).find((entry) => entry.jobId === job.id);
    // A job started from chat or the console belongs to no task.
    if (!link) return { marked: false };

    await completeTask({ slug: job.project, taskId: link.taskId });
    await saveTaskLink({ ...link, completedAt: new Date().toISOString() });

    await recordActivity({
      type: "task.completed",
      description: `${link.taskId} marked done: its worker job landed`,
      project: job.project,
      metadata: { taskId: link.taskId, jobId: job.id, automatic: true },
    });

    return { marked: true, taskId: link.taskId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[agentos] could not mark the task done after its job landed:", message);
    return { marked: false, error: message };
  }
}
