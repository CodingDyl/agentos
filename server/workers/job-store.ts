import fs from "node:fs/promises";
import path from "node:path";
import {
  WorkerEventSchema,
  WorkerJobSchema,
  type WorkerEvent,
  type WorkerJob,
} from "../../shared/worker-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Where jobs are kept.
 *
 * This is execution history, not knowledge: what a worker did, and when. It
 * lives in `~/.agentos-ui`, never in the vault — the vault records decisions a
 * person made, and a job log is not one of those. If a result turns out to
 * matter, Hermes can promote it into AgentOS deliberately.
 *
 * One file per job for its state, and a JSONL alongside it for its events, so
 * a long-running job appends rather than rewriting a growing document.
 */

export function jobsDir(): string {
  return path.join(uiStateDir(), "jobs");
}

/** Job ids are generated here, so a path is never built from caller input. */
function jobFile(id: string): string {
  return path.join(jobsDir(), `${id}.json`);
}

function eventsFile(id: string): string {
  return path.join(jobsDir(), `${id}.events.jsonl`);
}

/** Rejects any id that is not one this module would have generated. */
function assertSafeId(id: string): void {
  if (!/^job_[A-Za-z0-9_-]{4,64}$/.test(id)) {
    throw new Error(`Invalid job id: ${id}`);
  }
}

export function createJobId(): string {
  return `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Writes a job atomically.
 *
 * A job record is the only account of what was delegated; a half-written one
 * would leave a worktree nobody could explain.
 */
let saveCounter = 0;

export async function saveJob(job: WorkerJob): Promise<void> {
  assertSafeId(job.id);
  await fs.mkdir(jobsDir(), { recursive: true });

  const target = jobFile(job.id);
  // Unique per write, not per process: two saves of the same job in flight at
  // once (a status change and a heartbeat) must not share a temporary file.
  const temporary = `${target}.${process.pid}.${(saveCounter += 1)}.tmp`;

  await fs.writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

/** Reads one job, or `undefined` when there is no such job. */
export async function readJob(id: string): Promise<WorkerJob | undefined> {
  try {
    assertSafeId(id);
    const parsed: unknown = JSON.parse(await fs.readFile(jobFile(id), "utf8"));
    const result = WorkerJobSchema.safeParse(parsed);

    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every job, newest first.
 *
 * A record that cannot be read is skipped rather than failing the listing: one
 * bad file must not hide the rest of the history.
 */
export async function listJobs(limit = 50): Promise<WorkerJob[]> {
  let entries: string[];

  try {
    entries = await fs.readdir(jobsDir());
  } catch {
    return [];
  }

  const ids = entries
    .filter((entry) => entry.endsWith(".json") && !entry.endsWith(".events.jsonl"))
    .map((entry) => entry.replace(/\.json$/, ""));

  const jobs = await Promise.all(ids.map((id) => readJob(id)));

  return jobs
    .filter((job): job is WorkerJob => job !== undefined)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

/**
 * Appends one event.
 *
 * Recording never throws into the run it observes: a job that actually did the
 * work must not be reported as failed because a log line could not be written.
 */
export async function appendEvent(event: WorkerEvent): Promise<void> {
  try {
    assertSafeId(event.jobId);
    await fs.mkdir(jobsDir(), { recursive: true });
    await fs.appendFile(
      eventsFile(event.jobId),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  } catch (error) {
    console.error("[agentos] could not record a worker event:", error);
  }
}

/** A job's recorded events, oldest first. Unreadable lines are skipped. */
export async function readEvents(id: string): Promise<WorkerEvent[]> {
  let contents: string;

  try {
    assertSafeId(id);
    contents = await fs.readFile(eventsFile(id), "utf8");
  } catch {
    return [];
  }

  return contents
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const result = WorkerEventSchema.safeParse(JSON.parse(line));
        return result.success ? [result.data] : [];
      } catch {
        return [];
      }
    });
}
