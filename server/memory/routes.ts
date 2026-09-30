import { Router, type Request } from "express";
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
