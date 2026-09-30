import type { DatabaseColumn, DatabaseSetup, DatabaseTable, RowKey } from "../../shared/database-types";
import { authorize } from "../connectors/policy";

/**
 * Supabase, through its REST API (PostgREST) and nothing else.
 *
 * The key is a secret/service_role key, which ignores row-level security, so
 * this file is the real boundary:
 *
 * - it only talks to the setup's own project URL, over HTTPS;
 * - a table must be one PostgREST lists, and a column one that table has;
 * - an update or delete is always filtered by the full primary key, and
 *   refused if it would touch anything but exactly one row;
 * - there is no SQL, no RPC, no schema change and no bulk write here;
 * - every call passes the Connectors guard first. Deletes are `destructive`
 *   there and off until the operator turns them on.
 *
 * The key is read from `.env` per call and only ever placed in a header.
 */

const TIMEOUT_MS = 15_000;
const PAGE_LIMIT = 200;

export class SupabaseError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "refused" | "not-found" | "invalid" | "unreachable" | "failed",
  ) {
    super(message);
    this.name = "SupabaseError";
  }
}

/** The project's base URL, or a reason it can't be used. HTTPS, except a Supabase running on this machine. */
export function projectUrlProblem(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "The project URL isn't a valid address.";
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return "The project URL must be https:// (http:// only for localhost).";
  if (url.pathname !== "/" || url.search || url.hash) return "Use the project URL itself, e.g. https://abcd.supabase.co, without a path.";
  return undefined;
}

function baseUrl(setup: DatabaseSetup): string {
  const problem = projectUrlProblem(setup.url);
  if (problem) throw new SupabaseError(problem, "invalid");
  return setup.url.replace(/\/+$/, "");
}

function keyFor(setup: DatabaseSetup): string {
  const key = process.env[setup.keyEnvName]?.trim();
  if (!key) throw new SupabaseError(`${setup.name} has no key yet. Add it in Connectors → Supabase.`, "not-configured");
  return key;
}

function guard(capability: string, detail?: string): void {
  const decision = authorize(capability, { initiator: "person", detail });
  if (!decision.allowed) throw new SupabaseError(decision.reason, "refused");
}

interface Answer {
  status: number;
  headers: Headers;
  body: unknown;
}

async function call(
  setup: DatabaseSetup,
  method: "GET" | "HEAD" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { body?: unknown; prefer?: string; accept?: string } = {},
): Promise<Answer> {
  const key = keyFor(setup);
  const headers: Record<string, string> = {
    apikey: key,
    Accept: options.accept ?? "application/json",
  };
  // Legacy service_role keys are JWTs and go in Authorization too. The newer
  // `sb_secret_…` keys are not JWTs and belong in `apikey` alone.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  if (options.prefer) headers.Prefer = options.prefer;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${baseUrl(setup)}/rest/v1${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof SupabaseError) throw error;
    throw new SupabaseError(`Couldn't reach ${setup.name}.`, "unreachable");
  }

  const text = method === "HEAD" ? "" : await response.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const message = typeof (body as { message?: unknown } | undefined)?.message === "string" ? (body as { message: string }).message : undefined;
    if (response.status === 401 || response.status === 403) throw new SupabaseError(`${setup.name} rejected the key${message ? `: ${message}` : "."}`, "refused");
    if (response.status === 404) throw new SupabaseError(message ?? "Supabase found no such table.", "not-found");
    throw new SupabaseError(message ? `Supabase: ${message.slice(0, 300)}` : `Supabase responded with ${response.status}.`, "failed");
  }

  return { status: response.status, headers: response.headers, body };
}

function total(headers: Headers): number | undefined {
  const match = /\/(\d+)$/.exec(headers.get("content-range") ?? "");
  return match ? Number(match[1]) : undefined;
}

interface OpenApiProperty {
  type?: string;
  format?: string;
  description?: string;
  default?: unknown;
}

/** PostgREST's OpenAPI description, as tables. Primary keys are marked `<pk/>` in a column's description. */
export function readOpenApiTables(spec: unknown): DatabaseTable[] {
  const definitions = (spec as { definitions?: Record<string, { properties?: Record<string, OpenApiProperty>; required?: string[] }> } | undefined)?.definitions;
  if (!definitions || typeof definitions !== "object") return [];

  return Object.entries(definitions)
    .map(([name, definition]): DatabaseTable => {
      const required = new Set(definition.required ?? []);
      const columns: DatabaseColumn[] = Object.entries(definition.properties ?? {}).map(([column, property]) => ({
        name: column,
        type: property.type ?? "string",
        format: property.format,
        primaryKey: Boolean(property.description?.includes("<pk/>")),
        required: required.has(column),
        hasDefault: property.default !== undefined,
      }));
      return { name, columns, primaryKey: columns.filter((column) => column.primaryKey).map((column) => column.name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Tables and views PostgREST exposes, with estimated row counts. */
export async function listTables(setup: DatabaseSetup): Promise<DatabaseTable[]> {
  guard("supabase.read_tables");
  const answer = await call(setup, "GET", "/", { accept: "application/openapi+json" });
  const tables = readOpenApiTables(answer.body);

  const counts = await Promise.all(
    tables.map((table) =>
      call(setup, "HEAD", `/${encodeURIComponent(table.name)}?select=*&limit=1`, { prefer: "count=estimated" })
        .then((head) => total(head.headers))
        .catch(() => undefined),
    ),
  );
  return tables.map((table, index) => ({ ...table, rowCount: counts[index] }));
}

/** The table, confirmed against what PostgREST lists. Nothing from a request reaches a path unchecked. */
async function tableNamed(setup: DatabaseSetup, name: string): Promise<DatabaseTable> {
  const answer = await call(setup, "GET", "/", { accept: "application/openapi+json" });
  const table = readOpenApiTables(answer.body).find((entry) => entry.name === name);
  if (!table) throw new SupabaseError(`${name} isn't a table in ${setup.name}.`, "not-found");
  return table;
}

function columnsOnly(table: DatabaseTable, values: Record<string, unknown>): Record<string, unknown> {
  const known = new Set(table.columns.map((column) => column.name));
  const unknown = Object.keys(values).filter((name) => !known.has(name));
  if (unknown.length > 0) throw new SupabaseError(`${unknown.join(", ")} ${unknown.length === 1 ? "isn't a column" : "aren't columns"} of ${table.name}.`, "invalid");
  if (Object.keys(values).length === 0) throw new SupabaseError("There is nothing to save.", "invalid");
  return values;
}

/** `?id=eq.42` for every primary-key column. Refuses a partial key: that could match many rows. */
export function keyFilter(table: DatabaseTable, key: RowKey): string {
  if (table.primaryKey.length === 0) throw new SupabaseError(`${table.name} has no primary key, so a single row can't be named. Edit it in Supabase.`, "invalid");
  const missing = table.primaryKey.filter((column) => key[column] === undefined);
  const extra = Object.keys(key).filter((column) => !table.primaryKey.includes(column));
  if (missing.length > 0 || extra.length > 0) throw new SupabaseError(`A row is named by ${table.primaryKey.join(" + ")}.`, "invalid");
  return table.primaryKey.map((column) => `${encodeURIComponent(column)}=eq.${encodeURIComponent(String(key[column]))}`).join("&");
}

export async function readRows(
  setup: DatabaseSetup,
  tableName: string,
  page: { offset: number; limit: number },
): Promise<{ rows: Record<string, unknown>[]; total?: number; limit: number; offset: number }> {
  guard("supabase.read_rows");
  const table = await tableNamed(setup, tableName);
  const limit = Math.min(Math.max(page.limit, 1), PAGE_LIMIT);
  const offset = Math.max(page.offset, 0);
  const order = table.primaryKey.length > 0 ? `&order=${table.primaryKey.map((column) => `${encodeURIComponent(column)}.asc`).join(",")}` : "";

  const answer = await call(setup, "GET", `/${encodeURIComponent(table.name)}?select=*&limit=${limit}&offset=${offset}${order}`, { prefer: "count=estimated" });
  return { rows: Array.isArray(answer.body) ? (answer.body as Record<string, unknown>[]) : [], total: total(answer.headers), limit, offset };
}

function one(answer: Answer, what: string): Record<string, unknown> {
  const rows = Array.isArray(answer.body) ? (answer.body as Record<string, unknown>[]) : [];
  if (rows.length !== 1) throw new SupabaseError(`Supabase ${what} ${rows.length} rows, not one.`, "failed");
  return rows[0];
}

export async function insertRow(setup: DatabaseSetup, tableName: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const table = await tableNamed(setup, tableName);
  guard("supabase.insert_rows", `${setup.name}: ${table.name}`);
  const answer = await call(setup, "POST", `/${encodeURIComponent(table.name)}`, { body: columnsOnly(table, values), prefer: "return=representation" });
  return one(answer, "inserted");
}

/**
 * The count is checked before writing: PostgREST can't be told "one row at
 * most", so a key that somehow matched more (a view without a real key) is
 * refused before anything changes.
 */
async function assertExactlyOne(setup: DatabaseSetup, table: DatabaseTable, filter: string): Promise<void> {
  const head = await call(setup, "HEAD", `/${encodeURIComponent(table.name)}?select=*&${filter}`, { prefer: "count=exact" });
  const count = total(head.headers);
  if (count !== 1) throw new SupabaseError(count === 0 ? "That row no longer exists." : `That key matches ${count ?? "an unknown number of"} rows; nothing was changed.`, "invalid");
}

export async function updateRow(setup: DatabaseSetup, tableName: string, key: RowKey, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const table = await tableNamed(setup, tableName);
  guard("supabase.update_rows", `${setup.name}: ${table.name}`);
  const filter = keyFilter(table, key);
  await assertExactlyOne(setup, table, filter);
  const answer = await call(setup, "PATCH", `/${encodeURIComponent(table.name)}?${filter}`, { body: columnsOnly(table, values), prefer: "return=representation" });
  return one(answer, "updated");
}

export async function deleteRow(setup: DatabaseSetup, tableName: string, key: RowKey): Promise<void> {
  const table = await tableNamed(setup, tableName);
  guard("supabase.delete_rows", `${setup.name}: ${table.name}`);
  const filter = keyFilter(table, key);
  await assertExactlyOne(setup, table, filter);
  const answer = await call(setup, "DELETE", `/${encodeURIComponent(table.name)}?${filter}`, { prefer: "return=representation" });
  one(answer, "deleted");
}

/** "Test connection": the one read that proves the URL and key work. */
export async function testSetup(setup: DatabaseSetup): Promise<{ ok: boolean; detail: string }> {
  try {
    const answer = await call(setup, "GET", "/", { accept: "application/openapi+json" });
    const count = readOpenApiTables(answer.body).length;
    return { ok: true, detail: `Connected. ${count} table${count === 1 ? "" : "s"} visible.` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "The test failed." };
  }
}
