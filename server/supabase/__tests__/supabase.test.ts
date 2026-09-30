import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-supabase-"));
process.env.AGENTOS_UI_DIR = directory;
process.env.AGENTOS_ENV_FILE = path.join(directory, ".env");

const { deleteRow, insertRow, keyFilter, listTables, projectUrlProblem, readOpenApiTables, readRows, updateRow } = await import("../client");
const { findSetup, listSetups, removeSetup, resetSetupCache, saveSetup, setupsForProject } = await import("../setups");
const { resetConnectorStateCache, setStoredPolicies } = await import("../../connectors/store");
const { withoutEnvNames } = await import("../../connectors/env-file");
const { keyEnvNameFor } = await import("../../../shared/database-types");

/** PostgREST's description of two tables: one with a key, one without. */
const SPEC = {
  definitions: {
    recipes: {
      required: ["id", "title"],
      properties: {
        id: { type: "integer", format: "bigint", description: "Note:\nThis is a Primary Key.<pk/>", default: "nextval" },
        title: { type: "string", format: "text" },
        tags: { type: "array", format: "jsonb" },
      },
    },
    events_log: { properties: { at: { type: "string", format: "timestamp with time zone" }, detail: { type: "string" } } },
  },
};

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

let seen: Seen[] = [];
/** How many rows a key filter "matches" in the fake. */
let matching = 1;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  seen.push({ method, url, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });

  if (url.endsWith("/rest/v1/")) return new Response(JSON.stringify(SPEC), { status: 200 });
  if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": `*/${url.includes("id=eq.") ? matching : 1204}` } });
  if (method === "GET") return new Response(JSON.stringify([{ id: 1, title: "Soup", tags: [] }]), { status: 200, headers: { "content-range": "0-0/1204" } });
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  return new Response(JSON.stringify([{ id: 7, ...body }]), { status: 200 });
}) as typeof fetch;

const setup = () =>
  saveSetup({ id: "pantry-prod", name: "Pantry Pilot", url: "https://abcd.supabase.co", environment: "production", projectSlugs: ["pantry-pilot"] });

beforeEach(() => {
  seen = [];
  matching = 1;
  for (const file of ["supabase-setups.json", "connectors.json"]) fs.rmSync(path.join(directory, file), { force: true });
  resetSetupCache();
  resetConnectorStateCache();
  process.env[keyEnvNameFor("pantry-prod")] = "sb_secret_test";
});

after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("Supabase setups", () => {
  it("keeps several setups, links them to workspaces, and knows whether each has a key", () => {
    setup();
    saveSetup({ id: "pantry-staging", name: "Pantry Pilot", url: "https://efgh.supabase.co", environment: "staging", projectSlugs: ["pantry-pilot"] });
    resetSetupCache();

    assert.equal(setupsForProject("pantry-pilot").length, 2);
    assert.equal(findSetup("pantry-prod")?.keySet, true);
    assert.equal(findSetup("pantry-staging")?.keySet, false);
    assert.equal(findSetup("pantry-staging")?.keyEnvName, "SUPABASE_KEY__PANTRY_STAGING");
    assert.doesNotMatch(JSON.stringify(listSetups()), /sb_secret_test/);

    removeSetup("pantry-staging");
    assert.equal(setupsForProject("pantry-pilot").length, 1);
  });

  it("accepts only a bare https project URL", () => {
    assert.equal(projectUrlProblem("https://abcd.supabase.co"), undefined);
    assert.equal(projectUrlProblem("http://localhost:54321"), undefined);
    assert.match(projectUrlProblem("http://abcd.supabase.co") ?? "", /https/);
    assert.match(projectUrlProblem("https://abcd.supabase.co/rest/v1") ?? "", /without a path/);
  });

  it("removes a deleted setup's key line from .env and nothing else", () => {
    assert.equal(withoutEnvNames("A=1\nSUPABASE_KEY__X=secret\n# note\n", ["SUPABASE_KEY__X"]), "A=1\n# note\n");
  });
});

describe("the Supabase client", () => {
  it("reads tables, columns and primary keys from PostgREST's description", () => {
    const [events, recipes] = readOpenApiTables(SPEC);
    assert.equal(recipes.name, "recipes");
    assert.deepEqual(recipes.primaryKey, ["id"]);
    assert.equal(recipes.columns.find((column) => column.name === "id")?.hasDefault, true);
    assert.deepEqual(events.primaryKey, []);
  });

  it("sends a secret key as apikey only, and a legacy JWT key as a bearer token too", async () => {
    await listTables(setup());
    assert.equal(seen[0].headers.apikey, "sb_secret_test");
    assert.equal(seen[0].headers.Authorization, undefined);

    seen = [];
    process.env[keyEnvNameFor("pantry-prod")] = "eyJhbGciOi.jwt";
    await listTables(setup());
    assert.equal(seen[0].headers.Authorization, "Bearer eyJhbGciOi.jwt");
  });

  it("lists tables with estimated counts", async () => {
    const tables = await listTables(setup());
    assert.equal(tables.find((table) => table.name === "recipes")?.rowCount, 1204);
  });

  it("pages rows in key order and reports the total", async () => {
    const page = await readRows(setup(), "recipes", { offset: 50, limit: 5000 });
    const get = seen.find((call) => call.method === "GET" && call.url.includes("/recipes?"));
    assert.match(get?.url ?? "", /limit=200&offset=50&order=id\.asc/);
    assert.equal(page.total, 1204);
  });

  it("refuses a table PostgREST doesn't list, and a column the table doesn't have", async () => {
    await assert.rejects(() => readRows(setup(), "../auth/users", { offset: 0, limit: 10 }), /isn't a table/);
    await assert.rejects(() => insertRow(setup(), "recipes", { title: "x", owner: "me" }), /owner isn't a column/);
  });

  it("names a row only by its full primary key", () => {
    const [events, recipes] = readOpenApiTables(SPEC);
    assert.equal(keyFilter(recipes, { id: 42 }), "id=eq.42");
    assert.throws(() => keyFilter(recipes, {}), /named by id/);
    assert.throws(() => keyFilter(recipes, { id: 1, title: "x" }), /named by id/);
    assert.throws(() => keyFilter(events, { at: "x" }), /no primary key/);
  });

  it("updates exactly one row, and refuses before writing when the key matches more", async () => {
    const row = await updateRow(setup(), "recipes", { id: 7 }, { title: "Stew" });
    assert.equal(row.title, "Stew");
    const patch = seen.find((call) => call.method === "PATCH");
    assert.match(patch?.url ?? "", /\/recipes\?id=eq\.7$/);
    assert.deepEqual(patch?.body, { title: "Stew" });

    seen = [];
    matching = 3;
    await assert.rejects(() => updateRow(setup(), "recipes", { id: 7 }, { title: "Stew" }), /matches 3 rows/);
    assert.equal(seen.some((call) => call.method === "PATCH"), false);
  });

  it("refuses deletes until they're turned on in Connectors", async () => {
    await assert.rejects(() => deleteRow(setup(), "recipes", { id: 7 }), /turned off/);
    assert.equal(seen.some((call) => call.method === "DELETE"), false);

    setStoredPolicies({ "supabase.delete_rows": "allowed" });
    await deleteRow(setup(), "recipes", { id: 7 });
    assert.equal(seen.filter((call) => call.method === "DELETE").length, 1);
  });

  it("refuses everything when Supabase is switched off", async () => {
    const { setConnectorEnabled } = await import("../../connectors/policy");
    setConnectorEnabled("supabase", false);
    await assert.rejects(() => listTables(setup()), /switched off/);
    assert.equal(seen.length, 0);
  });
});
