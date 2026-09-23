import type {
  MilestonePlan,
  ProjectMilestone,
  RoadmapTask,
} from "../../shared/agentos-types";
import { ProjectTaskSectionSchema } from "../../shared/agentos-types";
import { HermesError, sendToHermes } from "./client";
import { PlanningUnavailableError } from "./project-planning";
import { extractJson } from "./worker-review";

/**
 * Hermes planning a milestone, and reviewing one.
 *
 * Planning is where a model earns its place in this hierarchy: given the
 * project's goal, what has been decided, the milestone's outcome and the tasks
 * already listed, it can say what "done" would look like as criteria, which
 * tasks are missing, what could go wrong — and, most usefully, which outcomes
 * *no existing task addresses*. That last list is the planning check: it
 * points at gaps rather than inventing backlog.
 *
 * It stays a proposal. The plan is shown, edited and applied by a person,
 * through the ordinary create-task and set-criteria mutations. Hermes writes
 * nothing.
 *
 * The review is the same shape in reverse: given what shipped, what remains
 * and what was decided along the way, draft the four paragraphs a person
 * would otherwise have to write from memory. Also a draft; saved only when
 * the operator completes the milestone with it.
 */

const PLANNING_SKILL = "/plan-milestone";
const REVIEW_SKILL = "/review-milestone";

const MAX_ITEMS = 15;
const MAX_TASKS = 20;
const MAX_ITEM_CHARS = 300;
const MAX_DOCUMENT_CHARS = 4_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Hermes likes to number things: `[PP-011] Do the thing`. The ids are
 * invented and would collide with real ones, so a leading id-shaped prefix
 * is dropped from anything that becomes a task title.
 */
export function stripInventedId(title: string): string {
  return title.replace(/^\s*\[?[A-Z][A-Z0-9]{0,7}-\d{1,5}\]?\s*[:\-–—]?\s*/, "").trim() || title.trim();
}

function readList(value: unknown, max = MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const item = asString(entry);
      return item ? [item.slice(0, MAX_ITEM_CHARS)] : [];
    })
    .slice(0, max);
}

function clip(document: string | undefined, label: string): string | undefined {
  const trimmed = document?.trim();
  if (!trimmed) return undefined;
  const body = trimmed.length > MAX_DOCUMENT_CHARS ? `${trimmed.slice(0, MAX_DOCUMENT_CHARS)}\n…(truncated)` : trimmed;
  return `--- ${label} ---\n${body}`;
}

export interface MilestonePlanningInput {
  project: string;
  milestone: ProjectMilestone;
  tasks: readonly RoadmapTask[];
  projectMarkdown?: string;
  statusMarkdown?: string;
  decisionsMarkdown?: string;
}

function describeTasks(tasks: readonly RoadmapTask[]): string {
  if (tasks.length === 0) return "(none yet)";
  return tasks.map((task) => `- [${task.status === "done" ? "x" : " "}] [${task.id}] ${task.title}`).join("\n");
}

export function buildMilestonePlanningPacket(input: MilestonePlanningInput): string {
  const { milestone } = input;

  return [
    "PLAN ONE MILESTONE",
    "",
    "The milestone below already exists. Propose what would show it is reached,",
    "what work is missing, and what could go wrong. Do not restate tasks that",
    "already exist; do not widen the milestone beyond its outcome.",
    "",
    `PROJECT: ${input.project}`,
    `MILESTONE: ${milestone.title}`,
    `OUTCOME: ${milestone.outcome ?? "(not written)"}`,
    milestone.targetDate ? `TARGET: ${milestone.targetDate}` : undefined,
    "",
    "EXISTING CRITERIA:",
    milestone.criteria.length > 0
      ? milestone.criteria.map((criterion) => `- [${criterion.done ? "x" : " "}] ${criterion.text}`).join("\n")
      : "(none yet)",
    "",
    "EXISTING TASKS:",
    describeTasks(input.tasks),
    "",
    clip(input.projectMarkdown, "PROJECT.md"),
    clip(input.statusMarkdown, "STATUS.md"),
    clip(input.decisionsMarkdown, "DECISIONS.md"),
    "",
    "Respect what DECISIONS.md has settled. Criteria are outcomes a person can",
    "check, not implementation steps. Tasks are implementation steps. For each",
    "outcome or criterion no existing task addresses, say so under `uncovered`",
    "with one suggested task.",
    "",
    "Reply with a single JSON object and nothing else:",
    "{",
    '  "criteria": ["outcome a reviewer can verify", "..."],',
    '  "tasks": [{ "title": "...", "section": "now" | "next" | "later", "after": ["PP-021"] }],',
    '  "risks": ["..."],',
    '  "dependencies": ["what this milestone needs from elsewhere"],',
    '  "uncovered": [{ "outcome": "...", "suggestedTask": "..." }]',
    "}",
    "",
    "Between two and eight new tasks; at most three in \"now\".",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function readMilestonePlan(text: string, milestoneId: string): MilestonePlan | undefined {
  const payload = asRecord(extractJson(text));
  if (!payload) return undefined;

  const tasks = Array.isArray(payload.tasks)
    ? payload.tasks
        .flatMap((entry) => {
          const record = asRecord(entry);
          const title = asString(record ? record.title : entry);
          if (!title) return [];
          const section = ProjectTaskSectionSchema.safeParse(asString(record?.section)?.toLowerCase());
          return [
            {
              title: stripInventedId(title).slice(0, MAX_ITEM_CHARS),
              section: section.success ? section.data : ("later" as const),
              after: readList(record?.after, 10),
            },
          ];
        })
        .slice(0, MAX_TASKS)
    : [];

  const uncovered = Array.isArray(payload.uncovered)
    ? payload.uncovered
        .flatMap((entry) => {
          const record = asRecord(entry);
          const outcome = asString(record?.outcome);
          if (!outcome) return [];
          return [
            {
              outcome: outcome.slice(0, MAX_ITEM_CHARS),
              suggestedTask: stripInventedId(asString(record?.suggestedTask) ?? outcome).slice(0, MAX_ITEM_CHARS),
            },
          ];
        })
        .slice(0, MAX_ITEMS)
    : [];

  const criteria = readList(payload.criteria);

  if (criteria.length === 0 && tasks.length === 0 && uncovered.length === 0) return undefined;

  return {
    milestoneId,
    criteria,
    tasks,
    risks: readList(payload.risks),
    dependencies: readList(payload.dependencies),
    uncovered,
    plannedBy: "hermes",
  };
}

export async function planMilestone(input: MilestonePlanningInput): Promise<MilestonePlan> {
  let reply: string;

  try {
    reply = await sendToHermes(`${PLANNING_SKILL}\n\n${buildMilestonePlanningPacket(input)}`, {
      operation: "planning",
      project: input.project,
    });
  } catch (error) {
    throw new PlanningUnavailableError(
      error instanceof HermesError ? error.message : "Hermes could not be reached.",
    );
  }

  const plan = readMilestonePlan(reply, input.milestone.id);

  if (!plan) {
    throw new PlanningUnavailableError("Hermes answered, but not with a plan AgentOS could read.");
  }

  return plan;
}

export function buildReviewPacket(input: MilestonePlanningInput): string {
  const { milestone } = input;
  const done = input.tasks.filter((task) => task.status === "done");
  const open = input.tasks.filter((task) => task.status !== "done");

  return [
    "REVIEW ONE MILESTONE",
    "",
    "Write a concise completion review for the milestone below, in four short",
    "sections with these exact headings: What shipped, What changed, What",
    "remains, Lessons learned. Markdown, no preamble, under 250 words. Only",
    "say what the evidence below supports.",
    "",
    `PROJECT: ${input.project}`,
    `MILESTONE: ${milestone.title}`,
    `OUTCOME: ${milestone.outcome ?? "(not written)"}`,
    "",
    "CRITERIA:",
    milestone.criteria.length > 0
      ? milestone.criteria.map((criterion) => `- [${criterion.done ? "x" : " "}] ${criterion.text}`).join("\n")
      : "(none)",
    "",
    `COMPLETED TASKS (${done.length}):`,
    describeTasks(done),
    "",
    `OPEN TASKS (${open.length}):`,
    describeTasks(open),
    "",
    clip(input.statusMarkdown, "STATUS.md"),
    clip(input.decisionsMarkdown, "DECISIONS.md"),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export async function draftMilestoneReview(input: MilestonePlanningInput): Promise<string> {
  try {
    const reply = await sendToHermes(`${REVIEW_SKILL}\n\n${buildReviewPacket(input)}`, {
      operation: "planning",
      project: input.project,
    });

    const text = reply.trim();
    if (!text) throw new PlanningUnavailableError("Hermes returned an empty review.");
    return text.slice(0, 8_000);
  } catch (error) {
    if (error instanceof PlanningUnavailableError) throw error;
    throw new PlanningUnavailableError(
      error instanceof HermesError ? error.message : "Hermes could not be reached.",
    );
  }
}
