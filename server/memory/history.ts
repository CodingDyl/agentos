import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryHistoryEntry } from "../../shared/memory-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * What AgentOS has done to each note, and how to take it back.
 *
 * Kept outside the vault, beside the backups it points at: the note itself
 * carries its provenance (who made it, from which task), and this carries
 * the change log — every edit, archive and restore, with the revision before
 * and after and the backup that can undo it.
 *
 * One small JSON file per note, so a busy note cannot push another's history
 * out of reach, and capped, because this is an undo trail rather than version
 * control. Changes made in Obsidian are not here; they never passed through
 * AgentOS, which is also why an undo refuses to run over them.
 */

const ENTRIES_PER_NOTE = 60;

export function memoryHistoryDir(): string {
  return path.join(uiStateDir(), "memory-history");
}

function fileFor(noteId: string): string {
  const key = createHash("sha256").update(noteId).digest("hex").slice(0, 32);
  return path.join(memoryHistoryDir(), `${key}.json`);
}

interface HistoryFile {
  noteId: string;
  entries: MemoryHistoryEntry[];
}

export async function readHistory(noteId: string): Promise<MemoryHistoryEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(fileFor(noteId), "utf8")) as HistoryFile;
    if (parsed.noteId !== noteId || !Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.at === "string")
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  } catch {
    return [];
  }
}

async function writeHistory(noteId: string, entries: MemoryHistoryEntry[]): Promise<void> {
  const file = fileFor(noteId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const payload: HistoryFile = { noteId, entries: entries.slice(0, ENTRIES_PER_NOTE) };
  await fs.writeFile(temporary, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(temporary, file);
}

/** Serialised per process, so two quick edits cannot drop each other's entry. */
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export function appendHistory(entry: Omit<MemoryHistoryEntry, "id" | "at"> & { at?: string }): Promise<MemoryHistoryEntry> {
  return serial(async () => {
    const full: MemoryHistoryEntry = {
      ...entry,
      id: `mh-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      at: entry.at ?? new Date().toISOString(),
    };
    const existing = await readHistory(entry.noteId);
    await writeHistory(entry.noteId, [full, ...existing]);
    return full;
  });
}

export function markUndone(noteId: string, entryId: string, at: string): Promise<void> {
  return serial(async () => {
    const entries = await readHistory(noteId);
    await writeHistory(
      noteId,
      entries.map((entry) => (entry.id === entryId ? { ...entry, undoneAt: at } : entry)),
    );
  });
}

/**
 * The change an undo would revert right now: the newest one, if it has a
 * backup, is not already undone, and nothing has changed the note since.
 *
 * Only ever the newest. Undoing an older change would discard every later
 * one with it, which is exactly the silent overwrite this exists to prevent.
 */
export function undoableEntry(entries: readonly MemoryHistoryEntry[], currentRevision: string | undefined): MemoryHistoryEntry | undefined {
  const newest = entries[0];
  if (!newest || !newest.backupId || newest.undoneAt) return undefined;
  if (currentRevision === undefined || newest.revisionAfter !== currentRevision) return undefined;
  return newest;
}
