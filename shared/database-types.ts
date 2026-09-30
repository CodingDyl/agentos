import { z } from "zod";

/**
 * Databases: named Supabase setups, which workspaces they belong to, and what
 * the workspace Database tab reads and writes.
 *
 * A setup's secret key lives in `.env` and never appears here. The browser
 * sees a setup's name, its project URL, whether its key is set, and which
 * workspaces link to it.
 */

/** Lower-case letters, digits and dashes: the setup id is part of the key's variable name. */
export const DatabaseIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "Use lower-case letters, digits and dashes, starting with a letter.");

export const DatabaseSetupSchema = z.object({
  id: DatabaseIdSchema,
  name: z.string(),
  url: z.string(),
  /** e.g. production, staging. Free text, shown on the tab's picker. */
  environment: z.string().optional(),
  keySet: z.boolean(),
  /** The `.env` variable the key is stored under. A name, never the value. */
  keyEnvName: z.string(),
  projectSlugs: z.array(z.string()),
  lastTest: z.object({ ok: z.boolean(), checkedAt: z.string(), detail: z.string() }).optional(),
});

export const DatabaseSetupInputSchema = z
  .object({
    id: DatabaseIdSchema,
    name: z.string().trim().min(1).max(60),
    url: z.string().trim().url(),
    environment: z.string().trim().max(30).optional(),
    /** Blank on an edit keeps the saved key. */
    key: z.string().max(4096).optional(),
    projectSlugs: z.array(z.string().max(80)).max(50).optional(),
  })
  .strict();

export const DatabaseSetupPatchSchema = DatabaseSetupInputSchema.omit({ id: true }).partial().strict();

export const DatabaseColumnSchema = z.object({
  name: z.string(),
  /** PostgREST's JSON type: string, integer, number, boolean, array, object. */
  type: z.string(),
  /** The Postgres type, e.g. `uuid`, `timestamp with time zone`, `text`. */
  format: z.string().optional(),
  primaryKey: z.boolean(),
  required: z.boolean(),
  hasDefault: z.boolean(),
});

export const DatabaseTableSchema = z.object({
  name: z.string(),
  columns: z.array(DatabaseColumnSchema),
  /** Editable rows need a primary key to say which row. */
  primaryKey: z.array(z.string()),
  /** Estimated for large tables; undefined when Supabase wouldn't say. */
  rowCount: z.number().int().nonnegative().optional(),
});

export const DatabaseTablesSchema = z.object({
  setupId: z.string(),
  tables: z.array(DatabaseTableSchema),
});

export const DatabaseRowsSchema = z.object({
  table: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative().optional(),
});

/** Which row: every primary-key column and its value. */
export const RowKeySchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const RowInsertSchema = z.object({ values: z.record(z.string(), z.unknown()) }).strict();
export const RowUpdateSchema = z.object({ key: RowKeySchema, values: z.record(z.string(), z.unknown()) }).strict();
export const RowDeleteSchema = z.object({ key: RowKeySchema }).strict();

export const DatabaseLinksSchema = z.object({
  setups: z.array(DatabaseSetupSchema),
});

export type DatabaseSetup = z.infer<typeof DatabaseSetupSchema>;
export type DatabaseSetupInput = z.infer<typeof DatabaseSetupInputSchema>;
export type DatabaseSetupPatch = z.infer<typeof DatabaseSetupPatchSchema>;
export type DatabaseColumn = z.infer<typeof DatabaseColumnSchema>;
export type DatabaseTable = z.infer<typeof DatabaseTableSchema>;
export type DatabaseTables = z.infer<typeof DatabaseTablesSchema>;
export type DatabaseRows = z.infer<typeof DatabaseRowsSchema>;
export type RowKey = z.infer<typeof RowKeySchema>;

/** `pantry-prod` → `SUPABASE_KEY__PANTRY_PROD`. */
export function keyEnvNameFor(id: string): string {
  return `SUPABASE_KEY__${id.toUpperCase().replace(/-/g, "_")}`;
}
