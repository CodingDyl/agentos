import type { PlannedTask, VideoIdea } from "../../shared/video-ideas-types";
import { activeJobFor, delegateTask, prepareDelegation } from "../agentos/task-delegation";
import { readJob } from "../workers/job-store";
import { AGENTOS_WORKSPACE } from "./plan";
import { updateIdea } from "./store";
import { AGENTOS_REPO } from "./studio";

/**
 * Builds an approved idea's tasks one at a time.
 *
 * The next task starts only once the last one's change was approved and
 * merged (`completed`): the server runs from this checkout, and a merge that
 * touches `server/` restarts it and kills any job running beside it. A task
 * that fails, is cancelled or is turned down pauses the queue.
 */

export interface BuildDeps {
  start: (taskId: string, task: PlannedTask | undefined) => Promise<{ jobId?: string; error?: string }>;
  status: (jobId: string) => Promise<string | undefined>;
}

const STOPPED = new Set(["failed", "cancelled", "rejected"]);

/** Delegates one task to Claude Code. Approving the idea was the delegation approval. */
async function startTask(taskId: string, task: PlannedTask | undefined): Promise<{ jobId?: string; error?: string }> {
  // A task retried from Workers already has its job: carry on with that one.
  const existing = await activeJobFor(AGENTOS_WORKSPACE, taskId);
  if (existing) return { jobId: existing.id };

  const { preview, error } = await prepareDelegation(AGENTOS_WORKSPACE, taskId, "claude-code");
  if (!preview) return { error: error ?? "The task could not be prepared." };
  const plan = task
    ? {
        ...preview.plan,
        objective: task.objective,
        acceptanceCriteria: [...task.acceptanceCriteria, ...preview.plan.acceptanceCriteria],
      }
    : preview.plan;
  const { job, error: startError } = await delegateTask(AGENTOS_WORKSPACE, taskId, { plan, worker: "claude-code", repoPath: AGENTOS_REPO });
  return job ? { jobId: job.id } : { error: startError ?? "The task could not be started." };
}

export const defaultBuildDeps: BuildDeps = {
  start: startTask,
  status: async (jobId) => (await readJob(jobId))?.status,
};

export async function advanceBuild(idea: VideoIdea, deps: BuildDeps = defaultBuildDeps): Promise<VideoIdea> {
  let current = idea.currentTask ?? 0;
  let runs = idea.runs;

  if (idea.jobId) {
    const status = await deps.status(idea.jobId);
    const taskId = idea.taskIds[current];
    const ended = (state: string) => runs.map((run) => (run.jobId === idea.jobId && !run.endedAt ? { ...run, endedAt: new Date().toISOString(), status: state } : run));
    if (!status || STOPPED.has(status)) {
      return updateIdea(idea.id, {
        stage: "failed",
        failedAt: "building",
        error: `${taskId} stopped (${status ?? "missing"}) — retry it from Workers, then press Resume`,
        runs: ended(status ?? "missing"),
      });
    }
    if (status !== "completed") return idea;
    runs = ended("completed");
    current += 1;
  }

  if (current >= idea.taskIds.length) {
    return updateIdea(idea.id, { stage: "built", currentTask: current, jobId: undefined, error: undefined, failedAt: undefined, runs });
  }

  const taskId = idea.taskIds[current];
  const started = await deps.start(taskId, idea.plan?.[current]);
  if (!started.jobId) {
    return updateIdea(idea.id, {
      stage: "failed",
      failedAt: "building",
      currentTask: current,
      jobId: undefined,
      error: `${taskId} could not start: ${started.error ?? "unknown error"}`,
      runs,
    });
  }
  return updateIdea(idea.id, {
    stage: "building",
    currentTask: current,
    jobId: started.jobId,
    error: undefined,
    failedAt: undefined,
    runs: [...runs, { step: "build", worker: "Claude Code (Max plan)", jobId: started.jobId, taskId, startedAt: new Date().toISOString() }],
  });
}
