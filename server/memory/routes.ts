import { Router, type Request } from "express";
import { recordActivity } from "../activity/ui-events";
import type { CreateMemoryNoteRequest } from "../../shared/memory-paths";
import type { EditMemoryNoteRequest } from "../../shared/memory-types";
import { readOptionalFile } from "../agentos/filesystem";
import { revisionOfOptional } from "../agentos/mutations/revision";
import { CreateNoteError, createMemoryNote } from "./create-note";
import { findDuplicates } from "./duplicate-detection";
import { readHistory, undoableEntry } from "./history";
import {
  archiveMemoryNote,
  editMemoryNote,
  MemoryMutationError,
  restoreMemoryNote,
  undoMemoryChange,
} from "./mutations";
import { isArchived } from "./index";
import { retrieveMemoryContext } from "./retrieval";
import { searchIndex } from "./search";
import { memoryService } from "./service";

/**
 * `/api/memory` — the vault, read through the index.
 *
 * The browser only ever names notes by their indexed id. There is no route
 * that takes a filesystem path, and every response is bounded.
 */

export const memoryRouter = Router();

function text(request: Request, key: string): string | undefined {
  const value = request.query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(request: Request, key: string): number | undefined {
  const value = Number(text(request, key));
  return Number.isFinite(value) ? value : undefined;
}

function flag(request: Request, key: string): boolean | undefined {
  const value = text(request, key);
  return value === undefined ? undefined : value === "1" || value === "true";
}

memoryRouter.get("/status", (_request, response) => {
  response.json(memoryService().status());
});

memoryRouter.post("/reindex", async (_request, response) => {
  const service = memoryService();
  await service.check();
  if (service.status().state === "connected") await service.reindex();
  response.json(service.status());
});

memoryRouter.get("/notes", (request, response) => {
  const service = memoryService();
  const query = text(request, "q");
  const ids = query ? searchIndex(service.index, query, 200).map((hit) => hit.id) : undefined;
  const sort = text(request, "sort");

  response.json({
    ...service.index.listNotes({
      folder: text(request, "folder"),
      tag: text(request, "tag"),
      ids,
      offset: number(request, "offset"),
      limit: number(request, "limit"),
      sort: sort === "modified" || sort === "links" ? sort : "title",
    }),
    stale: service.status().stale,
  });
});

/**
 * Every note's id and title, for the file tree. Bounded: past the cap the
 * response says how many were left out rather than dropping them silently.
 */
const TREE_CAP = 5_000;

memoryRouter.get("/tree", (request, response) => {
  const service = memoryService();
  const query = text(request, "q");
  const ids = query ? new Set(searchIndex(service.index, query, 200).map((hit) => hit.id)) : undefined;
  const showArchived = flag(request, "archived") ?? false;
  const notes = [...service.index.notes.values()]
    .filter((note) => !ids || ids.has(note.id))
    .filter((note) => showArchived || !isArchived(note))
    .map((note) => ({ id: note.id, title: note.parsed.title, archived: isArchived(note) || undefined }))
    .sort((a, b) => a.id.localeCompare(b.id));

  response.json({
    notes: notes.slice(0, TREE_CAP),
    total: notes.length,
    vaultTotal: service.index.notes.size,
    omitted: Math.max(0, notes.length - TREE_CAP),
    stale: service.status().stale,
  });
});

/** A person adds a note. Only ever creates; never overwrites. */
memoryRouter.post("/notes", async (request, response) => {
  try {
    const created = await createMemoryNote(memoryService(), (request.body ?? {}) as CreateMemoryNoteRequest);
    await recordActivity({
      type: "memory.note_created",
      description: created.createdFolders.length > 0 ? `${created.id} (new folder ${created.createdFolders.at(-1)}/)` : created.id,
      metadata: { note: created.id, createdFolders: created.createdFolders },
    });
    response.status(201).json(created);
  } catch (error) {
    if (error instanceof CreateNoteError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error("[memory] could not create a note:", error);
    response.status(500).json({ error: "The note could not be written to the vault." });
  }
});

memoryRouter.get("/note", (request, response) => {
  const service = memoryService();
  const id = text(request, "id");
  // Only an id the index already holds. Nothing here touches the disk.
  const detail = id ? service.index.detail(id, service.status().stale) : undefined;

  if (!detail) {
    response.status(404).json({ error: "There is no note with that id in the vault index." });
    return;
  }
  response.json(detail);
});

memoryRouter.get("/search", (request, response) => {
  const query = text(request, "q") ?? "";
  response.json({ hits: searchIndex(memoryService().index, query, Math.min(100, number(request, "limit") ?? 25)) });
});

memoryRouter.get("/facets", (_request, response) => {
  response.json(memoryService().index.facets());
});

memoryRouter.get("/graph", (request, response) => {
  const service = memoryService();
  const query = text(request, "q");

  response.json({
    ...service.index.graph({
      focus: text(request, "focus"),
      depth: number(request, "depth"),
      folder: text(request, "folder"),
      tag: text(request, "tag"),
      ids: query ? new Set(searchIndex(service.index, query, 200).map((hit) => hit.id)) : undefined,
      orphans: flag(request, "orphans"),
      unresolved: flag(request, "unresolved"),
      archived: flag(request, "archived"),
    }),
    stale: service.status().stale,
  });
});

memoryRouter.get("/diagnostics", (_request, response) => {
  response.json(memoryService().index.diagnostics());
});

/** What a job for this project and objective would be given right now. */
memoryRouter.get("/context", async (request, response) => {
  const project = text(request, "project");
  const query = text(request, "q");
  if (!project || !query) {
    response.status(400).json({ error: "Both project and q are required." });
    return;
  }
  response.json(await retrieveMemoryContext(memoryService(), { project, query, budgetTokens: number(request, "budget") }));
});

function body(request: Request): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Every mutation answers the same way: the new revision, or why not. */
function mutationRoute(
  type: "memory.note_edited" | "memory.note_archived" | "memory.note_restored" | "memory.edit_undone",
  run: (request: Request) => Promise<{ id: string; revision: string; historyId: string }>,
) {
  return async (request: Request, response: import("express").Response) => {
    try {
      const result = await run(request);
      if (result.historyId) {
        await recordActivity({ type, description: result.id, metadata: { note: result.id, historyId: result.historyId } });
      }
      response.json(result);
    } catch (error) {
      if (error instanceof MemoryMutationError) {
        response.status(error.status).json({
          error: error.message,
          ...(error.status === 409 && error.currentRevision ? { code: "revision_conflict", currentRevision: error.currentRevision } : {}),
        });
        return;
      }
      console.error("[memory] mutation failed:", error);
      response.status(500).json({ error: "The note could not be written to the vault." });
    }
  };
}

/** A person edits a note's body, type or tags. Revision-checked; provenance kept. */
memoryRouter.patch(
  "/note",
  mutationRoute("memory.note_edited", (request) => {
    const input = body(request);
    const edit: EditMemoryNoteRequest = {
      id: str(input.id),
      expectedRevision: str(input.expectedRevision),
      body: typeof input.body === "string" ? input.body : undefined,
      type: input.type === null ? null : typeof input.type === "string" ? (input.type as EditMemoryNoteRequest["type"]) : undefined,
      tags: Array.isArray(input.tags) ? (input.tags as string[]) : undefined,
    };
    return editMemoryNote(memoryService(), edit);
  }),
);

memoryRouter.post(
  "/note/archive",
  mutationRoute("memory.note_archived", (request) =>
    archiveMemoryNote(memoryService(), { id: str(body(request).id), expectedRevision: str(body(request).expectedRevision) }),
  ),
);

memoryRouter.post(
  "/note/restore",
  mutationRoute("memory.note_restored", (request) =>
    restoreMemoryNote(memoryService(), { id: str(body(request).id), expectedRevision: str(body(request).expectedRevision) }),
  ),
);

memoryRouter.post(
  "/note/undo",
  mutationRoute("memory.edit_undone", (request) =>
    undoMemoryChange(memoryService(), { id: str(body(request).id), historyId: str(body(request).historyId) }),
  ),
);

/** What AgentOS has changed in a note, newest first, and which change can be undone now. */
memoryRouter.get("/history", async (request, response) => {
  const service = memoryService();
  const id = text(request, "id");
  if (!id || !service.index.notes.has(id)) {
    response.status(404).json({ error: "There is no note with that id in the vault index." });
    return;
  }
  const entries = await readHistory(id);
  const current = service.isAvailable() ? await readOptionalFile(id, service.root).catch(() => undefined) : undefined;
  const undoable = undoableEntry(entries, current === undefined ? undefined : revisionOfOptional(current));
  response.json({ entries, undoable: undoable?.id });
});

/** Existing memory in a project that a new item may be repeating. */
memoryRouter.post("/duplicates", async (request, response) => {
  const input = body(request);
  const project = str(input.project);
  const title = str(input.title).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(project) || !title) {
    response.status(400).json({ error: "A project and a title are required." });
    return;
  }
  response.json({ matches: await findDuplicates(memoryService(), project, { title, body: str(input.body).slice(0, 4000) }) });
});
