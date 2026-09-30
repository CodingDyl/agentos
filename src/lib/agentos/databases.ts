import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DatabaseLinksSchema,
  DatabaseRowsSchema,
  DatabaseSetupSchema,
  DatabaseTablesSchema,
  type DatabaseRows,
  type DatabaseSetup,
  type DatabaseTables,
  type RowKey,
} from "@shared/database-types";
import { AgentOSRequestError } from "./client";
import { connectorsKey } from "./connectors";
import { agentosKeys } from "./queries";

/**
 * Databases' client: Supabase setups, their workspace links, and rows.
 *
 * A key is sent once, when a setup is added or its key replaced, and never
 * comes back. Rows are read a page at a time and re-read after every write,
 * so the grid always shows what Supabase holds, never an optimistic guess.
 */

export const databasesKey = () => [...agentosKeys.all, "databases"] as const;
const setupsKey = () => [...databasesKey(), "setups"] as const;
const projectKey = (slug: string) => [...databasesKey(), "project", slug] as const;
const tablesKey = (setupId: string) => [...databasesKey(), "tables", setupId] as const;
const rowsKey = (setupId: string, table: string, offset: number) => [...databasesKey(), "rows", setupId, table, offset] as const;

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(failure?.error ?? "The database request failed.", response.status);
  }
  return payload as T;
}

const json = (method: string, body: unknown = {}): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const id = (value: string) => encodeURIComponent(value);

function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The database answer came back in an unexpected shape.");
  return parsed.data;
}

const parseSetup = (payload: unknown): DatabaseSetup => parse(DatabaseSetupSchema, (payload as { setup?: unknown } | null)?.setup);

export function useDatabaseSetups() {
  return useQuery({
    queryKey: setupsKey(),
    queryFn: async () => parse(DatabaseLinksSchema, await request("/api/databases/setups")).setups,
    staleTime: 15_000,
    networkMode: "always",
  });
}

export function useProjectDatabases(slug: string) {
  return useQuery({
    queryKey: projectKey(slug),
    queryFn: async () => parse(DatabaseLinksSchema, await request(`/api/databases/projects/${id(slug)}`)).setups,
    staleTime: 30_000,
    networkMode: "always",
    enabled: slug.length > 0,
  });
}

export function useDatabaseTables(setupId: string | undefined) {
  return useQuery({
    queryKey: tablesKey(setupId ?? ""),
    queryFn: async (): Promise<DatabaseTables> => parse(DatabaseTablesSchema, await request(`/api/databases/setups/${id(setupId ?? "")}/tables`)),
    enabled: Boolean(setupId),
    staleTime: 60_000,
    retry: false,
    networkMode: "always",
  });
}

export function useDatabaseRows(setupId: string | undefined, table: string | undefined, offset: number, limit = 50) {
  return useQuery({
    queryKey: rowsKey(setupId ?? "", table ?? "", offset),
    queryFn: async (): Promise<DatabaseRows> =>
      parse(DatabaseRowsSchema, await request(`/api/databases/setups/${id(setupId ?? "")}/tables/${id(table ?? "")}/rows?offset=${offset}&limit=${limit}`)),
    enabled: Boolean(setupId && table),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
    networkMode: "always",
  });
}

/** Any change to setups or links: re-read setups, every workspace's links, and the connector. */
function useSetupMutation<V>(fn: (variables: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: databasesKey() });
      void queryClient.invalidateQueries({ queryKey: connectorsKey() });
    },
  });
}

export interface SetupInput {
  id: string;
  name: string;
  url: string;
  environment?: string;
  key?: string;
  projectSlugs?: string[];
}

export function useAddDatabaseSetup() {
  return useSetupMutation(async (input: SetupInput) => parseSetup(await request("/api/databases/setups", json("POST", input))));
}

export function useUpdateDatabaseSetup() {
  return useSetupMutation(async ({ id: setupId, ...patch }: Partial<SetupInput> & { id: string }) =>
    parseSetup(await request(`/api/databases/setups/${id(setupId)}`, json("PATCH", patch))),
  );
}

export function useTestDatabaseSetup() {
  return useSetupMutation(async (setupId: string) => parseSetup(await request(`/api/databases/setups/${id(setupId)}/test`, json("POST"))));
}

export function useRemoveDatabaseSetup() {
  return useSetupMutation(async (setupId: string) => request(`/api/databases/setups/${id(setupId)}`, json("DELETE")));
}

/** Row writes re-read that table's rows and counts. */
function useRowMutation<V>(setupId: string, table: string, fn: (variables: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...databasesKey(), "rows", setupId, table] });
      void queryClient.invalidateQueries({ queryKey: tablesKey(setupId) });
      void queryClient.invalidateQueries({ queryKey: connectorsKey() });
    },
  });
}

const rowsPath = (setupId: string, table: string) => `/api/databases/setups/${id(setupId)}/tables/${id(table)}/rows`;

export function useInsertRow(setupId: string, table: string) {
  return useRowMutation(setupId, table, (values: Record<string, unknown>) => request(rowsPath(setupId, table), json("POST", { values })));
}

export function useUpdateRow(setupId: string, table: string) {
  return useRowMutation(setupId, table, ({ key, values }: { key: RowKey; values: Record<string, unknown> }) =>
    request(rowsPath(setupId, table), json("PATCH", { key, values })),
  );
}

export function useDeleteRow(setupId: string, table: string) {
  return useRowMutation(setupId, table, (key: RowKey) => request(`${rowsPath(setupId, table)}/delete`, json("POST", { key })));
}
