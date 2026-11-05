import express from "express";
import { z } from "zod";
import { StructureRebuildBodySchema, StructureSearchQuerySchema } from "../../shared/structure-types";
import type { StructureIndex } from "./graph";
import { structureRebuilds } from "./rebuild";
import { findGraphify, loadStructureGraph, resolveStructureFolder, structureState } from "./store";

/**
 * A workspace's Structure tab. Local only: it reads project source structure
 * and starts a process in the repository, neither of which leaves this machine.
 */
export const structureRouter = express.Router({ mergeParams: true });

structureRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "The project structure is only available on this machine." });
    return;
  }
  next();
});

function slugOf(request: express.Request): string {
  return String((request.params as Record<string, string>).slug);
}

/** The parsed graph, or a response already sent saying why there is none. */
async function indexFor(request: express.Request, response: express.Response): Promise<StructureIndex | undefined> {
  const resolved = await resolveStructureFolder(slugOf(request));
  if ("status" in resolved) {
    response.status(404).json({ error: resolved.problem });
    return undefined;
  }
  const loaded = await loadStructureGraph(resolved.folder);
  if (loaded.status !== "ready") {
    response.status(404).json({ error: loaded.status === "empty" ? "This repository has not been mapped yet." : loaded.problem });
    return undefined;
  }
  return loaded.index;
}

function fail(response: express.Response, what: string, error: unknown): void {
  console.error(`[structure] ${what} failed:`, error instanceof Error ? error.message : error);
  response.status(500).json({ error: `Could not ${what}.` });
}

structureRouter.get("/", async (request, response) => {
  try {
    response.json(await structureState(slugOf(request)));
  } catch (error) {
    fail(response, "read the project structure", error);
  }
});

structureRouter.get("/search", async (request, response) => {
  const query = StructureSearchQuerySchema.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "Search needs between 1 and 120 characters." });
    return;
  }
  try {
    const index = await indexFor(request, response);
    if (index) response.json({ results: index.search(query.data.q) });
  } catch (error) {
    fail(response, "search the project structure", error);
  }
});

structureRouter.get("/subsystems/:id", async (request, response) => {
  const id = z.coerce.number().int().safeParse(request.params.id);
  if (!id.success) {
    response.status(400).json({ error: "That is not a subsystem." });
    return;
  }
  try {
    const index = await indexFor(request, response);
    if (!index) return;
    const detail = index.subsystem(id.data);
    if (detail) response.json(detail);
    else response.status(404).json({ error: "That subsystem is not in this graph. It may have changed in the last rebuild." });
  } catch (error) {
    fail(response, "read that subsystem", error);
  }
});

structureRouter.get("/nodes/:id", async (request, response) => {
  const id = z.string().min(1).max(1024).safeParse(request.params.id);
  if (!id.success) {
    response.status(400).json({ error: "That is not a component." });
    return;
  }
  try {
    const index = await indexFor(request, response);
    if (!index) return;
    const detail = index.node(id.data);
    if (detail) response.json(detail);
    else response.status(404).json({ error: "That component is not in this graph. It may have changed in the last rebuild." });
  } catch (error) {
    fail(response, "read that component", error);
  }
});

structureRouter.post("/rebuild", async (request, response) => {
  const body = StructureRebuildBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    response.status(400).json({ error: "The rebuild request was not understood." });
    return;
  }
  try {
    const slug = slugOf(request);
    const resolved = await resolveStructureFolder(slug);
    if ("status" in resolved) {
      response.status(409).json({ error: resolved.problem });
      return;
    }
    const binary = await findGraphify();
    if (!binary) {
      response.status(409).json({ error: "The graphify command is not installed on this machine." });
      return;
    }
    structureRebuilds.start(slug, { folder: resolved.folder, binary, force: body.data.force });
    response.status(202).json(await structureState(slug));
  } catch (error) {
    fail(response, "start the rebuild", error);
  }
});
