import { splitTaskTail } from "./mutations/task-document";
/**
 * Small, deterministic parsers for AgentOS markdown conventions.
 *
 * This is deliberately not a general markdown parser. AgentOS owns the files it
 * reads, so these functions understand exactly the shapes the vault uses and
 * return `undefined` or an empty array for anything else. Nothing here throws
 * on malformed input — a missing section is a normal state, not a failure.
 */

export interface MarkdownSection {
  /** Heading text with list numbering removed: `## 1. AgentOS` → `AgentOS`. */
  title: string;
  /** The leading number when the heading was ordered: `## 1. AgentOS` → `1`. */
  ordinal?: number;
  level: number;
  body: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const LEADING_NUMBER = /^\d+[.)]\s+/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
/** Any task line, done or not, with the box's contents captured. */
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
/**
 * A stable task id, as `[PP-014]` at the start of the title.
 *
 * Narrow on purpose: uppercase letters, a dash, digits. A markdown link opens
 * with a bracket too, and `[see the notes](...)` must not be read as an id.
 */
const TASK_ID = /^\[([A-Z][A-Z0-9]{0,7}-\d{1,5})\]\s*(.*)$/;

/** Splits into lines, blanking out fenced code so headings inside it are ignored. */
function readableLines(markdown: string): string[] {
  let inFence = false;

  return markdown.split(/\r?\n/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

function normaliseTitle(rawTitle: string): string {
  return rawTitle.replace(LEADING_NUMBER, "").trim();
}

function readOrdinal(rawTitle: string): number | undefined {
  const match = LEADING_NUMBER.exec(rawTitle);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

/** Every section at the given heading level, in document order. */
export function getSections(markdown: string, level = 2): MarkdownSection[] {
  const lines = readableLines(markdown);
  const sections: MarkdownSection[] = [];

  let current:
    | { title: string; ordinal?: number; body: string[] }
    | undefined;

  for (const line of lines) {
    const heading = HEADING.exec(line);

    if (heading) {
      const headingLevel = heading[1].length;

      if (headingLevel <= level && current) {
        sections.push({
          title: current.title,
          ordinal: current.ordinal,
          level,
          body: current.body.join("\n").trim(),
        });
        current = undefined;
      }

      if (headingLevel === level) {
        current = {
          title: normaliseTitle(heading[2]),
          ordinal: readOrdinal(heading[2]),
          body: [],
        };
        continue;
      }
    }

    current?.body.push(line);
  }

  if (current) {
    sections.push({
      title: current.title,
      ordinal: current.ordinal,
      level,
      body: current.body.join("\n").trim(),
    });
  }

  return sections;
}

/**
 * Body of the first section whose heading matches `heading`, at any level.
 * Matching ignores case and any leading numbering.
 */
export function getSection(
  markdown: string,
  heading: string,
): string | undefined {
  const target = heading.trim().toLowerCase();
  const lines = readableLines(markdown);

  let capturing: number | undefined;
  const body: string[] = [];

  for (const line of lines) {
    const match = HEADING.exec(line);

    if (match) {
      const level = match[1].length;

      if (capturing !== undefined && level <= capturing) break;

      if (capturing === undefined && normaliseTitle(match[2]).toLowerCase() === target) {
        capturing = level;
        continue;
      }
    }

    if (capturing !== undefined) body.push(line);
  }

  if (capturing === undefined) return undefined;

  const text = body.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

/** The first matching section from a list of candidate headings. */
export function getFirstSection(
  markdown: string,
  headings: readonly string[],
): string | undefined {
  for (const heading of headings) {
    const section = getSection(markdown, heading);
    if (section) return section;
  }
  return undefined;
}

/** Everything after the document's `#` title, so a body-only file still parses. */
export function getDocumentBody(markdown: string): string {
  const lines = readableLines(markdown);
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  return (titleIndex === -1 ? lines : lines.slice(titleIndex + 1)).join("\n").trim();
}

/**
 * Top-level bullets, markers stripped. AgentOS lists are flat, so nested lines
 * are treated as detail belonging to their parent rather than as items.
 */
export function getBullets(section: string): string[] {
  return readableLines(section)
    .map((line) => BULLET.exec(line))
    .filter((match): match is RegExpExecArray => match !== null && match[1].length < 2)
    .map((match) => match[2].trim())
    .filter((item) => item.length > 0);
}

/** One task line, read into its parts. */
export interface ParsedTask {
  /** Absent when the line carries no id. Such a task cannot be delegated. */
  id?: string;
  title: string;
  completed: boolean;
  ready?: boolean;
  after?: string[];
}

/**
 * Every `- [ ]` and `- [x]` entry in a section.
 *
 * Completed tasks are read as well as open ones, because a task that was
 * delegated and finished still has to be findable by its id — reading only
 * open work would lose a task at the moment it mattered most.
 */
export function getTasks(section: string): ParsedTask[] {
  return readableLines(section)
    .map((line) => TASK.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .flatMap((match) => {
      const body = match[2].trim();
      if (body.length === 0) return [];

      const identified = TASK_ID.exec(body);

      // A title is what a person reads, so the id is taken out of it. A task
      // with no id keeps its whole line as the title and no id at all —
      // inventing one would put an identifier in the console that does not
      // exist in the file it came from. The readable tail (`· ready`,
      // `· after PP-021`) is state, not title, and is read the same way the
      // mutation layer reads it.
      const tail = splitTaskTail((identified ? identified[2] : body).trim());

      return [
        {
          id: identified?.[1],
          title: tail.title,
          completed: match[1].toLowerCase() === "x",
          ready: tail.ready || undefined,
          after: tail.after.length > 0 ? tail.after : undefined,
        },
      ];
    })
    .filter((task) => task.title.length > 0);
}

/** First run of prose, skipping headings, bullets, and `Key: value` lines. */
export function getFirstParagraph(section: string): string | undefined {
  const paragraph: string[] = [];

  for (const line of readableLines(section)) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      if (paragraph.length > 0) break;
      continue;
    }

    if (HEADING.test(line) || BULLET.test(line) || /^[A-Za-z][\w /]*:\s*\S/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }

    paragraph.push(trimmed);
  }

  const text = paragraph.join(" ").trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Value of a `Key: value` line, e.g. `State: Active` → `Active`.
 *
 * Also matches the line as a bullet, since AgentOS writes some fields as list
 * items (`- Local repository: /path/to/repo`).
 */
export function getField(section: string, field: string): string | undefined {
  const pattern = new RegExp(
    `^\\s*(?:[-*+]\\s+)?${escapeRegExp(field)}\\s*:\\s*(.+)$`,
    "im",
  );
  const value = pattern.exec(section)?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export interface TableRow {
  cells: string[];
}

/**
 * Rows of the first GFM pipe table found, header and separator removed.
 *
 * The vault currently describes the portfolio as heading blocks, but a table is
 * the other shape AgentOS uses for the same data, so both are supported.
 */
export function parseTable(markdown: string): TableRow[] {
  const rows = readableLines(markdown)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => ({
      cells: line.slice(1, -1).split("|").map((cell) => cell.trim()),
    }));

  const isSeparator = (row: TableRow) =>
    row.cells.length > 0 && row.cells.every((cell) => /^:?-{2,}:?$/.test(cell));

  const separatorIndex = rows.findIndex(isSeparator);
  return separatorIndex === -1 ? rows : rows.slice(separatorIndex + 1);
}

/**
 * Reduces prose to a single line for row-sized UI slots, keeping only the first
 * sentence when the text runs long. Short text is returned untouched.
 */
export function condenseToLine(text: string, maxLength = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;

  const sentenceEnd = /[.!?](\s|$)/.exec(collapsed);
  if (sentenceEnd && sentenceEnd.index + 1 <= maxLength) {
    return collapsed.slice(0, sentenceEnd.index + 1);
  }

  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
