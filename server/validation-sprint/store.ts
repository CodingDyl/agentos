import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ValidationFrictionSchema,
  ValidationTaskSchema,
  type ReportFriction,
  type StartValidationTask,
  type UpdateValidationTask,
  type ValidationFriction,
  type ValidationTask,
} from "../../shared/validation-sprint-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Where the sprint's own record lives.
 *
 * `~/.agentos-ui/validation`, outside the vault and outside the job store.
 * That placement is the point: this is a measurement of AgentOS taken while
 * using it, not project truth, and the moment it sat in `~/AgentOS` it would
 * start looking like something the system had decided rather than something
 * the operator noticed.
 *
 * One file per task and a JSONL for friction, matching the job store — small
 * enough that no database is warranted, and append-only where it can be so two
 * reports filed seconds apart cannot lose one another.
 */

function validationDir(): string {
  return path.join(uiStateDir(), "validation");
}

function taskFile(id: string): string {
  return path.join(validationDir(), `${id}.json`);
}

function frictionFile(): string {
  return path.join(validationDir(), "friction.jsonl");
}

/** Rejects any id this module would not have generated. */
function assertSafeId(id: string): void {
  if (!/^vt_[A-Za-z0-9_-]{4,64}$/.test(id)) {
    throw new Error(`Invalid validation task id: ${id}`);
  }
}

function createTaskId(): string {
  return `vt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Writes a task atomically. A half-written record would misreport the sprint. */
async function saveTask(task: ValidationTask): Promise<void> {
  assertSafeId(task.taskId);
  await fs.mkdir(validationDir(), { recursive: true });

  const target = taskFile(task.taskId);
  const temporary = `${target}.${process.pid}.tmp`;

  await fs.writeFile(temporary, `${JSON.stringify(task, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

export async function readTask(id: string): Promise<ValidationTask | undefined> {
  try {
    assertSafeId(id);
    const parsed: unknown = JSON.parse(await fs.readFile(taskFile(id), "utf8"));
    const result = ValidationTaskSchema.safeParse(parsed);

    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every task, oldest first.
 *
 * Oldest first because a sprint is read as a sequence — "task 1 took 42
 * minutes, task 4 took 12" is the finding, and reversing it would hide the
 * trend the sprint exists to look for. An unreadable record is skipped rather
 * than failing the read: one bad file must not hide the other four.
 */
export async function listTasks(): Promise<ValidationTask[]> {
  let entries: string[];

  try {
    entries = await fs.readdir(validationDir());
  } catch {
    return [];
  }

  const ids = entries
    .filter((entry) => entry.startsWith("vt_") && entry.endsWith(".json"))
    .map((entry) => entry.replace(/\.json$/, ""));

  const tasks = await Promise.all(ids.map((id) => readTask(id)));

  return tasks
    .filter((task): task is ValidationTask => task !== undefined)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

export async function startTask(
  input: StartValidationTask,
): Promise<ValidationTask> {
  const task: ValidationTask = {
    taskId: createTaskId(),
    project: input.project,
    label: input.label,
    kind: input.kind,
    jobId: input.jobId,
    startedAt: new Date().toISOString(),
    outcome: "in_progress",
    interventions: [],
  };

  await saveTask(task);
  return task;
}

/**
 * Applies one change to a task.
 *
 * `intervention` appends; everything else replaces. That asymmetry is
 * deliberate — the interventions list is the sprint's most valuable evidence
 * and the easiest to lose, so there is no request shape that can shorten it.
 *
 * `completedAt` is set by the outcome rather than by the caller: a task is
 * finished when it reaches a terminal outcome, and letting those two disagree
 * would produce durations for tasks that are still running.
 */
export async function updateTask(
  id: string,
  input: UpdateValidationTask,
): Promise<ValidationTask | undefined> {
  const existing = await readTask(id);
  if (!existing) return undefined;

  const outcome = input.outcome ?? existing.outcome;

  const next: ValidationTask = {
    ...existing,
    jobId: input.jobId ?? existing.jobId,
    outcome,
    completedAt:
      outcome === "in_progress"
        ? undefined
        : (existing.completedAt ?? new Date().toISOString()),
    verdict: input.verdict ?? existing.verdict,
    verdictNote: input.verdictNote ?? existing.verdictNote,
    interventions: input.intervention
      ? [
          ...existing.interventions,
          { ...input.intervention, at: new Date().toISOString() },
        ]
      : existing.interventions,
  };

  await saveTask(next);
  return next;
}

/**
 * Records one friction report.
 *
 * Unlike the rest of this store, a failure here is swallowed and logged: a
 * report is filed *while* doing something else, and losing the operator's
 * place in a review because a log line could not be written would be a worse
 * outcome than losing the line.
 */
export async function reportFriction(
  input: ReportFriction,
): Promise<ValidationFriction | undefined> {
  const entry: ValidationFriction = {
    id: `fr-${randomUUID()}`,
    reportedAt: new Date().toISOString(),
    category: input.category,
    note: input.note?.trim() || undefined,
    taskId: input.taskId,
    jobId: input.jobId,
    project: input.project,
    surface: input.surface,
  };

  try {
    await fs.mkdir(validationDir(), { recursive: true });
    await fs.appendFile(frictionFile(), `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  } catch (error) {
    console.error("[agentos] could not record friction:", error);
    return undefined;
  }
}

/** Every friction report, newest first. Unreadable lines are skipped. */
export async function listFriction(): Promise<ValidationFriction[]> {
  let contents: string;

  try {
    contents = await fs.readFile(frictionFile(), "utf8");
  } catch {
    return [];
  }

  return contents
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const result = ValidationFrictionSchema.safeParse(JSON.parse(line));
        return result.success ? [result.data] : [];
      } catch {
        return [];
      }
    })
    .reverse();
}
