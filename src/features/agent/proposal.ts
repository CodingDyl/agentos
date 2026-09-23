/**
 * Reads the change proposal out of a Hermes reply.
 *
 * A mutation-capable skill states what it intends to change before it changes
 * anything, in a predictable section. This finds that section and turns it into
 * something the console can render as a proposal rather than as prose.
 *
 * Deliberately not a patch protocol: nothing here describes *how* to apply a
 * change, and the console never applies one. It only shows what Hermes says it
 * will do, so the decision is made against a readable summary. Hermes remains
 * the only thing that writes.
 */

/** How a single proposed line is marked, when Hermes marks it. */
export type ChangeKind = "add" | "complete" | "remove" | "edit";

export interface ProposedChange {
  kind: ChangeKind;
  /** The line as Hermes wrote it, minus its marker. Never reworded. */
  text: string;
}

export interface ProposedFile {
  /** The file as named in the proposal, e.g. `TASKS.md`. */
  file: string;
  changes: ProposedChange[];
  /** True when Hermes explicitly said this file is untouched. */
  unchanged: boolean;
}

export interface ChangeProposal {
  /** The heading Hermes used, e.g. `Proposed update`. */
  heading: string;
  files: ProposedFile[];
  /** Everything before the proposal — Hermes' reasoning, left as markdown. */
  preamble: string;
}

/**
 * Recognises the section heading, however Hermes decorates it.
 *
 * The mutation skills name the thing being changed in the middle of the
 * heading — `Proposed AgentOS Update`, `Proposed Portfolio Update` — so words
 * are allowed between. The end anchor keeps it from matching the same words in
 * a sentence.
 */
const HEADING = /^proposed(?:\s+[\w-]+)*\s+(?:changes?|updates?)\s*:?$/i;

/** A line saying a file is deliberately untouched. */
const NO_CHANGE = /^(?:no\s+changes?|unchanged|none)\.?$/i;

/** Bullet markers that carry meaning, beyond plain list punctuation. */
const MARKERS: [RegExp, ChangeKind][] = [
  [/^[✓✔]\s*/u, "complete"],
  [/^\+\s*/, "add"],
  [/^[✗✘×~]\s*/u, "remove"],
];

/** Strips markdown emphasis and heading punctuation from a line. */
function bare(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/^__(.*)__$/, "$1")
    .replace(/^\*(.*)\*$/, "$1")
    .trim();
}

/**
 * Whether a line is a decorated label — a bold run or a markdown heading.
 *
 * The skills close a proposal with one (`**Reason**`, `**Estimated benefit**`),
 * so a label that is not a filename marks the end of the file list rather than
 * more content belonging to the file above it.
 */
function isLabel(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s+\S/.test(trimmed) ||
    /^\*\*.+\*\*$/.test(trimmed) ||
    /^__.+__$/.test(trimmed)
  );
}

/** Whether a line is a list item, and what remains of it. */
function bullet(line: string): string | undefined {
  const trimmed = line.trim();
  const match = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(trimmed);
  if (match) return match[1].trim();

  // A marker can stand in for the bullet punctuation entirely.
  if (MARKERS.some(([pattern]) => pattern.test(trimmed))) return trimmed;

  return undefined;
}

/** Classifies a bullet by its marker, defaulting to a plain edit. */
function readChange(text: string): ProposedChange {
  for (const [pattern, kind] of MARKERS) {
    if (pattern.test(text)) {
      return { kind, text: text.replace(pattern, "").trim() };
    }
  }

  return { kind: "edit", text: bare(text) };
}

/**
 * Whether a line names a file.
 *
 * Kept narrow on purpose: a bare sentence must not become a file heading and
 * turn Hermes' prose into a fake proposal.
 */
function fileName(line: string): string | undefined {
  const name = bare(line).replace(/:$/, "").trim();
  if (!name || name.includes(" ")) return undefined;

  // A file, named by its extension.
  if (/\.(?:md|markdown|json|ya?ml|txt)$/i.test(name)) return name;

  // Or a directory items are archived into, e.g. `archive/logs/daily/2026-09/`.
  // The trailing slash is what separates a path from an ordinary word.
  if (name.includes("/") && name.endsWith("/")) return name;

  return undefined;
}

/**
 * Finds the proposal in a reply, or `undefined` when there is none.
 *
 * A reply without the section is ordinary prose and is rendered as such — this
 * never invents a proposal from text that does not declare one.
 */
export function readProposal(markdown: string): ChangeProposal | undefined {
  const lines = markdown.split(/\r?\n/);

  const headingIndex = lines.findIndex((line) => HEADING.test(bare(line)));
  if (headingIndex === -1) return undefined;

  const files: ProposedFile[] = [];
  let current: ProposedFile | undefined;

  for (const line of lines.slice(headingIndex + 1)) {
    if (line.trim().length === 0) continue;

    // A horizontal rule is decoration around the section, not content.
    if (/^[-=_*]{3,}$/.test(line.trim())) continue;

    const item = bullet(line);

    if (item !== undefined) {
      if (!current) continue;

      if (NO_CHANGE.test(bare(item))) {
        current.unchanged = true;
        continue;
      }

      current.changes.push(readChange(item));
      continue;
    }

    const name = fileName(line);

    if (name) {
      current = { file: name, changes: [], unchanged: false };
      files.push(current);
      continue;
    }

    if (current && NO_CHANGE.test(bare(line))) {
      current.unchanged = true;
      continue;
    }

    // A labelled block that names no file closes the proposal: it is the
    // skill's commentary on the change, not another file being changed.
    if (isLabel(line)) break;

    // Free text under a file is part of that file's proposal; before the first
    // file heading it belongs to no file, and the section has ended.
    if (current) {
      current.changes.push(readChange(line.trim()));
      continue;
    }
  }

  // A heading with nothing under it is not a proposal.
  if (files.length === 0) return undefined;

  return {
    heading: bare(lines[headingIndex]),
    files,
    preamble: lines.slice(0, headingIndex).join("\n").trim(),
  };
}

/** How many files the proposal actually changes. */
export function changedFileCount(proposal: ChangeProposal): number {
  return proposal.files.filter(
    (file) => !file.unchanged && file.changes.length > 0,
  ).length;
}
