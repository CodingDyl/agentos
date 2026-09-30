import type { DelegationPlan } from "../../shared/delegation-types";
import type { ProjectTask } from "../../shared/agentos-types";
import { WorkerTaskTypeSchema } from "../../shared/worker-routing-types";
import { sendToHermes } from "./client";
import { extractJson } from "./worker-review";

/**
 * Turning a line in `TASKS.md` into a brief a worker can act on.
 *
 * This is the step where Hermes does the job a manager does: read what the
 * project is, what has been decided about it, and what the task actually
 * means, then write down what "done" would look like before anyone starts.
 *
 * Two things are load-bearing:
 *
 * - **Scoping produces a proposal, not a job.** Nothing here starts anything.
 *   The plan exists to be read, corrected, and agreed to — a task expanded
 *   into an objective by a model and executed unseen would be the one place in
 *   this pipeline where nobody checked the terms of the work.
 * - **A plan that came from a fallback says so.** `scopedBy` distinguishes a
 *   scoped brief from the bare restatement of the task title that AgentOS
 *   writes when Hermes cannot be reached, so an operator is never shown a
 *   thin plan without knowing why it is thin.
 */

/** The Hermes skill that carries the scoping instructions. */
const SCOPING_SKILL = "/scope-project-task";

/** Ceilings, so one reply cannot fill a job record. */
const MAX_ITEMS = 12;
const MAX_ITEM_CHARS = 300;
const MAX_OBJECTIVE_CHARS = 1_000;

/** Enough of a document to scope against, without sending the whole vault. */
const MAX_DOCUMENT_CHARS = 4_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((entry) => {
      const item = asString(entry);
      return item ? [item.slice(0, MAX_ITEM_CHARS)] : [];
    })
    .slice(0, MAX_ITEMS);
}

function clip(document: string | undefined, label: string): string | undefined {
  const trimmed = document?.trim();
  if (!trimmed) return undefined;

  const body =
    trimmed.length > MAX_DOCUMENT_CHARS
      ? `${trimmed.slice(0, MAX_DOCUMENT_CHARS)}\n…(truncated)`
      : trimmed;

  return `--- ${label} ---\n${body}`;
}

export interface ScopingInput {
  project: string;
  task: ProjectTask & { id: string };
  projectMarkdown?: string;
  statusMarkdown?: string;
  tasksMarkdown?: string;
  decisionsMarkdown?: string;
  /** What the repository looks like right now, when there is one. */
  gitSummary?: string;
  /** Related vault excerpts, with their sources, retrieved for this task. */
  memoryText?: string;
}

/**
 * The brief Hermes is sent.
 *
 * Four project documents, the task, and a bounded handful of related vault
 * excerpts chosen for this task (each labelled with its source). Not the
 * portfolio, not the design library — a scoping model that could see the
 * whole vault would write plans that wander into work nobody asked for.
 */
export function buildScopingPacket(input: ScopingInput): string {
  return [
    "SCOPE ONE PROJECT TASK",
    "",
    "Turn the task below into a brief an implementation worker can execute",
    "without asking questions. Scope it to the task as written. Do not widen",
    "it, and do not invent work the project has not asked for.",
    "",
    `PROJECT: ${input.project}`,
    `TASK: [${input.task.id}] ${input.task.title}`,
    `HORIZON: ${input.task.section}`,
    "",
    clip(input.projectMarkdown, "PROJECT.md"),
    clip(input.statusMarkdown, "STATUS.md"),
    clip(input.tasksMarkdown, "TASKS.md"),
    clip(input.decisionsMarkdown, "DECISIONS.md"),
    input.gitSummary ? `--- REPOSITORY ---\n${input.gitSummary}` : undefined,
    input.memoryText ? `--- RELATED VAULT NOTES ---\n${input.memoryText}` : undefined,
    "",
    "Respect what DECISIONS.md has already settled. A plan that contradicts a",
    "recorded decision is wrong even if it would otherwise be a good idea.",
    "",
    "Validation commands must be ones this repository actually has. If you",
    "cannot tell what they are, return an empty list rather than guessing:",
    "AgentOS runs these itself, and a command that does not exist fails the",
    "job rather than the plan.",
    "",
    "Reply with a single JSON object and nothing else:",
    "{",
    '  "objective": "what the worker should implement, in a few sentences",',
    '  "contextFiles": ["paths or documents that bear on it"],',
    '  "constraints": ["what it must not do"],',
    '  "acceptanceCriteria": ["how a reviewer will know it is done"],',
    '  "validationCommands": ["npm run build"],',
    '  "suggestedTaskType": "implementation" | "debugging" | "refactor"',
    '        | "code-review" | "architecture" | "research"',
    '        | "design-implementation" | "testing"',
    "}",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

/**
 * Reads Hermes' reply into a plan.
 *
 * Returns nothing unless there is an objective, because a plan without one is
 * not a plan — every other field can reasonably be empty, and an empty
 * objective would delegate a worker to do nothing in particular.
 */
export function readDelegationPlan(
  text: string,
  base: { taskId: string; project: string },
): DelegationPlan | undefined {
  const payload = asRecord(extractJson(text));
  if (!payload) return undefined;

  const objective = asString(payload.objective);
  if (!objective) return undefined;

  const suggested = WorkerTaskTypeSchema.safeParse(
    asString(payload.suggestedTaskType)?.toLowerCase(),
  );

  return {
    taskId: base.taskId,
    project: base.project,
    objective: objective.slice(0, MAX_OBJECTIVE_CHARS),
    contextFiles: readList(payload.contextFiles),
    constraints: readList(payload.constraints),
    acceptanceCriteria: readList(payload.acceptanceCriteria),
    validationCommands: readList(payload.validationCommands),
    suggestedTaskType: suggested.success ? suggested.data : undefined,
    scopedBy: "hermes",
  };
}

/**
 * The plan AgentOS writes when Hermes cannot.
 *
 * Deliberately thin, and honest about it. It restates the task and commits to
 * nothing else: an acceptance criterion this module invented would be a
 * standard the work gets judged against that nobody actually set.
 *
 * No validation commands, for the same reason — AgentOS runs whatever is
 * listed, and a guessed command fails the job rather than checking it. The
 * plan is editable, so the operator can supply what they know.
 */
export function fallbackPlan(input: ScopingInput): DelegationPlan {
  return {
    taskId: input.task.id,
    project: input.project,
    objective: input.task.title,
    contextFiles: [],
    constraints: [],
    acceptanceCriteria: [],
    validationCommands: [],
    scopedBy: "agentos",
  };
}

/**
 * Scopes one task.
 *
 * Never throws: a Hermes that cannot be reached produces the fallback plan,
 * which the operator can read, edit, and decide on. Refusing to open the
 * delegation screen would be a worse answer than a plan marked as thin.
 */
export async function scopeTask(input: ScopingInput): Promise<DelegationPlan> {
  try {
    const reply = await sendToHermes(
      `${SCOPING_SKILL}\n\n${buildScopingPacket(input)}`,
      {
        operation: "scoping",
        project: input.project,
        taskId: input.task.id,
      },
    );

    return (
      readDelegationPlan(reply, {
        taskId: input.task.id,
        project: input.project,
      }) ?? fallbackPlan(input)
    );
  } catch {
    return fallbackPlan(input);
  }
}
