import fs from "node:fs/promises";
import path from "node:path";
import type { MilestoneTaskApproval } from "../../shared/delegation-types";
import { readJob } from "../workers/job-store";
import { delegateTask } from "./task-delegation";
import { uiStateDir } from "./session-store";

/**
 * The line of tasks waiting their turn in a milestone.
 *
 * Approved tasks run one at a time by default. Each job works in its own
 * worktree branched from the repository as it is when the job starts, so a
 * task started while another is still running never sees that task's code.
 * Waiting until the one before has landed makes each task build on the last.
 *
 * One line per project, kept in AgentOS's own state like the task-job links:
 * losing the file loses the queue, not any work.
 */

export interface TaskQueue {
  /** The job whose landing releases the next task. */
  waitingOn: string;
  pending: MilestoneTaskApproval[];
}

type QueueFile = Record<string, TaskQueue>;

function queueFile(): string {
  return path.join(uiStateDir(), "task-queues.json");
}

async function readQueues(): Promise<QueueFile> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(queueFile(), "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as QueueFile) : {};
  } catch {
    return {};
  }
}

async function writeQueues(queues: QueueFile): Promise<void> {
  await fs.mkdir(path.dirname(queueFile()), { recursive: true });
  await fs.writeFile(queueFile(), `${JSON.stringify(queues, null, 2)}\n`, "utf8");
}

const keyFor = (project: string) => project.trim().toLowerCase();

export async function readTaskQueue(project: string): Promise<TaskQueue | undefined> {
  return (await readQueues())[keyFor(project)];
}

/** Holds tasks behind the job that is running now. */
export async function queueTasks(
  project: string,
  waitingOn: string,
  pending: MilestoneTaskApproval[],
): Promise<void> {
  const queues = await readQueues();
  if (pending.length === 0) delete queues[keyFor(project)];
  else queues[keyFor(project)] = { waitingOn, pending };
  await writeQueues(queues);
}

/** Drops a project's waiting tasks, for an operator who wants them off the line. */
export async function clearTaskQueue(project: string): Promise<number> {
  const queues = await readQueues();
  const count = queues[keyFor(project)]?.pending.length ?? 0;
  delete queues[keyFor(project)];
  await writeQueues(queues);
  return count;
}

/** The job and every job it is a retry of, so a retry landing releases the queue too. */
async function lineage(jobId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let current: string | undefined = jobId;
  while (current && !ids.has(current)) {
    ids.add(current);
    current = (await readJob(current))?.retryOf;
  }
  return ids;
}

/**
 * Starts the next waiting task once the job in front of it has landed.
 *
 * A task that cannot start (its plan went stale) is skipped and the next one
 * is tried; the queue never stalls on a task that will not start. A job that
 * failed or was rejected does not release anything: the line waits until that
 * job, or a retry of it, lands.
 */
export async function releaseNextTask(
  project: string,
  landedJobId: string,
): Promise<{ jobId: string; taskId: string } | undefined> {
  const queues = await readQueues();
  const queue = queues[keyFor(project)];
  if (!queue) return undefined;
  if (!(await lineage(landedJobId)).has(queue.waitingOn)) return undefined;

  const pending = [...queue.pending];
  while (pending.length > 0) {
    const next = pending.shift()!;
    const { job, error } = await delegateTask(project, next.taskId, {
      plan: next.plan,
      worker: next.worker,
      routing: next.routing,
      repoPath: next.repoPath,
      routingMode: next.routingMode,
      manualOptionId: next.manualOptionId,
    });

    if (job) {
      await queueTasks(project, job.id, pending);
      return { jobId: job.id, taskId: next.taskId };
    }

    console.error(`[agentos] queued task ${next.taskId} could not start: ${error ?? "unknown error"}`);
  }

  await queueTasks(project, queue.waitingOn, []);
  return undefined;
}
