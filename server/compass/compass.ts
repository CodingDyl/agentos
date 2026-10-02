import {
  AreaStatusSchema,
  CompassSchema,
  ProjectStatusSchema,
  type Compass,
  type CompassProblem,
  type CompassRead,
} from "../../shared/compass-types";
import { editFile, readForEdit } from "../agentos/mutations/writer";

/**
 * `me/COMPASS.md`: reading it, and writing it back.
 *
 * The format is fixed but forgiving (see docs/compass/README.md). Reading is
 * line by line: a line that cannot be understood is reported with its number
 * and kept out of the result, never silently dropped from the file, because a
 * write keeps every section the parser does not own exactly as it was.
 */

export const COMPASS_PATH = "me/COMPASS.md";

const OWNED: Record<string, keyof Compass> = {
  direction: "direction",
  "what matters": "values",
  areas: "areas",
  goals: "goals",
  projects: "projects",
  "this week": "thisWeek",
};

interface Section {
  key: keyof Compass | undefined;
  heading: string;
  /** 1-based line numbers, for problems. */
  lines: { number: number; text: string }[];
}

function sections(markdown: string): { title: string; list: Section[] } {
  const list: Section[] = [];
  let title = "Compass";
  let current: Section | undefined;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const h1 = /^#\s+(.+)$/.exec(text);
    if (h1 && !current) {
      title = h1[1].trim();
      return;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(text);
    if (h2) {
      current = { key: OWNED[h2[1].toLowerCase()], heading: h2[1], lines: [] };
      list.push(current);
      return;
    }
    current?.lines.push({ number: index + 1, text });
  });
  return { title, list };
}

const bullet = (text: string) => /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(text)?.[1]?.trim();

/** `key: value | key: value` after the first field. */
function fields(parts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of parts) {
    const match = /^([a-z ]+):\s*(.*)$/i.exec(part.trim());
    if (match) out[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return out;
}

export function parseCompass(markdown: string): { compass: Compass; problems: CompassProblem[] } {
  const problems: CompassProblem[] = [];
  const raw: Record<string, unknown> = { values: [], areas: [], goals: [], projects: [], thisWeek: [] };
  let heading = "";
  const problem = (line: { number: number; text: string }, reason: string) =>
    problems.push({ line: line.number, text: line.text.trim(), reason, section: heading });

  for (const section of sections(markdown).list) {
    heading = section.heading;
    const content = section.lines.filter((line) => line.text.trim() && !/^<!--.*-->$/.test(line.text.trim()));
    switch (section.key) {
      case "direction":
        raw.direction = content.map((line) => line.text.trim()).join(" ");
        break;
      case "values":
        for (const line of content) {
          const text = bullet(line.text) ?? line.text;
          (raw.values as string[]).push(...text.split(/\s*[·,]\s*/).map((value) => value.trim()).filter(Boolean));
        }
        break;
      case "areas":
        for (const line of content) {
          const match = /^(.+?)\s*:\s*(.+)$/.exec(bullet(line.text) ?? "");
          const status = AreaStatusSchema.safeParse(match?.[2].trim().toLowerCase());
          if (!match || !status.success) problem(line, 'Expected "- Area: on track / slipping / neglected / unrated"');
          else (raw.areas as unknown[]).push({ name: match[1].trim(), status: status.data });
        }
        break;
      case "goals":
        for (const line of content) {
          const match = /^\[(G\d{1,3})\]\s*(.+)$/.exec(bullet(line.text) ?? "");
          if (!match) {
            problem(line, 'Expected "- [G1] Goal | area: … | by: … | measure: … | now: … | target: …"');
            continue;
          }
          const [title, ...rest] = match[2].split("|");
          const extra = fields(rest);
          (raw.goals as unknown[]).push({ id: match[1], title: title.trim(), area: extra.area ?? "", by: extra.by ?? "", measure: extra.measure ?? "", now: extra.now ?? "", target: extra.target ?? "" });
        }
        break;
      case "projects":
        for (const line of content) {
          const text = bullet(line.text);
          if (!text) {
            problem(line, 'Expected "- Project | serves: G1, G2 | status: active"');
            continue;
          }
          const [name, ...rest] = text.split("|");
          const extra = fields(rest);
          const status = ProjectStatusSchema.safeParse((extra.status ?? "active").toLowerCase());
          if (!status.success) {
            problem(line, "Status must be active, paused, admin or done");
            continue;
          }
          const serves = (extra.serves ?? "").split(/[\s,]+/).filter((id) => /^G\d{1,3}$/.test(id));
          (raw.projects as unknown[]).push({ name: name.trim(), serves, status: status.data });
        }
        break;
      case "thisWeek":
        for (const line of content) {
          const text = bullet(line.text);
          if (text) (raw.thisWeek as string[]).push(text);
          else problem(line, 'Expected a list item, e.g. "1. Ship the outreach flow"');
        }
        break;
      default:
        break;
    }
  }

  const parsed = CompassSchema.safeParse(raw);
  if (parsed.success) return { compass: parsed.data, problems };
  // Something overlong or overfull: keep what is valid and say what is not.
  problems.push({ line: 0, text: "", reason: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
  return { compass: CompassSchema.parse({}), problems };
}

const clean = (value: string) => value.replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();

export function renderCompass(compass: Compass, title = "Compass", keep: string[] = [], unread: CompassProblem[] = []): string {
  // Lines the parser could not read go back into their section untouched, for you to fix by hand.
  const unreadIn = (heading: string) =>
    unread.filter((entry) => entry.section?.toLowerCase() === heading.toLowerCase() && entry.text).map((entry) => `\n${entry.text}`).join("");
  const goalLine = (goal: Compass["goals"][number]) =>
    [
      `- [${goal.id}] ${clean(goal.title)}`,
      goal.area && `area: ${clean(goal.area)}`,
      goal.by && `by: ${clean(goal.by)}`,
      goal.measure && `measure: ${clean(goal.measure)}`,
      goal.now && `now: ${clean(goal.now)}`,
      goal.target && `target: ${clean(goal.target)}`,
    ]
      .filter(Boolean)
      .join(" | ");

  const blocks = [
    `# ${title}`,
    "<!-- The format is described in the AgentOS repo at docs/compass/README.md. -->",
    `## Direction\n\n${clean(compass.direction)}`,
    `## What matters\n\n${compass.values.map((value) => `- ${clean(value)}`).join("\n")}${unreadIn("What matters")}`,
    `## Areas\n\n${compass.areas.map((area) => `- ${clean(area.name).replace(/:/g, "")}: ${area.status}`).join("\n")}${unreadIn("Areas")}`,
    `## Goals\n\n${compass.goals.map(goalLine).join("\n")}${unreadIn("Goals")}`,
    `## Projects\n\n${compass.projects
      .map((project) => [`- ${clean(project.name)}`, `serves: ${project.serves.join(", ") || "-"}`, `status: ${project.status}`].join(" | "))
      .join("\n")}${unreadIn("Projects")}`,
    `## This week\n\n${compass.thisWeek.map((outcome, index) => `${index + 1}. ${clean(outcome)}`).join("\n")}${unreadIn("This week")}`,
    ...keep,
  ];
  return `${blocks.map((block) => block.replace(/\n+$/, "")).join("\n\n")}\n`;
}

/** Sections the parser does not own, exactly as written, so a save keeps them. */
function unownedSections(markdown: string): string[] {
  return sections(markdown)
    .list.filter((section) => !section.key)
    .map((section) => [`## ${section.heading}`, ...section.lines.map((line) => line.text)].join("\n").trim());
}

export async function readCompass(): Promise<CompassRead> {
  const { data, revision } = await readForEdit(COMPASS_PATH);
  if (data === undefined) return { exists: false, compass: CompassSchema.parse({}), problems: [], revision };
  const { compass, problems } = parseCompass(data);
  return { exists: true, compass, problems, revision };
}

/**
 * Writes the Compass. `revision` is the one the edit was made against: if the
 * file changed since (an edit in Obsidian), the save is refused instead of
 * overwriting it. Unknown sections are kept.
 */
export async function saveCompass(compass: Compass, revision?: string): Promise<CompassRead> {
  const checked = CompassSchema.parse(compass);
  const ids = new Set(checked.goals.map((goal) => goal.id));
  if (ids.size !== checked.goals.length) throw new CompassError("Two goals have the same id.");
  for (const project of checked.projects) {
    const unknown = project.serves.find((id) => !ids.has(id));
    if (unknown) throw new CompassError(`${project.name} serves ${unknown}, which is not a goal.`);
  }

  await editFile({
    relativePath: COMPASS_PATH,
    expectedRevision: revision,
    label: "compass.save",
    apply: (current) =>
      current
        ? renderCompass(checked, sections(current).title, unownedSections(current), parseCompass(current).problems)
        : renderCompass(checked),
  });
  return readCompass();
}

export class CompassError extends Error {}
