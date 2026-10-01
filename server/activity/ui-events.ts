import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ActivityEvent,
  ActivityLevel,
  ActivitySource,
} from "../../shared/agentos-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * The events nothing else records.
 *
 * Most of the timeline is aggregated from state that already exists — files in
 * the vault, Hermes' sessions, Hermes' cron history. A few things leave no
 * trace anywhere: a decision on an approval, a session being branched, a run
 * reaching its end. Those are appended here, once, as they happen.
 *
 * Append-only JSONL, outside the vault, alongside the session map. It records
 * *decisions and outcomes*, never interactions — no clicks, no navigation, no
 * keystrokes. A line that cannot be read is skipped rather than failing the
 * timeline.
 */

function activityFile(): string {
  return path.join(uiStateDir(), "activity.jsonl");
}

/** Only the tail is ever read; the file is a log, not a database. */
const TAIL_BYTES = 256 * 1024;

/**
 * Every event the system may record, and how each one reads.
 *
 * A closed vocabulary is the point: the browser reports *what happened* and
 * this table decides *how it is worded*, so nothing can write arbitrary prose
 * into an audit trail.
 */
interface EventDescriptor {
  source: ActivitySource;
  level: ActivityLevel;
  title: string;
  /** Whether the browser may report this event, or only the adapter itself. */
  reportable?: boolean;
}

export const EVENT_TYPES = {
  "run.started": {
    source: "hermes",
    level: "info",
    title: "Hermes run started",
  },
  "run.completed": {
    source: "hermes",
    level: "success",
    title: "Hermes run completed",
    reportable: true,
  },
  "run.failed": {
    source: "hermes",
    level: "error",
    title: "Hermes run failed",
    reportable: true,
  },
  "run.cancelled": {
    source: "hermes",
    level: "warning",
    title: "Hermes run stopped",
    reportable: true,
  },
  "approval.accepted": {
    source: "user",
    level: "success",
    title: "Approved a Hermes action",
  },
  "approval.denied": {
    source: "user",
    level: "warning",
    title: "Denied a Hermes action",
  },
  "session.created": {
    source: "user",
    level: "info",
    title: "New Hermes session started",
  },
  "session.forked": {
    source: "user",
    level: "info",
    title: "Hermes session branched",
  },
  "automation.run": {
    source: "user",
    level: "info",
    title: "Automation run by hand",
    reportable: true,
  },
  "design.added": {
    source: "user",
    level: "info",
    title: "Image added to the design library",
  },
  // Delegated work, filed under the layer that did it rather than under any
  // one runner: the description names the worker that actually ran.
  "worker.started": {
    source: "worker",
    level: "info",
    title: "Worker job started",
  },
  "worker.completed": {
    source: "worker",
    level: "success",
    title: "Worker job completed",
  },
  "worker.failed": {
    source: "worker",
    level: "error",
    title: "Worker job failed",
  },
  "worker.cancelled": {
    source: "worker",
    level: "warning",
    title: "Worker job cancelled",
  },
  // Design references read as project context, and the brief that can come
  // out of it. Filed under Hermes for the reading and the operator for the
  // write: a review is an opinion, and putting one in the vault is a decision.
  "design.reviewed": {
    source: "hermes",
    level: "info",
    title: "Design references reviewed",
  },
  "design.generated": {
    source: "hermes",
    level: "info",
    title: "Design concepts generated",
  },
  // Motion studio films, rendered by Claude Code on the operator's plan.
  "motion.started": {
    source: "worker",
    level: "info",
    title: "Motion video started",
  },
  "motion.completed": {
    source: "worker",
    level: "success",
    title: "Motion video rendered",
  },
  "motion.failed": {
    source: "worker",
    level: "error",
    title: "Motion video failed",
  },
  "design.brief.saved": {
    source: "user",
    level: "success",
    title: "Design brief saved to project",
  },
  // A project task entering the worker pipeline, and leaving it. Filed by who
  // acted: the operator delegates and closes, Hermes scopes. The chain from a
  // line in TASKS.md to integrated code is only legible if each hand-off is
  // its own event rather than one "task done" at the end.
  "task.scoped": {
    source: "hermes",
    level: "info",
    title: "Task scoped for delegation",
  },
  "task.delegated": {
    source: "user",
    level: "info",
    title: "Task delegated",
  },
  "task.completed": {
    source: "user",
    level: "success",
    title: "Task marked complete",
  },
  // The workspace edited by hand. Filed under the operator because that is
  // exactly what distinguishes them: an agent's change to the same files goes
  // through an approval and is recorded as Hermes' doing, and a timeline that
  // could not tell the two apart would make the approval model unauditable.
  "project.created": {
    source: "user",
    level: "success",
    title: "Project created",
  },
  "project.archived": {
    source: "user",
    level: "info",
    title: "Project archived",
  },
  "task.created": {
    source: "user",
    level: "info",
    title: "Task created",
  },
  "task.updated": {
    source: "user",
    level: "info",
    title: "Tasks updated",
  },
  "project.configured": {
    source: "user",
    level: "info",
    title: "Project settings changed",
  },
  "project.planned": {
    source: "hermes",
    level: "info",
    title: "Project plan proposed",
  },
  "milestone.created": {
    source: "user",
    level: "info",
    title: "Milestone created",
  },
  "milestone.completed": {
    source: "user",
    level: "success",
    title: "Milestone completed",
  },
  "milestone.planned": {
    source: "hermes",
    level: "info",
    title: "Milestone plan proposed",
  },
  "milestone.plan.applied": {
    source: "user",
    level: "info",
    title: "Milestone plan applied",
  },
  // Who chose the worker, recorded before the worker did anything. Filed under
  // Hermes because that is who is normally deciding; when it fell back to the
  // record instead, the event's own metadata says so rather than the timeline
  // crediting Hermes with a decision it did not make.
  // The process, not the worker, is the actor here: the run was killed by a
  // restart or a signal, and a stall is the watch noticing silence. Warnings,
  // because both are things the operator should act on rather than wait out.
  // Filed under the worker or Hermes that wrote it; a document a person
  // creates is recorded by the documents route as the operator's own doing.
  "document.created": {
    source: "worker",
    level: "success",
    title: "Document created",
  },
  // A person adding a note to the Obsidian vault from Memory.
  "memory.note_created": {
    source: "user",
    level: "success",
    title: "Note added to memory",
  },
  "memory.note_edited": {
    source: "user",
    level: "info",
    title: "Memory edited",
  },
  "memory.note_archived": {
    source: "user",
    level: "info",
    title: "Memory archived",
  },
  "memory.note_restored": {
    source: "user",
    level: "success",
    title: "Memory restored",
  },
  "memory.edit_undone": {
    source: "user",
    level: "warning",
    title: "Memory edit undone",
  },
  // Agents propose; a person saves. Filed under the person for that reason.
  "memory.proposal_saved": {
    source: "user",
    level: "success",
    title: "Proposed memory saved",
  },
  "memory.proposal_dismissed": {
    source: "user",
    level: "info",
    title: "Proposed memory dismissed",
  },
  "status.updated": {
    source: "user",
    level: "info",
    title: "Project status updated",
  },
  "friction.reported": {
    source: "user",
    level: "info",
    title: "Friction reported",
  },
  "friction.updated": {
    source: "user",
    level: "info",
    title: "Friction item updated",
  },
  "document.saved": {
    source: "user",
    level: "info",
    title: "Document saved",
  },
  "worker.interrupted": {
    source: "worker",
    level: "warning",
    title: "Worker job interrupted",
  },
  "worker.stalled": {
    source: "worker",
    level: "warning",
    title: "Worker job stalled",
  },
  "worker.fallback": {
    source: "worker",
    level: "warning",
    title: "Fell back to another worker",
  },
  "worker.routed": {
    source: "hermes",
    level: "info",
    title: "Worker selected",
  },
  // The review and approval chain. Filed by who actually acted: Hermes
  // reviewed, a person decided, AgentOS integrated. A timeline that credited
  // all of it to one actor would hide the separation the design depends on.
  "worker.review.started": {
    source: "hermes",
    level: "info",
    title: "Worker review started",
  },
  "worker.review.passed": {
    source: "hermes",
    level: "success",
    title: "Worker review passed",
  },
  "worker.review.changes": {
    source: "hermes",
    level: "warning",
    title: "Worker review asked for changes",
  },
  "worker.review.blocked": {
    source: "hermes",
    level: "error",
    title: "Worker review could not reach a verdict",
  },
  // Visual verification is filed separately from code review, because it is a
  // separate finding by a separate method. "The diff is fine" and "the screen
  // is wrong" are both true often enough that a timeline has to keep them
  // apart.
  "worker.visual.passed": {
    source: "hermes",
    level: "success",
    title: "Visual verification passed",
  },
  "worker.visual.changes": {
    source: "hermes",
    level: "warning",
    title: "Visual verification found issues",
  },
  "worker.visual.unverifiable": {
    source: "agentos",
    level: "warning",
    title: "Implementation could not be verified visually",
  },
  "worker.revision.requested": {
    source: "user",
    level: "info",
    title: "Revision sent back to the worker",
  },
  "worker.visual.revision.requested": {
    source: "user",
    level: "info",
    title: "Visual revision sent back to the worker",
  },
  "worker.approved": {
    source: "user",
    level: "success",
    title: "Implementation approved",
  },
  "worker.rejected": {
    source: "user",
    level: "warning",
    title: "Implementation rejected",
  },
  "worker.integrated": {
    source: "agentos",
    level: "success",
    title: "Worker changes integrated",
  },
  "worker.validated": {
    source: "agentos",
    level: "success",
    title: "Validation passed after integration",
  },
  // Operator runs: one request, planned and executed. The description names
  // the request; the run page has the rest.
  "operator.started": {
    source: "agentos",
    level: "info",
    title: "Operator run started",
  },
  "operator.completed": {
    source: "agentos",
    level: "success",
    title: "Operator run completed",
  },
  "operator.blocked": {
    source: "agentos",
    level: "warning",
    title: "Operator run finished with steps it could not run",
  },
  "operator.failed": {
    source: "agentos",
    level: "error",
    title: "Operator run failed",
  },
  "operator.stopped": {
    source: "user",
    level: "warning",
    title: "Operator run stopped",
  },
  "worker.integration.failed": {
    source: "agentos",
    level: "error",
    title: "Worker changes could not be integrated",
  },
} as const satisfies Record<string, EventDescriptor>;

export type ActivityEventType = keyof typeof EVENT_TYPES;

/** Whether the browser is allowed to report this event type. */
export function isReportableType(value: unknown): value is ActivityEventType {
  // `hasOwn`, not `in`: `in` walks the prototype chain, so `toString` and
  // friends would be treated as declared event types.
  return (
    typeof value === "string" &&
    Object.hasOwn(EVENT_TYPES, value) &&
    (EVENT_TYPES[value as ActivityEventType] as EventDescriptor).reportable === true
  );
}

export interface RecordActivityInput {
  type: ActivityEventType;
  /** One line of detail, e.g. which automation or which project. */
  description?: string;
  project?: string;
  runId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  /**
   * When it happened, when that is not now.
   *
   * Used where an event is recorded slightly after the fact and the true order
   * matters: a task is delegated before its worker starts, but the job has to
   * exist before the delegation can be written down. Without this the timeline
   * would show the worker starting first, which reads as the machine acting
   * before anyone asked it to.
   */
  timestamp?: string;
}

function buildEvent(input: RecordActivityInput): ActivityEvent {
  const descriptor: EventDescriptor = EVENT_TYPES[input.type];

  return {
    id: `ui-${randomUUID()}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    source: descriptor.source,
    level: descriptor.level,
    type: input.type,
    title: descriptor.title,
    description: input.description,
    project: input.project,
    runId: input.runId,
    sessionId: input.sessionId,
    metadata: input.metadata,
  };
}

/**
 * Appends one event.
 *
 * Recording never throws into the path it observes: an approval that Hermes
 * accepted must not be reported as failed because a log line could not be
 * written. A failure here is logged and swallowed.
 */
export async function recordActivity(
  input: RecordActivityInput,
): Promise<ActivityEvent | undefined> {
  const event = buildEvent(input);

  try {
    await fs.mkdir(uiStateDir(), { recursive: true });
    // `appendFile` with a single write keeps concurrent appends line-atomic at
    // these sizes; the store is a log, and a lock would buy nothing.
    await fs.appendFile(activityFile(), `${JSON.stringify(event)}\n`, "utf8");
    return event;
  } catch (error) {
    console.error("[agentos] could not record activity:", error);
    return undefined;
  }
}

const SOURCES = new Set<ActivitySource>([
  "user",
  "hermes",
  "automation",
  "agentos",
  "worker",
  "grok",
]);

const LEVELS = new Set<ActivityLevel>(["info", "success", "warning", "error"]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Reads one stored line, returning `undefined` for anything unusable. */
export function readStoredEvent(line: string): ActivityEvent | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) return undefined;

  const source = parsed as Record<string, unknown>;
  const id = asString(source.id);
  const timestamp = asString(source.timestamp);
  const title = asString(source.title);

  if (!id || !timestamp || !title) return undefined;

  const level = source.level as ActivityLevel;
  const kind = source.source as ActivitySource;

  return {
    id,
    timestamp,
    source: SOURCES.has(kind) ? kind : "user",
    level: LEVELS.has(level) ? level : "info",
    type: asString(source.type) ?? "activity",
    title,
    description: asString(source.description),
    project: asString(source.project),
    runId: asString(source.runId),
    sessionId: asString(source.sessionId),
  };
}

/**
 * The most recent recorded events, newest first.
 *
 * Only the tail of the file is read, so a long-lived log costs the same as a
 * new one. A missing file means nothing has been recorded yet, which is a
 * normal state rather than a failure.
 */
export async function readUiEvents(limit: number): Promise<ActivityEvent[]> {
  let contents: string;

  try {
    const handle = await fs.open(activityFile(), "r");

    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      contents = buffer.toString("utf8");

      // A tail read can begin mid-line; that partial line is not an event.
      if (start > 0) contents = contents.slice(contents.indexOf("\n") + 1);
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }

  return contents
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(readStoredEvent)
    .filter((event): event is ActivityEvent => event !== undefined)
    .reverse()
    .slice(0, limit);
}
