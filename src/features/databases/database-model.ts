import type { DatabaseColumn, DatabaseTable, RowKey } from "@shared/database-types";

/**
 * The Database tab's rules for turning what was typed into what Supabase is
 * sent, kept here so they can be tested:
 *
 * - numbers must be numbers and JSON must parse, or nothing is sent;
 * - an empty field on a new row is left out, so the column's default applies;
 * - an empty field on an existing row sets NULL, but only where NULL is allowed;
 * - an update sends only the fields that changed.
 */

/** `Pantry Pilot (prod)` → `pantry-pilot-prod`: a setup id that is also a valid variable-name suffix. */
export function setupIdFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return /^[a-z]/.test(slug) ? slug : `db-${slug}`.slice(0, 32);
}

const CELL_LIMIT = 80;

/** How a value reads in the grid. NULL is said, not left blank. */
export function formatCell(value: unknown): { text: string; isNull: boolean } {
  if (value === null || value === undefined) return { text: "NULL", isNull: true };
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return { text: text.length > CELL_LIMIT ? `${text.slice(0, CELL_LIMIT - 1)}…` : text, isNull: false };
}

/** What an input starts with when editing: the value as text, JSON pretty enough to edit. */
export function toInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function isJsonColumn(column: DatabaseColumn): boolean {
  return column.type === "object" || column.type === "array" || column.format === "json" || column.format === "jsonb";
}

export type Coerced = { kind: "value"; value: unknown } | { kind: "omit" } | { kind: "error"; message: string };

export function coerce(column: DatabaseColumn, raw: string, mode: "insert" | "update"): Coerced {
  const text = raw.trim();

  if (text === "") {
    if (mode === "insert") {
      return column.required && !column.hasDefault ? { kind: "error", message: `${column.name} is required.` } : { kind: "omit" };
    }
    return column.required ? { kind: "error", message: `${column.name} can't be empty.` } : { kind: "value", value: null };
  }

  if (column.type === "integer") {
    return /^-?\d+$/.test(text) ? { kind: "value", value: Number(text) } : { kind: "error", message: `${column.name} must be a whole number.` };
  }
  if (column.type === "number") {
    const number = Number(text);
    return Number.isFinite(number) ? { kind: "value", value: number } : { kind: "error", message: `${column.name} must be a number.` };
  }
  if (column.type === "boolean") {
    if (text === "true" || text === "false") return { kind: "value", value: text === "true" };
    return { kind: "error", message: `${column.name} must be true or false.` };
  }
  if (isJsonColumn(column)) {
    try {
      return { kind: "value", value: JSON.parse(text) };
    } catch {
      return { kind: "error", message: `${column.name} isn't valid JSON.` };
    }
  }
  // Strings, uuids, dates, timestamps: Postgres checks the format itself.
  return { kind: "value", value: raw };
}

/** Every primary-key column's value in this row, or undefined when the table has no key. */
export function rowKey(table: DatabaseTable, row: Record<string, unknown>): RowKey | undefined {
  if (table.primaryKey.length === 0) return undefined;
  const key: RowKey = {};
  for (const column of table.primaryKey) {
    const value = row[column];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
    key[column] = value;
  }
  return key;
}

/**
 * The body to send, or the problems stopping it.
 *
 * On update, a field is sent only if its text differs from what it started
 * as, and primary keys are never sent: they name the row, they aren't edited.
 */
export function buildChanges(
  table: DatabaseTable,
  draft: Readonly<Record<string, string>>,
  mode: "insert" | "update",
  original?: Readonly<Record<string, unknown>>,
): { values: Record<string, unknown>; errors: string[] } {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const column of table.columns) {
    if (mode === "update" && column.primaryKey) continue;
    const raw = draft[column.name] ?? "";
    if (mode === "update" && raw === toInput(original?.[column.name])) continue;

    const result = coerce(column, raw, mode);
    if (result.kind === "error") errors.push(result.message);
    else if (result.kind === "value") values[column.name] = result.value;
  }

  return { values, errors };
}

/** "1–50 of 1,204", or "51–63" when Supabase gave no total. */
export function pageLabel(offset: number, shown: number, total: number | undefined): string {
  if (shown === 0) return total === 0 ? "No rows" : "Nothing on this page";
  const range = `${(offset + 1).toLocaleString("en-GB")}–${(offset + shown).toLocaleString("en-GB")}`;
  return total === undefined ? range : `${range} of ${total.toLocaleString("en-GB")}`;
}
