import express, { type Response } from "express";
import type { ZodType } from "zod";
import {
  DatabaseSetupInputSchema,
  DatabaseSetupPatchSchema,
  keyEnvNameFor,
  RowDeleteSchema,
  RowInsertSchema,
  RowUpdateSchema,
  type DatabaseSetup,
} from "../../shared/database-types";
import { getProjects } from "../agentos/projects";
import { EnvWriteError, removeEnvValues, valueProblem, writeEnvValues } from "../connectors/env-file";
import { requireJson } from "../connectors/routes";
import { recordUse } from "../connectors/store";
import { deleteRow, insertRow, listTables, projectUrlProblem, readRows, SupabaseError, testSetup, updateRow } from "./client";
import { findSetup, listSetups, recordTest, removeSetup, saveSetup, setupsForProject } from "./setups";

/**
 * `/api/databases`: Supabase setups, their workspace links, and the rows the
 * workspace Database tab reads and writes.
 *
 * No response carries a key. Writes need `application/json` (see
 * `requireJson`), so another website can't fire them at this loopback server.
 */
export const databasesRouter = express.Router();

databasesRouter.use(requireJson);

function parse<T>(schema: ZodType<T>, body: unknown, response: Response): T | undefined {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  response.status(400).json({ error: `Invalid request: ${issue?.path.join(".") || "body"}: ${issue?.message ?? ""}` });
  return undefined;
}

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof SupabaseError) {
    const status = { "not-configured": 409, refused: 403, "not-found": 404, invalid: 400, unreachable: 502, failed: 502 }[error.reason];
    response.status(status).json({ error: error.message, reason: error.reason });
    return;
  }
  if (error instanceof EnvWriteError) {
    response.status(400).json({ error: error.message });
    return;
  }
  console.error(`[agentos] databases: ${what} failed`);
  response.status(500).json({ error: `Unable to ${what}` });
}

function setupOr404(id: string, response: Response): DatabaseSetup | undefined {
  const setup = findSetup(id);
  if (!setup) response.status(404).json({ error: `There is no database setup called ${id}.` });
  return setup;
}

/** Links only to workspaces that exist, so a typo can't create a link to nothing. */
async function unknownProjects(slugs: readonly string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const known = new Set((await getProjects("all")).map((project) => project.slug));
  return slugs.filter((slug) => !known.has(slug));
}

/** Saves the key into `.env` and this process. Never echoed, never logged. */
function storeKey(setupId: string, key: string | undefined): void {
  const value = key?.trim();
  if (!value) return;
  const name = keyEnvNameFor(setupId);
  const problem = valueProblem(name, value);
  if (problem) throw new EnvWriteError(problem);
  writeEnvValues({ [name]: value });
  process.env[name] = value;
}

async function withTest(setup: DatabaseSetup): Promise<DatabaseSetup> {
  if (!setup.keySet) return setup;
  const result = await testSetup(setup);
  recordTest(setup.id, { ...result, checkedAt: new Date().toISOString() });
  return findSetup(setup.id) ?? setup;
}

databasesRouter.get("/setups", (_request, response) => {
  response.json({ setups: listSetups() });
});

databasesRouter.post("/setups", async (request, response) => {
  const input = parse(DatabaseSetupInputSchema, request.body, response);
  if (!input) return;
  if (findSetup(input.id)) {
    response.status(409).json({ error: `A setup called ${input.id} already exists.` });
    return;
  }
  const urlProblem = projectUrlProblem(input.url);
  if (urlProblem) {
    response.status(400).json({ error: urlProblem });
    return;
  }
  const unknown = await unknownProjects(input.projectSlugs ?? []);
  if (unknown.length > 0) {
    response.status(400).json({ error: `No workspace called ${unknown.join(", ")}.` });
    return;
  }

  try {
    storeKey(input.id, input.key);
    const saved = saveSetup({ id: input.id, name: input.name, url: input.url.replace(/\/+$/, ""), environment: input.environment || undefined, projectSlugs: input.projectSlugs ?? [] });
    recordUse("supabase", { capabilityId: "supabase.settings", capabilityName: "Database added", at: new Date().toISOString(), detail: saved.name });
    response.status(201).json({ setup: await withTest(saved) });
  } catch (error) {
    fail(response, error, "add the database");
  }
});

databasesRouter.patch("/setups/:id", async (request, response) => {
  const setup = setupOr404(request.params.id, response);
  if (!setup) return;
  const patch = parse(DatabaseSetupPatchSchema, request.body, response);
  if (!patch) return;
  if (patch.url !== undefined) {
    const urlProblem = projectUrlProblem(patch.url);
    if (urlProblem) {
      response.status(400).json({ error: urlProblem });
      return;
    }
  }
  const unknown = await unknownProjects(patch.projectSlugs ?? []);
  if (unknown.length > 0) {
    response.status(400).json({ error: `No workspace called ${unknown.join(", ")}.` });
    return;
  }

  try {
    storeKey(setup.id, patch.key);
    const saved = saveSetup({
      id: setup.id,
      name: patch.name ?? setup.name,
      url: (patch.url ?? setup.url).replace(/\/+$/, ""),
      environment: patch.environment === undefined ? setup.environment : patch.environment || undefined,
      projectSlugs: patch.projectSlugs ?? setup.projectSlugs,
      lastTest: patch.key?.trim() ? undefined : setup.lastTest,
    });
    // Only a change to how it connects needs a fresh test.
    response.json({ setup: patch.key?.trim() || patch.url ? await withTest(saved) : saved });
  } catch (error) {
    fail(response, error, "update the database");
  }
});

databasesRouter.delete("/setups/:id", (request, response) => {
  const setup = setupOr404(request.params.id, response);
  if (!setup) return;
  try {
    removeEnvValues([setup.keyEnvName]);
    delete process.env[setup.keyEnvName];
    removeSetup(setup.id);
    recordUse("supabase", { capabilityId: "supabase.settings", capabilityName: "Database removed", at: new Date().toISOString(), detail: setup.name });
    response.json({ removed: setup.id });
  } catch (error) {
    fail(response, error, "remove the database");
  }
});

databasesRouter.post("/setups/:id/test", async (request, response) => {
  const setup = setupOr404(request.params.id, response);
  if (!setup) return;
  if (!setup.keySet) {
    response.status(409).json({ error: `${setup.name} has no key yet.` });
    return;
  }
  response.json({ setup: await withTest(setup) });
});

databasesRouter.get("/projects/:slug", (request, response) => {
  response.json({ setups: setupsForProject(request.params.slug) });
});

databasesRouter.get("/setups/:id/tables", async (request, response) => {
  const setup = setupOr404(request.params.id, response);
  if (!setup) return;
  try {
    response.json({ setupId: setup.id, tables: await listTables(setup) });
  } catch (error) {
    fail(response, error, "read the tables");
  }
});

databasesRouter.get("/setups/:id/tables/:table/rows", async (request, response) => {
  const setup = setupOr404(request.params.id, response);
  if (!setup) return;
  const offset = Number(request.query.offset ?? 0);
  const limit = Number(request.query.limit ?? 50);
  if (!Number.isInteger(offset) || !Number.isInteger(limit)) {
    response.status(400).json({ error: "offset and limit must be whole numbers." });
    return;
  }
  try {
    response.json({ table: request.params.table, ...(await readRows(setup, request.params.table, { offset, limit })) });
  } catch (error) {
    fail(response, error, "read the rows");
  }
});

databasesRouter.post("/setups/:id/tables/:table/rows", async (request, response) => {
  const setup = setupOr404(request.params.id, response);
  if (!setup) return;
  const body = parse(RowInsertSchema, request.body, response);
  if (!body) return;
  try {
    response.status(201).json({ row: await insertRow(setup, request.params.table, body.values) });
  } catch (error) {
    fail(response, error, "insert the row");
  }
});

databasesRouter.patch("/setups/:id/tables/:table/rows", async (request, response) => {
  const setup = setupOr404(request.params.id, response);
  if (!setup) return;
  const body = parse(RowUpdateSchema, request.body, response);
  if (!body) return;
  try {
    response.json({ row: await updateRow(setup, request.params.table, body.key, body.values) });
  } catch (error) {
    fail(response, error, "update the row");
  }
});

/** A POST rather than DELETE-with-a-body, which some proxies drop. */
databasesRouter.post("/setups/:id/tables/:table/rows/delete", async (request, response) => {
  const setup = setupOr404(request.params.id, response);
  if (!setup) return;
  const body = parse(RowDeleteSchema, request.body, response);
  if (!body) return;
  try {
    await deleteRow(setup, request.params.table, body.key);
    response.json({ deleted: true });
  } catch (error) {
    fail(response, error, "delete the row");
  }
});
