import type {
  MilestoneCriterion,
  MilestoneStatus,
  ProjectMilestone,
} from "../../../shared/agentos-types";

/**
 * `MILESTONES.md`: the roadmap, as a person would write it.
 *
 * ```markdown
 * # Pantry Pilot Milestones
 *
 * ## Chef Experience
 *
 * Id: chef-experience
 * Status: Active
 * Target: 2026-09-25
 * Created: 2026-09-14
 *
 * Outcome:
 * Make the AI Chef reliable, fast and enjoyable enough for beta.
 *
 * Criteria:
 * - [x] Fallback recipe generation
 * - [ ] Retry generation
 *
 * Tasks:
 * - PP-014
 * - PP-018
 *
 * ### Review
 *
 * What shipped, what changed, what remains.
 * ```
 *
 * One `##` per milestone, in roadmap order. Fields are `Key: value` like
 * every other file in the vault; criteria are a checkbox list because that is
 * exactly what they are; tasks are a plain list of ids. Anything else a person
 * writes inside a section is kept as notes and written back where it was.
 *
 * The `Id:` is the stable handle. It is a slug of the title when the milestone
 * is created and never changes afterwards, so renaming a milestone does not
 * orphan the tasks, jobs and usage that reference it.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const FIELD = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/;
const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const TASK_REF = /^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/;

export interface MilestoneDocument {
  /** The `# …` line, kept verbatim. */
  title: string;
  /** Prose between the title and the first milestone. */
  preamble: string[];
  milestones: MilestoneRecord[];
  trailingNewline: boolean;
}

/** One section, as read. `notes` is whatever did not parse as a field. */
export interface MilestoneRecord extends Omit<ProjectMilestone, "project"> {
  notes: string[];
}

const STATUS_LABELS: Record<MilestoneStatus, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
  paused: "Paused",
  archived: "Archived",
};

function readStatus(value: string | undefined): MilestoneStatus {
  const cleaned = value?.trim().toLowerCase();
  return cleaned && cleaned in STATUS_LABELS ? (cleaned as MilestoneStatus) : "planned";
}

function normaliseKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z]/g, "");
}

export function toMilestoneId(title: string): string {
  return title
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 64);
}

type Mode = "fields" | "outcome" | "criteria" | "tasks" | "review" | "notes";

function parseSection(title: string, lines: readonly string[]): MilestoneRecord {
  const record: MilestoneRecord = {
    id: "",
    title,
    status: "planned",
    criteria: [],
    taskIds: [],
    notes: [],
  };

  const outcome: string[] = [];
  const review: string[] = [];
  let mode: Mode = "fields";

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);

    if (heading && heading[1].length >= 3) {
      mode = normaliseKey(heading[2]) === "review" ? "review" : "notes";
      if (mode === "notes") record.notes.push(line);
      continue;
    }

    if (mode === "review") {
      review.push(line);
      continue;
    }

    const field = FIELD.exec(line);
    const key = field ? normaliseKey(field[1]) : undefined;

    if (field && key && !BULLET.test(line)) {
      const value = field[2].trim();

      switch (key) {
        case "id":
          record.id = value;
          mode = "fields";
          continue;
        case "status":
          record.status = readStatus(value);
          mode = "fields";
          continue;
        case "target":
        case "targetdate":
          record.targetDate = value || undefined;
          mode = "fields";
          continue;
        case "created":
        case "createdat":
          record.createdAt = value || undefined;
          mode = "fields";
          continue;
        case "completed":
        case "completedat":
          record.completedAt = value || undefined;
          mode = "fields";
          continue;
        case "outcome":
          if (value) outcome.push(value);
          mode = "outcome";
          continue;
        case "criteria":
        case "successcriteria":
          mode = "criteria";
          continue;
        case "tasks":
          mode = "tasks";
          continue;
        default:
          break;
      }
    }

    if (mode === "criteria") {
      const box = CHECKBOX.exec(line);
      if (box) {
        record.criteria.push({ text: box[2].trim(), done: box[1].toLowerCase() === "x" });
        continue;
      }
      const bullet = BULLET.exec(line);
      if (bullet) {
        record.criteria.push({ text: bullet[1].trim(), done: false });
        continue;
      }
      if (line.trim().length === 0) continue;
      mode = "notes";
    }

    if (mode === "tasks") {
      const bullet = BULLET.exec(line);
      if (bullet) {
        const ids = bullet[1]
          .split(/[,\s]+/)
          .map((id) => id.trim().toUpperCase().replace(/^\[|\]$/g, ""))
          .filter((id) => TASK_REF.test(id));
        record.taskIds.push(...ids);
        continue;
      }
      if (line.trim().length === 0) continue;
      mode = "notes";
    }

    if (mode === "outcome") {
      if (line.trim().length === 0) {
        if (outcome.length > 0) mode = "notes";
        continue;
      }
      outcome.push(line.trim());
      continue;
    }

    if (mode === "fields" && line.trim().length === 0) continue;

    if (line.trim().length > 0 || record.notes.length > 0) record.notes.push(line);
    mode = "notes";
  }

  record.outcome = outcome.join(" ").trim() || undefined;
  record.review = review.join("\n").trim() || undefined;
  record.taskIds = [...new Set(record.taskIds)];

  // Trailing blank notes are formatting, not content.
  while (record.notes.length > 0 && record.notes[record.notes.length - 1].trim().length === 0) {
    record.notes.pop();
  }

  if (!record.id) record.id = toMilestoneId(title);

  return record;
}

export function parseMilestoneDocument(markdown: string): MilestoneDocument {
  const trailingNewline = markdown.endsWith("\n");
  const lines = markdown.split(/\r?\n/);
  if (trailingNewline) lines.pop();

  let title = "";
  const preamble: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | undefined;

  for (const line of lines) {
    const heading = HEADING.exec(line);

    if (heading && heading[1].length === 1 && !title && sections.length === 0) {
      title = line;
      continue;
    }

    if (heading && heading[1].length === 2) {
      current = { title: heading[2].trim(), lines: [] };
      sections.push(current);
      continue;
    }

    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  while (preamble.length > 0 && preamble[preamble.length - 1].trim().length === 0) preamble.pop();
  while (preamble.length > 0 && preamble[0].trim().length === 0) preamble.shift();

  return {
    title,
    preamble,
    milestones: sections.map((section) => parseSection(section.title, section.lines)),
    trailingNewline,
  };
}

function renderSection(record: MilestoneRecord): string[] {
  const lines: string[] = [`## ${record.title}`, ""];

  lines.push(`Id: ${record.id}`);
  lines.push(`Status: ${STATUS_LABELS[record.status]}`);
  if (record.targetDate) lines.push(`Target: ${record.targetDate}`);
  if (record.createdAt) lines.push(`Created: ${record.createdAt}`);
  if (record.completedAt) lines.push(`Completed: ${record.completedAt}`);

  if (record.outcome) {
    lines.push("", "Outcome:", record.outcome);
  }

  if (record.criteria.length > 0) {
    lines.push("", "Criteria:");
    for (const criterion of record.criteria) {
      lines.push(`- [${criterion.done ? "x" : " "}] ${criterion.text}`);
    }
  }

  if (record.taskIds.length > 0) {
    lines.push("", "Tasks:");
    for (const id of record.taskIds) lines.push(`- ${id}`);
  }

  if (record.notes.length > 0) {
    lines.push("", ...record.notes);
  }

  if (record.review) {
    lines.push("", "### Review", "", record.review);
  }

  return lines;
}

export function serializeMilestoneDocument(document: MilestoneDocument, projectName?: string): string {
  const out: string[] = [];

  out.push(document.title || `# ${projectName ?? "Project"} Milestones`);

  if (document.preamble.length > 0) out.push("", ...document.preamble);

  for (const record of document.milestones) {
    out.push("", ...renderSection(record));
  }

  const body = out.join("\n").replace(/\n{3,}/g, "\n\n");

  return document.trailingNewline || document.milestones.length > 0 ? `${body}\n` : body;
}

/** A blank record for a milestone being created. */
export function newMilestoneRecord(input: {
  title: string;
  id?: string;
  outcome?: string;
  status?: MilestoneStatus;
  targetDate?: string;
  criteria?: readonly string[];
  taskIds?: readonly string[];
  createdAt: string;
}): MilestoneRecord {
  return {
    id: input.id ?? toMilestoneId(input.title),
    title: input.title.trim(),
    outcome: input.outcome?.trim() || undefined,
    status: input.status ?? "planned",
    targetDate: input.targetDate || undefined,
    criteria: (input.criteria ?? [])
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text): MilestoneCriterion => ({ text, done: false })),
    taskIds: [...new Set((input.taskIds ?? []).map((id) => id.trim().toUpperCase()))],
    createdAt: input.createdAt,
    notes: [],
  };
}
