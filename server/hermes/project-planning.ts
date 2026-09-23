import type { ProjectPlan } from "../../shared/agentos-types";
import { ProjectTaskSectionSchema } from "../../shared/agentos-types";
import { toSlug } from "../agentos/mutations/projects";
import { HermesError, sendToHermes } from "./client";
import { extractJson } from "./worker-review";

/**
 * Turning a one-paragraph idea into a project proposal.
 *
 * Same shape as task scoping, for the same reason: Hermes does the thinking a
 * founder does on day one — what is this, what is in and out, what are the
 * first steps, what could go wrong — and writes it down in a form a person
 * can read and correct *before* anything exists.
 *
 * **A plan is a proposal, not a project.** Nothing here touches the vault.
 * The plan goes back to the create screen, every field editable, and the
 * files are written only when the operator clicks create. That keeps the rule
 * that agents propose and people decide, without making the person retype
 * what the agent got right.
 *
 * Unlike scoping, an unreachable Hermes is *reported* rather than papered
 * over with a fallback. A thin delegation plan is still a usable plan; a
 * "project plan" that is the brief echoed back is not, and pretending it were
 * would waste the operator's review.
 */

const PLANNING_SKILL = "/plan-project";

const MAX_ITEMS = 12;
const MAX_TASKS = 20;
const MAX_ITEM_CHARS = 300;
const MAX_GOAL_CHARS = 1_000;

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

function readList(value: unknown, max = MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((entry) => {
      const item = asString(entry);
      return item ? [item.slice(0, MAX_ITEM_CHARS)] : [];
    })
    .slice(0, max);
}

/** Tasks may arrive as strings or as `{ title, section }` objects. Both are read. */
function readTasks(value: unknown): ProjectPlan["initialTasks"] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((entry) => {
      const record = asRecord(entry);
      const title = asString(record ? record.title : entry);
      if (!title) return [];

      const section = ProjectTaskSectionSchema.safeParse(
        asString(record?.section)?.toLowerCase(),
      );

      return [
        {
          title: title.slice(0, MAX_ITEM_CHARS),
          section: section.success ? section.data : ("later" as const),
        },
      ];
    })
    .slice(0, MAX_TASKS);
}

/** What Hermes is sent: the brief, and the shape the answer must take. */
export function buildPlanningPacket(brief: string): string {
  return [
    "PLAN A NEW PROJECT",
    "",
    "Turn the brief below into a project proposal. Be concrete and modest:",
    "propose the smallest project that would test the idea, not the largest",
    "one the idea could become. Do not invent requirements the brief does not",
    "imply.",
    "",
    "--- BRIEF ---",
    brief.trim(),
    "",
    "Reply with a single JSON object and nothing else:",
    "{",
    '  "name": "a short project name",',
    '  "goal": "one or two sentences: what done looks like",',
    '  "scope": ["what is in", "what is explicitly out"],',
    '  "milestones": ["first shippable step", "next", "..."],',
    '  "initialTasks": [{ "title": "...", "section": "now" | "next" | "later" }],',
    '  "risks": ["what could make this fail"]',
    "}",
    "",
    "Between three and eight initial tasks. Put at most three in \"now\".",
  ].join("\n");
}

/** Reads Hermes' reply into a plan; nothing unless it named the project. */
export function readProjectPlan(text: string): ProjectPlan | undefined {
  const payload = asRecord(extractJson(text));
  if (!payload) return undefined;

  const name = asString(payload.name)?.slice(0, 80);
  if (!name) return undefined;

  const slug = toSlug(asString(payload.slug) ?? name);
  if (!slug) return undefined;

  return {
    name,
    slug,
    goal: (asString(payload.goal) ?? "").slice(0, MAX_GOAL_CHARS),
    scope: readList(payload.scope),
    milestones: readList(payload.milestones),
    initialTasks: readTasks(payload.initialTasks),
    risks: readList(payload.risks),
    plannedBy: "hermes",
  };
}

/**
 * The plan AgentOS offers when Hermes cannot: the brief, as a goal, under a
 * name guessed from its first words. Marked as such so the create screen can
 * say why it is thin — and it is offered only when the caller asks for it,
 * never silently in Hermes' place.
 */
export function fallbackProjectPlan(brief: string): ProjectPlan {
  const firstLine = brief.trim().split(/\r?\n/)[0] ?? "";
  const words = firstLine.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  const name = (words || "New project").replace(/[.!?,;:]+$/, "").slice(0, 80);

  return {
    name,
    slug: toSlug(name) || "new-project",
    goal: brief.trim().slice(0, MAX_GOAL_CHARS),
    scope: [],
    milestones: [],
    initialTasks: [],
    risks: [],
    plannedBy: "agentos",
  };
}

export class PlanningUnavailableError extends Error {
  readonly code = "hermes_unavailable";

  constructor(reason: string) {
    super(reason);
    this.name = "PlanningUnavailableError";
  }
}

/**
 * Asks Hermes for a plan.
 *
 * Throws `PlanningUnavailableError` when Hermes cannot be reached or did not
 * answer in the shape asked for. The route turns that into a 503 the create
 * screen can act on — offering manual creation with the brief pre-filled —
 * rather than presenting a guess as a plan.
 */
export async function planProject(brief: string): Promise<ProjectPlan> {
  let reply: string;

  try {
    reply = await sendToHermes(`${PLANNING_SKILL}\n\n${buildPlanningPacket(brief)}`, {
      operation: "planning",
    });
  } catch (error) {
    const reason =
      error instanceof HermesError
        ? error.message
        : "Hermes could not be reached.";

    throw new PlanningUnavailableError(reason);
  }

  const plan = readProjectPlan(reply);

  if (!plan) {
    throw new PlanningUnavailableError(
      "Hermes answered, but not with a plan AgentOS could read.",
    );
  }

  return plan;
}
