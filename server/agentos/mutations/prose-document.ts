/**
 * Editing one section of a prose document without disturbing the rest.
 *
 * `STATUS.md`, `PROJECT.md` and `DECISIONS.md` are essays with headings, not
 * records. The console needs to replace the body under `## Current Stage`
 * while leaving four other sections — and whatever the operator wrote between
 * them — exactly as they were.
 *
 * Same line-preserving discipline as the task document: find the section's
 * extent, splice its body, leave every other line untouched. Nothing here
 * reformats, reflows or normalises anything it was not asked to change.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface SectionRange {
  headingIndex: number;
  level: number;
  title: string;
  start: number;
  end: number;
}

/** Locates a section by heading text, at any level. */
export function findSection(
  lines: readonly string[],
  heading: string,
): SectionRange | undefined {
  const target = normalise(heading);

  for (let index = 0; index < lines.length; index += 1) {
    const match = HEADING.exec(lines[index]);
    if (!match) continue;

    if (normalise(match[2]) !== target) continue;

    const level = match[1].length;
    let end = lines.length;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = HEADING.exec(lines[cursor]);

      if (next && next[1].length <= level) {
        end = cursor;
        break;
      }
    }

    return { headingIndex: index, level, title: match[2].trim(), start: index + 1, end };
  }

  return undefined;
}

/** Every `##` section's title, in document order. */
export function sectionTitles(markdown: string, level = 2): string[] {
  return markdown
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = HEADING.exec(line);

      return match && match[1].length === level ? [match[2].trim()] : [];
    });
}

/** The body under one heading, or `undefined` when there is no such section. */
export function readSection(
  markdown: string,
  heading: string,
): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const range = findSection(lines, heading);

  if (!range) return undefined;

  return lines.slice(range.start, range.end).join("\n").trim();
}

/**
 * Replaces a section's body, adding the section when it is missing.
 *
 * The blank line after the heading is restored deliberately: the vault is
 * written with one, and a mutation that closed the gap would make every edited
 * section look subtly different from the ones beside it.
 */
export function setSection(
  markdown: string,
  heading: string,
  body: string,
  level = 2,
): string {
  const trailingNewline = markdown.endsWith("\n");
  const lines = markdown.split(/\r?\n/);

  if (trailingNewline) lines.pop();

  const range = findSection(lines, heading);
  const replacement = ["", body.trimEnd(), ""];

  if (range) {
    lines.splice(range.start, range.end - range.start, ...replacement);
  } else {
    // A new section goes at the end, after a separating blank line.
    while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
      lines.pop();
    }

    lines.push("", `${"#".repeat(level)} ${heading}`, ...replacement);
  }

  const result = lines.join("\n").replace(/\n{3,}/g, "\n\n");

  return trailingNewline ? `${result.replace(/\n+$/, "")}\n` : result;
}

/** Removes a section and its body entirely. */
export function removeSection(markdown: string, heading: string): string {
  const trailingNewline = markdown.endsWith("\n");
  const lines = markdown.split(/\r?\n/);

  if (trailingNewline) lines.pop();

  const range = findSection(lines, heading);
  if (!range) return markdown;

  lines.splice(range.headingIndex, range.end - range.headingIndex);

  const result = lines.join("\n").replace(/\n{3,}/g, "\n\n");

  return trailingNewline ? `${result.replace(/\n+$/, "")}\n` : result;
}

/**
 * Whether a document is only a placeholder.
 *
 * Three of four projects in a real vault say "No confirmed decisions recorded
 * yet." — a sentence that should be *replaced* by the first decision, not left
 * sitting above it contradicting the list underneath.
 */
export function isPlaceholder(markdown: string): boolean {
  const body = markdown
    .split(/\r?\n/)
    .filter((line) => !/^#\s/.test(line))
    .join(" ")
    .trim();

  return /^no\b.*\b(recorded|promoted|yet)\b/i.test(body);
}
