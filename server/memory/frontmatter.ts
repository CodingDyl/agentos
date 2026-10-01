/**
 * Changing a few front matter keys without rewriting the rest.
 *
 * The vault is hand-written. Round-tripping a note's YAML through a parser and
 * a dumper would reorder its keys, drop its comments and re-quote its values —
 * a diff on every line for a change to one. So AgentOS edits front matter the
 * way a person would: it finds the line for a key it owns and replaces it,
 * appends the key when it is missing, and leaves every other byte alone.
 *
 * Only top-level keys are touched. A key's value may run onto indented or
 * `- ` continuation lines (a block list); those go with it.
 */

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/;

export type FrontmatterValue = string | boolean | readonly string[] | null | undefined;

export interface SplitNote {
  /** The front matter lines, without the fences. Empty when there is none. */
  frontmatter: string;
  hasFrontmatter: boolean;
  body: string;
}

export function splitNote(source: string): SplitNote {
  const match = BLOCK.exec(source);
  if (!match) return { frontmatter: "", hasFrontmatter: false, body: source };
  return { frontmatter: match[1], hasFrontmatter: true, body: source.slice(match[0].length) };
}

const PLAIN_ITEM = /^[\p{L}\p{N}_\-/]+$/u;

function scalar(value: string): string {
  // Always quoted: a timestamp, `yes`, `null` or `12:30` must stay a string.
  return JSON.stringify(value);
}

function render(key: string, value: Exclude<FrontmatterValue, null | undefined>): string {
  if (typeof value === "boolean") return `${key}: ${value}`;
  if (typeof value === "string") return `${key}: ${scalar(value)}`;
  return `${key}: [${value.map((item) => (PLAIN_ITEM.test(item) ? item : scalar(item))).join(", ")}]`;
}

function escapeKey(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The index range `[start, end)` of a top-level key and its continuation lines. */
function keyRange(lines: string[], key: string): [number, number] | undefined {
  const pattern = new RegExp(`^${escapeKey(key)}\\s*:`);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start < 0) return undefined;

  let end = start + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || /^-\s/.test(lines[end]) || lines[end].trim() === "")) {
    // A blank line ends the value unless more of it follows.
    if (lines[end].trim() === "") {
      const next = lines.slice(end + 1).find((line) => line.trim() !== "");
      if (!next || !(/^\s+\S/.test(next) || /^-\s/.test(next))) break;
    }
    end += 1;
  }
  return [start, end];
}

/**
 * Sets (or with `null`, removes) top-level keys. `undefined` leaves a key
 * untouched. Returns the note unchanged when nothing differs.
 */
export function patchFrontmatter(source: string, changes: Record<string, FrontmatterValue>): string {
  const split = splitNote(source);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = split.hasFrontmatter ? split.frontmatter.split(/\r?\n/) : [];

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    const range = keyRange(lines, key);

    if (value === null) {
      if (range) lines.splice(range[0], range[1] - range[0]);
      continue;
    }

    const line = render(key, value);
    if (range) lines.splice(range[0], range[1] - range[0], line);
    else lines.push(line);
  }

  const meaningful = lines.filter((line) => line.trim() !== "");
  if (meaningful.length === 0) return split.body;

  // Trailing blank lines inside the block are dropped; leading ones kept as written.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return `---${newline}${lines.join(newline)}${newline}---${newline}${split.body}`;
}

/** Replaces the body, keeping the front matter block exactly as it is. */
export function replaceBody(source: string, body: string): string {
  const match = BLOCK.exec(source);
  const normalised = body.replace(/\r\n/g, "\n");
  const text = normalised.endsWith("\n") ? normalised : `${normalised}\n`;
  return match ? `${match[0]}${text}` : text;
}
