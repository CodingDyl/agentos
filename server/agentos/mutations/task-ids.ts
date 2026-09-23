import fs from "node:fs/promises";
import path from "node:path";
import { uiStateDir } from "../session-store";

/**
 * Task identifiers, allocated once and never again.
 *
 * `PP-014` is not a label — it is the join key between a line in `TASKS.md`, a
 * worker job, a Hermes review, an entry in the usage ledger and a row in the
 * activity timeline. Reusing one would make every historical record about the
 * old task silently describe the new one, and there is no way to notice that
 * has happened after the fact.
 *
 * So the next id is **not** "highest in the file plus one". Delete the highest
 * task and that scheme hands the number straight back out. Instead a high-water
 * mark per prefix is kept outside the vault, and the next id is one past the
 * greater of what is in the file and what has ever been issued.
 *
 * The file is a cache with a floor, not a source of truth: if it is lost, the
 * vault still supplies a safe — if lower — starting point, and the only cost is
 * that a deleted trailing id could come back. Keeping it in `~/.agentos-ui`
 * rather than the vault is deliberate; a counter is machine bookkeeping and has
 * no business in a person's notes.
 */

function markerFile(): string {
  return path.join(uiStateDir(), "task-ids.json");
}

type Marks = Record<string, number>;

async function readMarks(): Promise<Marks> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(markerFile(), "utf8"));

    if (typeof parsed !== "object" || parsed === null) return {};

    const marks: Marks = {};

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) marks[key] = value;
    }

    return marks;
  } catch {
    return {};
  }
}

async function writeMarks(marks: Marks): Promise<void> {
  try {
    await fs.mkdir(uiStateDir(), { recursive: true });

    const target = markerFile();
    const temporary = `${target}.${process.pid}.tmp`;

    await fs.writeFile(temporary, `${JSON.stringify(marks, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
  } catch (error) {
    console.error("[agentos] could not record the task id high-water mark:", error);
  }
}

/**
 * The prefix for a project's task ids.
 *
 * What the project already uses always wins — a vault where every task is
 * `PP-00n` must keep producing `PP-`, whatever the slug happens to look like.
 * Only a project with no identified tasks falls through to a derivation, and
 * that derivation is the obvious one: initials for a multi-word slug, the first
 * two letters for a single word.
 */
export function taskPrefix(slug: string, existing: readonly string[]): string {
  for (const id of existing) {
    const match = /^([A-Z][A-Z0-9]{0,7})-\d+$/.exec(id);
    if (match) return match[1];
  }

  const words = slug.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);

  if (words.length > 1) {
    return words
      .slice(0, 4)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }

  return (words[0] ?? "task").slice(0, 2).toUpperCase();
}

/** The highest number already used under a prefix, within a set of ids. */
export function highestIn(prefix: string, ids: readonly string[]): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);

  return ids.reduce((highest, id) => {
    const match = pattern.exec(id);
    if (!match) return highest;

    return Math.max(highest, Number.parseInt(match[1], 10));
  }, 0);
}

/**
 * Issues the next id for a project, and remembers that it did.
 *
 * `existing` is every id currently in the file. The mark is raised to cover
 * whichever is higher, so an id can never be handed out twice even if the task
 * that held it was deleted an hour ago.
 */
export async function nextTaskId(
  slug: string,
  existing: readonly string[],
  options: { preferredPrefix?: string } = {},
): Promise<string> {
  // A prefix the operator configured beats both what the file uses and what
  // the slug suggests — but only for ids minted from now on. Existing ids are
  // never rewritten; a rename that changed them would break every reference.
  const prefix = options.preferredPrefix ?? taskPrefix(slug, existing);
  const marks = await readMarks();

  const key = `${slug}:${prefix}`;
  const next = Math.max(marks[key] ?? 0, highestIn(prefix, existing)) + 1;

  marks[key] = next;
  await writeMarks(marks);

  return `${prefix}-${String(next).padStart(3, "0")}`;
}
