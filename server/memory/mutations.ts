import {
  isMemoryType,
  type EditMemoryNoteRequest,
  type MemoryHistoryAction,
  type MemoryMutationResponse,
  type MemoryType,
} from "../../shared/memory-types";
import { normaliseTag } from "../../shared/memory-paths";
import { RevisionConflictError, revisionOfOptional } from "../agentos/mutations/revision";
import { DocumentInvalidError, editFile, readBackup } from "../agentos/mutations/writer";
import { readOptionalFile } from "../agentos/filesystem";
import { containedRealPath, isExcluded, probeVault } from "./config";
import { patchFrontmatter, replaceBody, splitNote } from "./frontmatter";
import { appendHistory, markUndone, readHistory, undoableEntry } from "./history";
import type { MemoryService } from "./service";

/**
 * Changing memory that already exists.
 *
 * Every change goes through the vault's one write path (`editFile`): the
 * revision the screen was showing is checked against the file on disk, the
 * old contents are backed up, and the new ones are written atomically. A note
 * edited in Obsidian meanwhile is a 409 with the current revision — never a
 * silent overwrite.
 *
 * Provenance is the server's to write. A request can change a note's body,
 * type and tags; who created it, when, and from which task are carried over
 * from the file as it is on disk, and `updatedBy`/`updatedAt` are stamped
 * here. Every change is logged with the backup that can undo it, and the note
 * is re-indexed before the call returns, so the screen reads the new state.
 */

export const HUMAN = "human";

const MAX_BODY = 200 * 1024;
const MAX_TAGS = 12;

export class MemoryMutationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503,
    readonly currentRevision?: string,
  ) {
    super(message);
  }
}

/** Checks the note may be written: indexed, inside the vault, vault present. */
async function writable(service: MemoryService, id: string): Promise<void> {
  if (typeof id !== "string" || !id.endsWith(".md") || isExcluded(id)) {
    throw new MemoryMutationError("That is not a note AgentOS can edit.", 400);
  }
  if (!service.index.notes.has(id)) {
    throw new MemoryMutationError("There is no note with that id in the vault index.", 404);
  }
  const probe = await probeVault(service.root);
  if (!probe.available) throw new MemoryMutationError(`The vault is not available: ${probe.reason}`, 503);

  const real = await containedRealPath(service.root, id).catch(() => undefined);
  if (!real) throw new MemoryMutationError("That note is outside the vault.", 400);
}

interface MutateOptions {
  id: string;
  expectedRevision?: string;
  by: string;
  action: MemoryHistoryAction;
  summary: string;
  sourceTask?: string;
  apply: (current: string) => string;
}

/** The single path every memory change takes. */
async function mutate(service: MemoryService, options: MutateOptions): Promise<MemoryMutationResponse> {
  await writable(service, options.id);

  if (typeof options.expectedRevision !== "string" || !options.expectedRevision.startsWith("sha256:")) {
    throw new MemoryMutationError("An edit needs the revision it was made against.", 400);
  }

  const before = await readOptionalFile(options.id, service.root);
  if (before === undefined) throw new MemoryMutationError("That note is no longer in the vault.", 404);

  let result;
  try {
    result = await editFile({
      relativePath: options.id,
      root: service.root,
      expectedRevision: options.expectedRevision,
      label: `memory.${options.action}`,
      checkShape: false,
      apply: (current) => {
        if (current === undefined) throw new MemoryMutationError("That note is no longer in the vault.", 404);
        return options.apply(current);
      },
    });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      throw new MemoryMutationError(
        "This note changed since you opened it — in Obsidian, or another window. Reload it to see what changed, then make your edit again.",
        409,
        error.actual,
      );
    }
    if (error instanceof DocumentInvalidError) throw new MemoryMutationError(error.message, 400);
    throw error;
  }

  const revisionBefore = revisionOfOptional(before);
  if (result.revision === revisionBefore) {
    // Nothing changed: no history, no reindex.
    return { id: options.id, revision: result.revision, historyId: "" };
  }

  const entry = await appendHistory({
    noteId: options.id,
    by: options.by,
    action: options.action,
    summary: options.summary,
    revisionBefore,
    revisionAfter: result.revision,
    backupId: result.undoId,
    sourceTask: options.sourceTask,
  });

  await service.reindex(new Set([options.id]));
  return { id: options.id, revision: result.revision, historyId: entry.id };
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) throw new MemoryMutationError("Tags must be a list.", 400);
  const clean = [...new Set(tags.flatMap((tag) => (typeof tag === "string" ? [normaliseTag(tag)] : [])))].filter(
    (tag): tag is string => Boolean(tag),
  );
  if (clean.length > MAX_TAGS) throw new MemoryMutationError(`A note can have at most ${MAX_TAGS} tags.`, 400);
  return clean;
}

function cleanBody(body: unknown): string {
  if (typeof body !== "string") throw new MemoryMutationError("The note body must be text.", 400);
  if (body.length > MAX_BODY) throw new MemoryMutationError("The note is longer than 200 KB. Split it into smaller notes.", 400);
  if (!body.trim()) throw new MemoryMutationError("A note cannot be emptied here. Archive it instead.", 400);
  return body;
}

function describeEdit(current: string, request: EditMemoryNoteRequest, nextBody?: string): string {
  const parts: string[] = [];
  const { body } = splitNote(current);
  if (nextBody !== undefined && nextBody.replace(/\r\n/g, "\n").trim() !== body.replace(/\r\n/g, "\n").trim()) parts.push("text edited");
  if (request.type !== undefined) parts.push(request.type === null ? "type cleared" : `type set to ${request.type}`);
  if (request.tags !== undefined) parts.push("tags changed");
  return parts.length > 0 ? parts.join(", ") : "edited";
}

/** A person's edit: body, type and tags. */
export async function editMemoryNote(
  service: MemoryService,
  request: EditMemoryNoteRequest,
  by = HUMAN,
): Promise<MemoryMutationResponse> {
  const body = request.body === undefined ? undefined : cleanBody(request.body);
  if (request.type !== undefined && request.type !== null && !isMemoryType(request.type)) {
    throw new MemoryMutationError("That is not a memory type.", 400);
  }
  const tags = request.tags === undefined ? undefined : cleanTags(request.tags);

  let summary = "edited";
  return mutate(service, {
    id: request.id,
    expectedRevision: request.expectedRevision,
    by,
    action: "edit",
    get summary() {
      return summary;
    },
    apply: (current) => {
      summary = describeEdit(current, request, body);
      const withBody = body === undefined ? current : replaceBody(current, body);
      return patchFrontmatter(withBody, {
        type: request.type === undefined ? undefined : request.type,
        tags: tags === undefined ? undefined : tags.length > 0 ? tags : null,
        updatedBy: by,
        updatedAt: new Date().toISOString(),
      });
    },
  });
}

export async function archiveMemoryNote(
  service: MemoryService,
  request: { id: string; expectedRevision: string },
  by = HUMAN,
): Promise<MemoryMutationResponse> {
  const now = new Date().toISOString();
  return mutate(service, {
    id: request.id,
    expectedRevision: request.expectedRevision,
    by,
    action: "archive",
    summary: "archived",
    apply: (current) => patchFrontmatter(current, { archived: true, archivedAt: now, archivedBy: by, updatedBy: by, updatedAt: now }),
  });
}

export async function restoreMemoryNote(
  service: MemoryService,
  request: { id: string; expectedRevision: string },
  by = HUMAN,
): Promise<MemoryMutationResponse> {
  return mutate(service, {
    id: request.id,
    expectedRevision: request.expectedRevision,
    by,
    action: "restore",
    summary: "restored from the archive",
    apply: (current) =>
      patchFrontmatter(current, { archived: null, archivedAt: null, archivedBy: null, updatedBy: by, updatedAt: new Date().toISOString() }),
  });
}

/**
 * Takes back the most recent change AgentOS made to a note.
 *
 * Refused when the note has changed since — by hand, or by another edit —
 * because restoring the backup would discard that later work without anyone
 * choosing to. The undo is itself logged and backed up, so it can be undone.
 */
export async function undoMemoryChange(
  service: MemoryService,
  request: { id: string; historyId: string },
  by = HUMAN,
): Promise<MemoryMutationResponse> {
  await writable(service, request.id);

  const entries = await readHistory(request.id);
  const current = await readOptionalFile(request.id, service.root);
  const currentRevision = current === undefined ? undefined : revisionOfOptional(current);
  const target = entries.find((entry) => entry.id === request.historyId);

  if (!target) throw new MemoryMutationError("That change is not in this note's history.", 404);
  const undoable = undoableEntry(entries, currentRevision);
  if (!undoable || undoable.id !== target.id) {
    throw new MemoryMutationError(
      target.undoneAt
        ? "That change has already been undone."
        : "The note has changed since that edit, so undoing it would also throw away the later changes. Edit it by hand instead.",
      409,
      currentRevision,
    );
  }

  const backup = target.backupId ? await readBackup(target.backupId) : undefined;
  if (!backup) throw new MemoryMutationError("The backup for that change is gone, so it cannot be undone.", 409, currentRevision);

  const response = await mutate(service, {
    id: request.id,
    expectedRevision: target.revisionAfter,
    by,
    action: "undo",
    summary: `undid “${target.summary}”`,
    apply: () => backup.contents,
  });
  await markUndone(request.id, target.id, new Date().toISOString());
  return response;
}

/**
 * Folds a proposed memory into an existing note, when a person chose
 * "update existing" over creating a duplicate.
 *
 * Appended, never replaced: the note keeps its title, its text and its
 * original source, and gains a dated section saying what the later task
 * added. A person can tidy it afterwards; nothing they wrote is lost to a
 * one-line proposal.
 */
export async function updateMemoryFromProposal(
  service: MemoryService,
  request: {
    id: string;
    expectedRevision: string;
    title: string;
    body: string;
    type?: MemoryType;
    sourceTask?: string;
  },
  by = HUMAN,
): Promise<MemoryMutationResponse> {
  const addition = cleanBody(request.body).trim();
  const heading = `## Update${request.sourceTask ? ` from ${request.sourceTask}` : ""} (${new Date().toISOString().slice(0, 10)})`;

  return mutate(service, {
    id: request.id,
    expectedRevision: request.expectedRevision,
    by,
    action: "update-from-task",
    summary: request.sourceTask ? `updated from ${request.sourceTask}` : "updated from a proposal",
    sourceTask: request.sourceTask,
    apply: (current) => {
      const { body } = splitNote(current);
      const titled = request.title.trim() && !body.toLowerCase().includes(request.title.trim().toLowerCase());
      const section = `${heading}\n\n${titled ? `**${request.title.trim()}** — ` : ""}${addition}\n`;
      return patchFrontmatter(replaceBody(current, `${body.replace(/\s+$/, "")}\n\n${section}`), {
        // A note that had no type takes the proposal's; an existing type is the person's.
        type: isMemoryType(splitNoteType(current)) ? undefined : request.type,
        lastSourceTask: request.sourceTask,
        updatedBy: by,
        updatedAt: new Date().toISOString(),
      });
    },
  });
}

/** The `type:` value as written, for deciding whether to set one. */
function splitNoteType(source: string): string | undefined {
  const match = /^type:\s*"?([\w-]+)"?\s*$/m.exec(splitNote(source).frontmatter);
  return match?.[1];
}

/** Logs the creation of a note so its history starts at the beginning. */
export async function recordCreation(noteId: string, contents: string, by: string, sourceTask?: string): Promise<void> {
  await appendHistory({
    noteId,
    by,
    action: "create",
    summary: sourceTask ? `created from ${sourceTask}` : "created",
    revisionAfter: revisionOfOptional(contents),
    sourceTask,
  });
}
