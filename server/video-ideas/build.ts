import type { PlannedTask, VideoIdea } from "../../shared/video-ideas-types";
import { git } from "../agentos/git";
import { activeJobFor, delegateTask, prepareDelegation } from "../agentos/task-delegation";
import { readTaskLink } from "../agentos/task-jobs";
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
  /** A job marked failed only because its own merge restarted the server: its work is in. */
  merged: (jobId: string) => Promise<boolean>;
}

const STOPPED = new Set(["failed", "cancelled", "rejected"]);

export interface TaskLookups {
  active: (taskId: string) => Promise<{ id: string } | undefined>;
  linked: (taskId: string) => Promise<{ id: string; status: string } | undefined>;
  delegate: (taskId: string, task: PlannedTask | undefined) => Promise<{ jobId?: string; error?: string }>;
}

/**
 * The job for a task: the one it already has when it was retried (or even
 * merged) from Workers, otherwise a new one. A task is never built twice.
 */
export async function startTaskWith(taskId: string, task: PlannedTask | undefined, lookups: TaskLookups): Promise<{ jobId?: string; error?: string }> {
  const existing = await lookups.active(taskId);
  if (existing) return { jobId: existing.id };
  const linked = await lookups.linked(taskId);
  if (linked?.status === "completed") return { jobId: linked.id };
  return lookups.delegate(taskId, task);
}

/** Delegates one task to Claude Code. Approving the idea was the delegation approval. */
async function delegate(taskId: string, task: PlannedTask | undefined): Promise<{ jobId?: string; error?: string }> {
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

async function linkedJob(taskId: string): Promise<{ id: string; status: string } | undefined> {
  const link = await readTaskLink(AGENTOS_WORKSPACE, taskId);
  const job = link ? await readJob(link.jobId) : undefined;
  return job ? { id: job.id, status: job.status } : undefined;
}

/** Interrupted mid-merge, yet its branch is already part of the checkout. */
async function mergedDespiteInterrupt(jobId: string): Promise<boolean> {
  const job = await readJob(jobId);
  if (!job || job.status !== "failed" || !job.interruptedAt || !job.workerBranch || !job.sourceRepoPath) return false;
  try {
    await git(job.sourceRepoPath, ["merge-base", "--is-ancestor", job.workerBranch, "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

export const defaultBuildDeps: BuildDeps = {
  start: (taskId, task) => startTaskWith(taskId, task, { active: (id) => activeJobFor(AGENTOS_WORKSPACE, id), linked: linkedJob, delegate }),
  status: async (jobId) => (await readJob(jobId))?.status,
  merged: mergedDespiteInterrupt,
};

export async function advanceBuild(idea: VideoIdea, deps: BuildDeps = defaultBuildDeps): Promise<VideoIdea> {
  let current = idea.currentTask ?? 0;
  let runs = idea.runs;

  if (idea.jobId) {
    const reported = await deps.status(idea.jobId);
    const status = reported === "failed" && (await deps.merged(idea.jobId)) ? "completed" : reported;
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
