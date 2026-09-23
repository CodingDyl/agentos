/**
 * `PORTFOLIO.md`, edited in place.
 *
 * The portfolio — not `PROJECT.md` — is where a project's state, priority, type
 * and one-line goal actually live, so changing "Active" to "Paused" on screen
 * means editing a `### Pantry Pilot` block here. Same discipline as the task
 * document: only the lines that change are rewritten, and the operator's own
 * `## Rules` section at the bottom survives untouched.
 *
 * Entries are addressed by slug rather than by display name, matched the way
 * the reader matches them — normalised, punctuation removed — so `Pantry Pilot`
 * and `pantry-pilot` resolve to the same block without the caller having to
 * know which spelling the file happens to use.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface PortfolioEntryRange {
  /** Index of the `### Name` line. */
  headingIndex: number;
  /** First line of the entry's body. */
  start: number;
  /** One past the entry's last line. */
  end: number;
  name: string;
}

/** Locates a project's block by slug or display name. */
export function findEntry(
  lines: readonly string[],
  slugOrName: string,
): PortfolioEntryRange | undefined {
  const target = normalise(slugOrName);

  for (let index = 0; index < lines.length; index += 1) {
    const heading = HEADING.exec(lines[index]);
    if (!heading || heading[1].length !== 3) continue;

    const name = heading[2].trim();
    if (normalise(name) !== target) continue;

    let end = lines.length;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = HEADING.exec(lines[cursor]);

      if (next && next[1].length <= 3) {
        end = cursor;
        break;
      }
    }

    return { headingIndex: index, start: index + 1, end, name };
  }

  return undefined;
}

/**
 * Sets a `Key: value` line inside one entry.
 *
 * Adds the line when it is missing rather than failing — a portfolio written
 * before a field existed should gain it on first edit, not refuse the edit.
 * The new line goes after the last existing field so it joins the block of
 * metadata rather than landing in the middle of the goal.
 */
export function setEntryField(
  lines: string[],
  range: PortfolioEntryRange,
  field: string,
  value: string,
): void {
  const pattern = new RegExp(`^\\s*(?:[-*+]\\s+)?${field}\\s*:\\s*`, "i");

  for (let index = range.start; index < range.end; index += 1) {
    if (pattern.test(lines[index])) {
      lines[index] = `${field}: ${value}`;
      return;
    }
  }

  let insertAt = range.start;

  for (let index = range.start; index < range.end; index += 1) {
    if (/^\s*[A-Za-z][\w /]*:\s*\S/.test(lines[index])) insertAt = index + 1;
  }

  lines.splice(insertAt, 0, `${field}: ${value}`);
  range.end += 1;
}

/**
 * Replaces the prose under a `Goal:` lead-in.
 *
 * The vault writes goals as a `Goal:` line followed by the text on the lines
 * beneath it, so this is not a field edit — the old prose is removed up to the
 * next blank-line-then-field or the end of the entry, and the new text takes
 * its place.
 */
export function setEntryGoal(
  lines: string[],
  range: PortfolioEntryRange,
  goal: string,
): void {
  const goalIndex = lines.findIndex(
    (line, index) =>
      index >= range.start && index < range.end && /^\s*Goal\s*:/i.test(line),
  );

  if (goalIndex === -1) {
    const at = range.end;
    const needsGap = lines[at - 1]?.trim().length > 0;

    lines.splice(at, 0, ...(needsGap ? ["", "Goal:", goal] : ["Goal:", goal]));
    range.end += needsGap ? 3 : 2;
    return;
  }

  // Everything after the lead-in that is prose belongs to the goal.
  let end = goalIndex + 1;

  while (
    end < range.end &&
    !/^\s*[A-Za-z][\w /]*:\s*\S/.test(lines[end]) &&
    !HEADING.test(lines[end])
  ) {
    end += 1;
  }

  // Keep any trailing blank line that separated the entry from the next.
  let trailing = end;
  while (trailing > goalIndex + 1 && lines[trailing - 1].trim().length === 0) {
    trailing -= 1;
  }

  const removed = trailing - (goalIndex + 1);

  lines.splice(goalIndex + 1, removed, goal);
  range.end += 1 - removed;
}

export interface NewPortfolioEntry {
  name: string;
  type: string;
  state: string;
  priority: string;
  goal?: string;
}

/**
 * Adds a project to the portfolio.
 *
 * Appended to the end of the `## Projects` section rather than the end of the
 * file, because the file ends with the operator's `## Rules` and a project
 * filed underneath those would read as one of them.
 */
export function appendEntry(markdown: string, entry: NewPortfolioEntry): string {
  const trailingNewline = markdown.endsWith("\n");
  const lines = markdown.split(/\r?\n/);

  if (trailingNewline) lines.pop();

  let insertAt = lines.length;

  const projectsIndex = lines.findIndex((line) => {
    const heading = HEADING.exec(line);

    return heading !== null && normalise(heading[2]) === "projects";
  });

  if (projectsIndex !== -1) {
    const level = (HEADING.exec(lines[projectsIndex]) as RegExpExecArray)[1].length;

    insertAt = lines.length;

    for (let index = projectsIndex + 1; index < lines.length; index += 1) {
      const heading = HEADING.exec(lines[index]);

      if (heading && heading[1].length <= level) {
        insertAt = index;
        break;
      }
    }
  }

  // Back over any blank lines so the new block sits against the last entry.
  while (insertAt > 0 && lines[insertAt - 1].trim().length === 0) insertAt -= 1;

  const block = [
    "",
    `### ${entry.name}`,
    `Type: ${entry.type}`,
    `State: ${entry.state}`,
    `Priority: ${entry.priority}`,
  ];

  if (entry.goal) block.push("", "Goal:", entry.goal);

  lines.splice(insertAt, 0, ...block);

  const body = lines.join("\n");

  return trailingNewline ? `${body}\n` : body;
}

/**
 * The goal text of one entry, as the settings sheet needs it back.
 *
 * Reads what `setEntryGoal` writes: the prose after `Goal:` up to the next
 * field or heading, joined into one line. Absent when the entry has no goal.
 */
export function readPortfolioGoal(markdown: string, slug: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const range = findEntry(lines, slug);
  if (!range) return undefined;

  const goalIndex = lines.findIndex(
    (line, index) =>
      index >= range.start && index < range.end && /^\s*Goal\s*:/i.test(line),
  );

  if (goalIndex === -1) return undefined;

  // `Goal: inline text` is also accepted.
  const inline = /^\s*Goal\s*:\s*(.+)$/i.exec(lines[goalIndex])?.[1]?.trim();
  const collected: string[] = inline ? [inline] : [];

  for (let index = goalIndex + 1; index < range.end; index += 1) {
    const line = lines[index];

    if (HEADING.test(line) || /^\s*[A-Za-z][\w /]*:\s*\S/.test(line)) break;
    if (line.trim().length > 0) collected.push(line.trim());
  }

  return collected.length > 0 ? collected.join(" ") : undefined;
}
