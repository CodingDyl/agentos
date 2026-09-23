import type { AgentSkill, AgentSkillScope } from "../../shared/agentos-types";
import { hermesFetch, HermesError } from "./client";

/**
 * Skill discovery.
 *
 * Hermes owns the skills; this asks it which ones exist and normalises them
 * into the small model the console needs. The payload shape is not
 * contractual, so the reader is deliberately tolerant — it accepts a bare
 * array, a wrapped collection, plain strings, or objects keyed in any of the
 * usual ways, and drops anything it cannot name rather than failing.
 *
 * React never sees a Hermes payload: the command string, category and scope are
 * all derived here.
 */

const SKILLS_PATH = "/skills";

/**
 * Categories the palette groups by, when Hermes does not supply one.
 *
 * These are display groupings, not a whitelist: a skill matching nothing lands
 * in `Skills` and still appears. Adding a skill to Hermes never requires
 * touching this list.
 */
const CATEGORY_BY_NAME: Record<string, string> = {
  "start-day": "Daily",
  "end-day": "Daily",
  dashboard: "Daily",
  capture: "Daily",
  "work-on": "Project",
  "stop-work": "Project",
};

/** Falls back to a suffix or prefix reading of the name. */
const CATEGORY_BY_PATTERN: [RegExp, string][] = [
  [/^project-/, "Project"],
  [/-review$/, "Review"],
  [/^review-/, "Review"],
  [/-health$/, "System"],
  [/-hygiene$/, "System"],
  [/^system-/, "System"],
  [/^memory-/, "System"],
];

const DEFAULT_CATEGORY = "Skills";

/**
 * Skills that act on one project.
 *
 * Hermes may say so itself through a parameter list; this is the fallback when
 * it does not. A project-scoped skill makes the palette ask which project
 * before it runs.
 */
const PROJECT_SCOPED = new Set(["work-on", "stop-work"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Normalises whatever Hermes calls a skill into one bare kebab-case name.
 *
 * `/start-day`, `start_day` and `startDay` are the same skill; the console
 * should not show three spellings of it.
 */
export function readSkillName(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;

  const name = raw
    .replace(/^\/+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  return name.length > 0 ? name : undefined;
}

/** `weekly review` → `Weekly review`. Hermes' own label, tidied for display. */
function readCategoryLabel(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;

  const label = raw.replace(/[-_]+/g, " ").trim();
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

/** Hermes' category if it has one, otherwise one read from the name. */
export function readCategory(
  source: Record<string, unknown>,
  name: string,
): string {
  const declared = pick(source, ["category", "group", "section", "namespace"]);
  const label = readCategoryLabel(declared);
  if (label) return label;

  // A tag list is a category in all but name; the first entry is enough.
  const tags = pick(source, ["tags", "labels"]);
  if (Array.isArray(tags)) {
    const tag = readCategoryLabel(tags.find((entry) => asString(entry)));
    if (tag) return tag;
  }

  if (CATEGORY_BY_NAME[name]) return CATEGORY_BY_NAME[name];

  for (const [pattern, category] of CATEGORY_BY_PATTERN) {
    if (pattern.test(name)) return category;
  }

  return DEFAULT_CATEGORY;
}

/** Whether a declared parameter, in any of its shapes, names a project. */
function declaresProjectParameter(source: Record<string, unknown>): boolean {
  const declared = pick(source, [
    "parameters",
    "params",
    "arguments",
    "args",
    "inputs",
  ]);

  if (Array.isArray(declared)) {
    return declared.some((entry) => {
      const name = readSkillName(
        typeof entry === "string" ? entry : record(entry)?.name,
      );
      return name === "project" || name === "project-slug";
    });
  }

  const named = record(declared);
  if (named) {
    return Object.keys(named).some(
      (key) => readSkillName(key) === "project" || readSkillName(key) === "project-slug",
    );
  }

  return false;
}

/** Whether this skill acts on a single project. */
export function readScope(
  source: Record<string, unknown>,
  name: string,
): AgentSkillScope {
  if (declaresProjectParameter(source)) return "project";
  if (PROJECT_SCOPED.has(name)) return "project";
  // `project-sync`, `project-update`, and anything else Hermes adds later.
  if (name.startsWith("project-")) return "project";

  const scope = readSkillName(pick(source, ["scope", "target"]));
  return scope === "project" ? "project" : "workspace";
}

/** Reads one skill. Returns `undefined` for anything that cannot be named. */
export function readSkill(payload: unknown): AgentSkill | undefined {
  // A skills list may be nothing more than an array of names.
  if (typeof payload === "string") {
    const name = readSkillName(payload);
    if (!name) return undefined;

    return {
      name,
      command: `/${name}`,
      category: readCategory({}, name),
      scope: readScope({}, name),
    };
  }

  const source = record(payload);
  if (!source) return undefined;

  const name = readSkillName(
    pick(source, ["name", "id", "skill", "command", "slug"]),
  );
  if (!name) return undefined;

  return {
    name,
    command: `/${name}`,
    description: asString(
      pick(source, ["description", "summary", "detail", "help", "title"]),
    ),
    category: readCategory(source, name),
    scope: readScope(source, name),
  };
}

/** Finds the array of skills in a list response, whatever it is keyed by. */
function readCollection(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  const source = record(payload);
  if (!source) return [];

  for (const key of ["skills", "data", "items", "results", "commands"]) {
    if (Array.isArray(source[key])) return source[key];
  }

  // Some builds key skills by name: `{ skills: { "start-day": {...} } }`.
  for (const key of ["skills", "data", "commands"]) {
    const nested = record(source[key]);
    if (nested) {
      return Object.entries(nested).map(([name, value]) => ({
        name,
        ...(record(value) ?? {}),
      }));
    }
  }

  return [];
}

/**
 * Every skill Hermes reports, named once and sorted for display.
 *
 * Duplicates collapse onto the first spelling seen, so a build listing both
 * `start-day` and `startDay` still shows one command.
 */
export function readSkills(payload: unknown): AgentSkill[] {
  const byName = new Map<string, AgentSkill>();

  for (const entry of readCollection(payload)) {
    const skill = readSkill(entry);
    if (skill && !byName.has(skill.name)) byName.set(skill.name, skill);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Asks Hermes which skills it has.
 *
 * Failure is not an error here: a Hermes that cannot answer simply reports no
 * skills, and the console falls back to its built-in baseline rather than
 * showing an empty command palette. An unconfigured Hermes is still surfaced,
 * because that is a setup problem the operator can fix.
 */
export async function getSkills(): Promise<AgentSkill[]> {
  try {
    const response = await hermesFetch(SKILLS_PATH, { method: "GET" });

    if (!response.ok) return [];

    return readSkills(await response.json());
  } catch (error) {
    if (error instanceof HermesError && error.reason === "not-configured") {
      throw error;
    }
    return [];
  }
}
