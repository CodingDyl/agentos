import { ChevronLeft, ChevronRight, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { DatabaseSetup, DatabaseTable, RowKey } from "@shared/database-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, SegmentedControl, Tag } from "@/components/paper";
import {
  useDatabaseRows,
  useDatabaseTables,
  useDeleteRow,
  useInsertRow,
  useProjectDatabases,
  useUpdateRow,
} from "@/lib/agentos/databases";
import { cn } from "@/lib/utils";
import { buildChanges, formatCell, isJsonColumn, pageLabel, rowKey, toInput } from "./database-model";

const PAGE = 50;

/**
 * A workspace's databases: pick a linked Supabase setup, pick a table, page
 * through its rows, and add, edit or delete one row at a time.
 *
 * Every write goes through the Connectors policy for Supabase. Inserts and
 * updates are allowed because pressing Save is the approval; deletes are off
 * until switched on in Connectors → Supabase, and the refusal says so.
 */
export function DatabaseTab({ slug }: { slug: string }) {
  const setups = useProjectDatabases(slug);
  const [setupId, setSetupId] = useState<string>();
  const [tableName, setTableName] = useState<string>();

  const linked = useMemo(() => setups.data ?? [], [setups.data]);
  const setup = linked.find((entry) => entry.id === setupId) ?? linked[0];

  if (setups.isPending) return <p className="text-[14px] text-paper-sage">Reading linked databases…</p>;
  if (setups.isError) return <p role="alert" className="text-[14px] text-paper-flame-deep">{setups.error.message}</p>;

  if (!setup) {
    return (
      <div className="max-w-[60ch]">
        <p className="font-semibold text-paper-moss">No database is linked to this workspace.</p>
        <p className="mt-1 text-[14px] leading-6 text-paper-char">
          Add a Supabase setup in Connectors and tick this workspace. You can link several, e.g. production and staging.
        </p>
        <Link
          to="/connectors/supabase"
          className={cn("mt-4 inline-flex min-h-8 items-center rounded-none bg-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-white uppercase hover:bg-paper-moss", PAPER_FOCUS)}
        >
          Set up Supabase
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {linked.length > 1 ? (
          <SegmentedControl
            label="Database"
            options={linked.map((entry) => ({ value: entry.id, label: entry.environment ? `${entry.name} · ${entry.environment}` : entry.name }))}
            value={setup.id}
            onChange={(value) => {
              setSetupId(value);
              setTableName(undefined);
            }}
          />
        ) : (
          <p className="flex items-center gap-2 text-[14px] font-semibold text-paper-moss">
            {setup.name}
            {setup.environment ? <Tag tone="muted">{setup.environment}</Tag> : null}
          </p>
        )}
        <Link to="/connectors/supabase" className={cn("rounded-[2px] text-[12.5px] text-paper-sage hover:text-paper-moss", PAPER_FOCUS)}>
          Manage databases
        </Link>
      </div>

      {!setup.keySet ? (
        <p role="alert" className="text-[14px] text-paper-flame-deep">
          {setup.name} has no key yet. Add it in <Link to="/connectors/supabase" className="underline">Connectors → Supabase</Link>.
        </p>
      ) : (
        <Tables key={setup.id} setup={setup} tableName={tableName} onSelectTable={setTableName} />
      )}
    </div>
  );
}

function Tables({ setup, tableName, onSelectTable }: { setup: DatabaseSetup; tableName?: string; onSelectTable: (name: string) => void }) {
  const tables = useDatabaseTables(setup.id);
  const list = tables.data?.tables ?? [];
  const table = list.find((entry) => entry.name === tableName) ?? list[0];

  if (tables.isPending) return <p className="text-[14px] text-paper-sage">Reading tables…</p>;
  if (tables.isError) {
    return (
      <div role="alert">
        <p className="text-[14px] text-paper-flame-deep">{tables.error.message}</p>
        <PaperButton variant="ghost" className="mt-3" onClick={() => void tables.refetch()}>
          Try again
        </PaperButton>
      </div>
    );
  }
  if (list.length === 0) return <p className="text-[14px] text-paper-sage">Supabase lists no tables for this key.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Tables">
        <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {list.map((entry) => {
            const selected = entry.name === table?.name;
            return (
              <li key={entry.name} className="shrink-0">
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelectTable(entry.name)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-3 rounded-none px-3 py-2 text-left text-[13.5px]",
                    PAPER_FOCUS,
                    selected ? "bg-paper-blue text-paper-white" : "text-paper-moss hover:bg-paper-linen",
                  )}
                >
                  <span className="truncate font-mono text-[12.5px]">{entry.name}</span>
                  {entry.rowCount !== undefined ? (
                    <span className={cn("text-[12px] tabular-nums", selected ? "text-paper-white" : "text-paper-sage")}>{entry.rowCount.toLocaleString("en-GB")}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {table ? <Rows key={`${setup.id}:${table.name}`} setup={setup} table={table} /> : null}
    </div>
  );
}

type Editing = { mode: "insert" } | { mode: "update"; key: RowKey; row: Record<string, unknown> };

function Rows({ setup, table }: { setup: DatabaseSetup; table: DatabaseTable }) {
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Editing>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const rows = useDatabaseRows(setup.id, table.name, offset, PAGE);
  const remove = useDeleteRow(setup.id, table.name);

  const shown = rows.data?.rows ?? [];
  const total = rows.data?.total;
  const editable = table.primaryKey.length > 0;

  return (
    <section aria-label={`Rows in ${table.name}`} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-[15px] font-semibold text-paper-moss">{table.name}</h3>
          <p className="text-[12.5px] text-paper-sage" aria-live="polite">
            {rows.data ? pageLabel(offset, shown.length, total) : "Reading…"}
            {!editable ? " · no primary key, so rows are read-only here" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PaperButton variant="quiet" onClick={() => void rows.refetch()} disabled={rows.isFetching} aria-label="Refresh rows">
            <RefreshCw className={cn("size-3.5", rows.isFetching && "motion-safe:animate-spin")} aria-hidden="true" />
          </PaperButton>
          <PaperButton variant="ghost" onClick={() => setEditing({ mode: "insert" })}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add row
          </PaperButton>
        </div>
      </div>

      {editing ? <RowForm setup={setup} table={table} editing={editing} onDone={() => setEditing(undefined)} /> : null}

      {rows.isError ? (
        <p role="alert" className="text-[14px] text-paper-flame-deep">{rows.error.message}</p>
      ) : (
        <div className="overflow-x-auto rounded-none border border-paper-mist">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-paper-linen">
              <tr>
                {editable ? <th scope="col" className="w-[72px] px-2 py-2"><span className="sr-only">Actions</span></th> : null}
                {table.columns.map((column) => (
                  <th key={column.name} scope="col" className="px-3 py-2 font-mono text-[12px] font-semibold whitespace-nowrap text-paper-moss">
                    <span className="inline-flex items-center gap-1">
                      {column.primaryKey ? <KeyRound className="size-3" aria-label="Primary key" /> : null}
                      {column.name}
                    </span>
                    <span className="block font-paper-ui text-[11px] font-normal text-paper-sage">{column.format ?? column.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => {
                const key = rowKey(table, row);
                const id = key ? JSON.stringify(key) : String(index);
                return (
                  <tr key={id} className="border-t border-paper-stone align-top hover:bg-paper-cream">
                    {editable ? (
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {key ? (
                          confirmDelete === id ? (
                            <span className="flex flex-col gap-1">
                              <button
                                type="button"
                                className={cn("cursor-pointer text-[12px] font-semibold text-paper-flame-deep", PAPER_FOCUS)}
                                disabled={remove.isPending}
                                onClick={() => remove.mutate(key, { onSettled: () => setConfirmDelete(undefined) })}
                              >
                                {remove.isPending ? "Deleting…" : "Delete?"}
                              </button>
                              <button type="button" className={cn("cursor-pointer text-[12px] text-paper-sage", PAPER_FOCUS)} onClick={() => setConfirmDelete(undefined)}>
                                Keep
                              </button>
                            </span>
                          ) : (
                            <span className="flex gap-1">
                              <button
                                type="button"
                                aria-label="Edit row"
                                onClick={() => setEditing({ mode: "update", key, row })}
                                className={cn("grid size-7 cursor-pointer place-items-center text-paper-sage hover:bg-paper-linen hover:text-paper-moss", PAPER_FOCUS)}
                              >
                                <Pencil className="size-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete row"
                                onClick={() => setConfirmDelete(id)}
                                className={cn("grid size-7 cursor-pointer place-items-center text-paper-sage hover:bg-paper-linen hover:text-paper-flame-deep", PAPER_FOCUS)}
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </button>
                            </span>
                          )
                        ) : null}
                      </td>
                    ) : null}
                    {table.columns.map((column) => {
                      const cell = formatCell(row[column.name]);
                      return (
                        <td key={column.name} className={cn("max-w-[320px] truncate px-3 py-1.5 font-mono text-[12.5px]", cell.isNull ? "text-paper-ash italic" : "text-paper-moss")} title={cell.isNull ? undefined : toInput(row[column.name])}>
                          {cell.text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {remove.isError ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {remove.error.message}
          {remove.error.message.includes("turned off") ? (
            <>
              {" "}
              <Link to="/connectors/supabase" className="underline">Change it in Connectors</Link>.
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <PaperButton variant="quiet" disabled={offset === 0 || rows.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE))} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </PaperButton>
        <PaperButton
          variant="quiet"
          disabled={rows.isFetching || shown.length < PAGE || (total !== undefined && offset + PAGE >= total)}
          onClick={() => setOffset(offset + PAGE)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </PaperButton>
      </div>
    </section>
  );
}

function RowForm({ setup, table, editing, onDone }: { setup: DatabaseSetup; table: DatabaseTable; editing: Editing; onDone: () => void }) {
  const insert = useInsertRow(setup.id, table.name);
  const update = useUpdateRow(setup.id, table.name);
  const mutation = editing.mode === "insert" ? insert : update;
  const original = editing.mode === "update" ? editing.row : undefined;

  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(table.columns.map((column) => [column.name, toInput(original?.[column.name])])),
  );
  const [errors, setErrors] = useState<string[]>([]);

  // Escape closes the form without saving.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { values, errors: problems } = buildChanges(table, draft, editing.mode, original);
    setErrors(problems);
    if (problems.length > 0) return;
    if (Object.keys(values).length === 0) {
      setErrors([editing.mode === "insert" ? "Fill in at least one field." : "Nothing changed."]);
      return;
    }
    if (editing.mode === "insert") insert.mutate(values, { onSuccess: onDone });
    else update.mutate({ key: editing.key, values }, { onSuccess: onDone });
  };

  return (
    <form
      onSubmit={submit}
      aria-label={editing.mode === "insert" ? `New row in ${table.name}` : `Edit row in ${table.name}`}
      className="mb-4 space-y-4 rounded-none border border-paper-mist bg-paper-cream p-5"
    >
      <p className="text-[13px] text-paper-char">
        {editing.mode === "insert"
          ? "Leave a field empty to use its default."
          : "Only changed fields are sent. Empty sets NULL where that's allowed. Primary keys name the row and can't be edited."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {table.columns.map((column) => {
          const locked = editing.mode === "update" && column.primaryKey;
          const json = isJsonColumn(column);
          const common = {
            name: column.name,
            value: draft[column.name] ?? "",
            disabled: locked,
            spellCheck: false,
            onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [column.name]: event.target.value })),
            className: cn(PAPER_INPUT, "w-full font-mono text-[13px] disabled:opacity-60"),
            placeholder: column.hasDefault ? "default" : column.required ? "" : "NULL",
          };
          return (
            <label key={column.name} className={cn("block", json && "sm:col-span-2")}>
              <FieldLabel>
                <span className="font-mono">{column.name}</span>{" "}
                <span className="text-paper-sage">
                  {column.format ?? column.type}
                  {column.required ? " · required" : ""}
                </span>
              </FieldLabel>
              {json ? (
                <textarea {...common} rows={4} className={cn(common.className, "py-2")} />
              ) : column.type === "boolean" ? (
                <select {...common}>
                  <option value="">{column.required ? "—" : "NULL"}</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input {...common} />
              )}
            </label>
          );
        })}
      </div>

      {[...errors, ...(mutation.isError ? [mutation.error.message] : [])].map((message) => (
        <p key={message} role="alert" className="text-[13px] text-paper-flame-deep">{message}</p>
      ))}

      <div className="flex flex-wrap gap-3">
        <PaperButton type="submit" variant="amber" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : editing.mode === "insert" ? "Insert row" : "Save changes"}
        </PaperButton>
        <PaperButton variant="quiet" onClick={onDone}>
          Cancel
        </PaperButton>
      </div>
    </form>
  );
}
