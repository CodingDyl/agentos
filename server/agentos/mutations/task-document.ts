/**
 * `TASKS.md`, as a document that can be edited without being rewritten.
 *
 * The hard requirement here is not parsing tasks — the reader already does
 * that. It is **writing the file back without touching anything that is not a
 * task.** A real vault file looks like this:
 *
 * ```markdown
 * ## Later
 *
 * Only move items here once current work is stable.
 *
 * ## Rule
 *
 * Prefer completing existing tasks before adding additional features.
 * ```
 *
 * None of that is structured data, all of it is the operator's own writing, and
 * a mutation layer that reconstructed the file from a parsed model would
 * quietly delete it the first time someone ticked a checkbox.
 *
 * So the model is **line-preserving**: every line of the file becomes a block
 * that remembers its own raw text, and only task lines carry structure. Editing
 * rewrites exactly the lines that changed; serialising is reassembly, not
 * regeneration. Prose, blank lines, indentation, `*` bullets and unknown
 * headings all survive by construction rather than by care.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const TASK = /^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/;
const TASK_ID = /^\[([A-Z][A-Z0-9]{0,7}-\d{1,5})\]\s*(.*)$/;

/**
 * The sections a task can be filed under.
 *
 * `archived` is out of circulation without being done: the line keeps its id
 * and text so worker jobs and usage still resolve to something readable, and
 * the board hides it by default.
 */
export type TaskSectionName = "now" | "next" | "later" | "done" | "archived";

/** How each section is written when AgentOS has to create one. */
const SECTION_HEADINGS: Record<TaskSectionName, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
  done: "Done",
  archived: "Archived",
};

/** The order sections are created in, when one is missing. */
const SECTION_ORDER: readonly TaskSectionName[] = ["now", "next", "later", "done", "archived"];

export interface HeadingBlock {
  kind: "heading";
  raw: string;
  level: number;
  title: string;
}

export interface TaskBlock {
  kind: "task";
  raw: string;
  indent: string;
  marker: string;
  completed: boolean;
  id?: string;
  title: string;
  /** The operator has flagged this as ready to pick up. `· ready` on the line. */
  ready?: boolean;
  /** Ids this task waits on. `· after PP-021, PP-022` on the line. */
  after?: string[];
}

/**
 * The readable tail a task line may carry after its title:
 *
 * ```markdown
 * - [ ] [PP-024] Chef polish · ready · after PP-021, PP-022
 * ```
 *
 * Two markers only, both optional, separated from the title and each other by
 * ` · `. A title that happens to contain ` · ` keeps every segment that is not
 * one of the two markers, so prose is never eaten. Everything else about a
 * task's state is derived rather than written.
 */
const TAIL_SEPARATOR = " · ";
const READY_MARKER = /^ready$/i;
const AFTER_MARKER = /^after\s+(.+)$/i;
const TASK_REF = /^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/;

export function splitTaskTail(body: string): { title: string; ready: boolean; after: string[] } {
  const segments = body.split(TAIL_SEPARATOR);
  const kept: string[] = [];
  let ready = false;
  const after: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();

    if (READY_MARKER.test(trimmed)) {
      ready = true;
      continue;
    }

    const dependency = AFTER_MARKER.exec(trimmed);

    if (dependency) {
      const ids = dependency[1]
        .split(/[,\s]+/)
        .map((id) => id.trim().toUpperCase())
        .filter((id) => TASK_REF.test(id));

      if (ids.length > 0) {
        after.push(...ids);
        continue;
      }
    }

    kept.push(segment);
  }

  return { title: kept.join(TAIL_SEPARATOR).trim(), ready, after: [...new Set(after)] };
}

export function renderTaskTail(task: Pick<TaskBlock, "ready" | "after">): string {
  const parts: string[] = [];
  if (task.ready) parts.push("ready");
  if (task.after && task.after.length > 0) parts.push(`after ${task.after.join(", ")}`);

  return parts.map((part) => `${TAIL_SEPARATOR}${part}`).join("");
}

/** Anything that is not a heading or a task. Kept verbatim, always. */
export interface TextBlock {
  kind: "text";
  raw: string;
}

export type Block = HeadingBlock | TaskBlock | TextBlock;

export interface TaskDocument {
  blocks: Block[];
  /** True when the file ended with a newline, so serialising restores it. */
  trailingNewline: boolean;
}

function sectionKey(title: string): TaskSectionName | undefined {
  const normalised = title.trim().toLowerCase().replace(/[^a-z]/g, "");

  return (SECTION_ORDER as readonly string[]).includes(normalised)
    ? (normalised as TaskSectionName)
    : undefined;
}

/**
 * Reads a file into blocks.
 *
 * Fenced code is passed through as text without being examined, so a `- [ ]`
 * inside an example block is never mistaken for a task the console can tick.
 */
export function parseTaskDocument(markdown: string): TaskDocument {
  const trailingNewline = markdown.endsWith("\n");
  const lines = markdown.split(/\r?\n/);

  // A trailing newline produces a final empty element that is not a line.
  if (trailingNewline) lines.pop();

  const blocks: Block[] = [];
  let inFence = false;

  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      blocks.push({ kind: "text", raw });
      continue;
    }

    if (inFence) {
      blocks.push({ kind: "text", raw });
      continue;
    }

    const heading = HEADING.exec(raw);

    if (heading) {
      blocks.push({
        kind: "heading",
        raw,
        level: heading[1].length,
        title: heading[2].trim(),
      });
      continue;
    }

    const task = TASK.exec(raw);

    if (task) {
      const body = task[4].trim();
      const identified = TASK_ID.exec(body);
      const tail = splitTaskTail((identified ? identified[2] : body).trim());

      blocks.push({
        kind: "task",
        raw,
        indent: task[1],
        marker: task[2],
        completed: task[3].toLowerCase() === "x",
        id: identified?.[1],
        title: tail.title,
        ready: tail.ready || undefined,
        after: tail.after.length > 0 ? tail.after : undefined,
      });
      continue;
    }

    blocks.push({ kind: "text", raw });
  }

  return { blocks, trailingNewline };
}

/** One task line, written out. */
export function renderTask(task: TaskBlock): string {
  const box = task.completed ? "x" : " ";
  const id = task.id ? `[${task.id}] ` : "";

  return `${task.indent}${task.marker} [${box}] ${id}${task.title}${renderTaskTail(task)}`.trimEnd();
}

/**
 * Blocks back into a file.
 *
 * A task block whose structure still matches its `raw` keeps the original line,
 * so re-saving a file nobody edited is a genuine no-op down to the byte — which
 * is what lets the writer skip the disk entirely and what stops an untouched
 * file gaining a new revision.
 */
export function serializeTaskDocument(document: TaskDocument): string {
  const body = document.blocks
    .map((block) => (block.kind === "task" ? renderTask(block) : block.raw))
    .join("\n");

  return document.trailingNewline ? `${body}\n` : body;
}

/** Where a section's content begins and ends, exclusive of its heading. */
interface SectionRange {
  headingIndex: number;
  start: number;
  end: number;
}

function findSection(
  document: TaskDocument,
  section: TaskSectionName,
): SectionRange | undefined {
  const headingIndex = document.blocks.findIndex(
    (block) => block.kind === "heading" && sectionKey(block.title) === section,
  );

  if (headingIndex === -1) return undefined;

  const heading = document.blocks[headingIndex] as HeadingBlock;

  let end = document.blocks.length;

  for (let index = headingIndex + 1; index < document.blocks.length; index += 1) {
    const block = document.blocks[index];

    if (block.kind === "heading" && block.level <= heading.level) {
      end = index;
      break;
    }
  }

  return { headingIndex, start: headingIndex + 1, end };
}

/** Every task in a section, with its index in the block list. */
export function tasksInSection(
  document: TaskDocument,
  section: TaskSectionName,
): { block: TaskBlock; index: number }[] {
  const range = findSection(document, section);
  if (!range) return [];

  const found: { block: TaskBlock; index: number }[] = [];

  for (let index = range.start; index < range.end; index += 1) {
    const block = document.blocks[index];
    if (block.kind === "task") found.push({ block, index });
  }

  return found;
}

/** Every task in the document, whichever section it is in. */
export function allTasks(document: TaskDocument): TaskBlock[] {
  return document.blocks.filter((block): block is TaskBlock => block.kind === "task");
}

export function findTask(
  document: TaskDocument,
  id: string,
): { block: TaskBlock; index: number; section?: TaskSectionName } | undefined {
  const index = document.blocks.findIndex(
    (block) => block.kind === "task" && block.id === id,
  );

  if (index === -1) return undefined;

  return {
    block: document.blocks[index] as TaskBlock,
    index,
    section: sectionOf(document, index),
  };
}

/** Which section a block index falls under, if any. */
export function sectionOf(
  document: TaskDocument,
  index: number,
): TaskSectionName | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const block = document.blocks[cursor];

    if (block.kind === "heading") return sectionKey(block.title);
  }

  return undefined;
}

/**
 * Creates a section that does not exist yet, and says where its content starts.
 *
 * Placed in canonical order against whichever sibling sections are present, so
 * a new `## Done` lands after `## Later` rather than at the end of a file that
 * happens to close with the operator's own `## Rule`. When no sibling exists at
 * all, it goes at the end — there is nothing to be in order with.
 */
function createSection(
  document: TaskDocument,
  section: TaskSectionName,
): SectionRange {
  const position = SECTION_ORDER.indexOf(section);

  let insertAt = document.blocks.length;

  // After the last section that should precede this one.
  for (let index = 0; index < document.blocks.length; index += 1) {
    const block = document.blocks[index];
    if (block.kind !== "heading") continue;

    const key = sectionKey(block.title);
    if (!key) continue;

    if (SECTION_ORDER.indexOf(key) < position) {
      const range = findSection(document, key);
      if (range) insertAt = range.end;
    }
  }

  const heading: HeadingBlock = {
    kind: "heading",
    raw: `## ${SECTION_HEADINGS[section]}`,
    level: 2,
    title: SECTION_HEADINGS[section],
  };

  const blank: TextBlock = { kind: "text", raw: "" };

  // A blank line before the heading unless the document already ends in one,
  // so headings never weld themselves onto the line above.
  const needsLeadingBlank =
    insertAt > 0 && document.blocks[insertAt - 1]?.raw.trim().length > 0;

  const inserted: Block[] = needsLeadingBlank
    ? [blank, heading, blank]
    : [heading, blank];

  document.blocks.splice(insertAt, 0, ...inserted);

  const headingIndex = insertAt + (needsLeadingBlank ? 1 : 0);

  return {
    headingIndex,
    start: headingIndex + 1,
    end: headingIndex + 2,
  };
}

/**
 * Where a new task should go inside a section.
 *
 * After the last existing task, so ordering is stable and a new item joins the
 * bottom of the list rather than jumping the queue. In a section with no tasks
 * it goes after the prose, before the trailing blank lines — which is what
 * keeps "Only move items here once current work is stable." above the list
 * rather than stranded beneath it.
 */
function insertionPoint(document: TaskDocument, range: SectionRange): number {
  const tasks: number[] = [];

  for (let index = range.start; index < range.end; index += 1) {
    if (document.blocks[index].kind === "task") tasks.push(index);
  }

  if (tasks.length > 0) return tasks[tasks.length - 1] + 1;

  let end = range.end;

  while (end > range.start && document.blocks[end - 1].raw.trim().length === 0) {
    end -= 1;
  }

  // Keep the blank line the vault writes under every heading. Trimming back to
  // the heading itself produces valid markdown that looks nothing like the
  // rest of the file, and these are documents a person reads.
  if (
    end === range.start &&
    document.blocks[range.start]?.raw.trim().length === 0
  ) {
    return range.start + 1;
  }

  return end;
}

export interface NewTask {
  id: string;
  title: string;
  completed?: boolean;
}

/** Adds a task to a section, creating the section if it is missing. */
export function insertTask(
  document: TaskDocument,
  section: TaskSectionName,
  task: NewTask,
): TaskBlock {
  const range = findSection(document, section) ?? createSection(document, section);
  const at = insertionPoint(document, range);

  const block: TaskBlock = {
    kind: "task",
    raw: "",
    indent: "",
    marker: "-",
    completed: task.completed ?? false,
    id: task.id,
    title: task.title,
  };

  block.raw = renderTask(block);

  // A section that was prose-only needs a blank line between the prose and the
  // list it is about to grow.
  const previous = document.blocks[at - 1];
  const needsGap =
    previous !== undefined &&
    previous.kind === "text" &&
    previous.raw.trim().length > 0;

  document.blocks.splice(at, 0, ...(needsGap ? [{ kind: "text" as const, raw: "" }, block] : [block]));

  return block;
}

/** Removes a task. Returns the block that was removed, or `undefined`. */
export function removeTask(
  document: TaskDocument,
  id: string,
): TaskBlock | undefined {
  const found = findTask(document, id);
  if (!found) return undefined;

  document.blocks.splice(found.index, 1);

  return found.block;
}

/**
 * Moves a task to a section, optionally to a position within it.
 *
 * Implemented as remove-then-insert against the *live* document so indices
 * cannot go stale between the two halves — the bug this shape exists to make
 * impossible.
 */
export function moveTask(
  document: TaskDocument,
  id: string,
  section: TaskSectionName,
  position?: number,
): TaskBlock | undefined {
  const existing = removeTask(document, id);
  if (!existing) return undefined;

  const range = findSection(document, section) ?? createSection(document, section);

  const tasks: number[] = [];

  for (let index = range.start; index < range.end; index += 1) {
    if (document.blocks[index].kind === "task") tasks.push(index);
  }

  const at =
    position === undefined || position >= tasks.length || tasks.length === 0
      ? insertionPoint(document, range)
      : tasks[Math.max(position, 0)];

  const previous = document.blocks[at - 1];
  const needsGap =
    previous !== undefined &&
    previous.kind === "text" &&
    previous.raw.trim().length > 0;

  existing.raw = renderTask(existing);

  document.blocks.splice(
    at,
    0,
    ...(needsGap ? [{ kind: "text" as const, raw: "" }, existing] : [existing]),
  );

  return existing;
}

/** Rewrites one task's title or completion. */
export function updateTask(
  document: TaskDocument,
  id: string,
  patch: { title?: string; completed?: boolean; ready?: boolean; after?: string[] },
): TaskBlock | undefined {
  const found = findTask(document, id);
  if (!found) return undefined;

  const after = patch.after === undefined ? found.block.after : patch.after;

  const next: TaskBlock = {
    ...found.block,
    title: patch.title?.trim() || found.block.title,
    completed: patch.completed ?? found.block.completed,
    ready: (patch.ready ?? found.block.ready) || undefined,
    after: after && after.length > 0 ? [...new Set(after)] : undefined,
  };

  next.raw = renderTask(next);
  document.blocks[found.index] = next;

  return next;
}

/**
 * Reorders a section's tasks to match the given ids.
 *
 * Only the task lines move; the prose between them stays exactly where it is.
 * Any task in the section that the caller did not mention keeps its relative
 * order at the end, so a stale list from a screen that missed a new task
 * cannot silently delete it.
 */
export function reorderSection(
  document: TaskDocument,
  section: TaskSectionName,
  ids: readonly string[],
): boolean {
  const present = tasksInSection(document, section);
  if (present.length === 0) return false;

  const byId = new Map(
    present.flatMap(({ block }) => (block.id ? [[block.id, block] as const] : [])),
  );

  const ordered: TaskBlock[] = [];

  for (const id of ids) {
    const block = byId.get(id);

    if (block && !ordered.includes(block)) ordered.push(block);
  }

  for (const { block } of present) {
    if (!ordered.includes(block)) ordered.push(block);
  }

  present.forEach(({ index }, position) => {
    document.blocks[index] = ordered[position];
  });

  return true;
}
