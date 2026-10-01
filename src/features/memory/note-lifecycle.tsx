import { Archive, ArchiveRestore, History, Pencil, Undo2 } from "lucide-react";
import { useState } from "react";
import { MEMORY_TYPE_LABELS, type MemoryHistoryEntry, type MemoryNoteDetail, type MemoryProvenance } from "@shared/memory-types";
import { PaperButton, Tag } from "@/components/paper";
import { formatRelativeTime } from "@/lib/format";
import { useArchiveMemoryNote, useMemoryHistory, useRestoreMemoryNote, useUndoMemoryChange } from "@/lib/agentos/memory";

/**
 * What a person can do to a note that already exists — edit, archive, restore,
 * undo — and where it came from.
 *
 * Every action is sent with the revision on screen; if the note moved in
 * Obsidian meanwhile the server refuses, and the message says so instead of
 * the click quietly winning.
 */

function who(actor: string | undefined): string | undefined {
  if (!actor) return undefined;
  if (actor === "human") return "You";
  if (actor.startsWith("agent:")) return `${actor.slice(6)} (agent)`;
  return actor;
}

function when(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · ${formatRelativeTime(value)}`;
}

export function NoteToolbar({ note, onEdit }: { note: MemoryNoteDetail; onEdit: () => void }) {
  const archive = useArchiveMemoryNote();
  const restore = useRestoreMemoryNote();
  const undo = useUndoMemoryChange();
  const history = useMemoryHistory(note.id);

  const busy = archive.isPending || restore.isPending || undo.isPending;
  const error = archive.error ?? restore.error ?? undo.error;
  const undoable = history.data?.entries.find((entry) => entry.id === history.data?.undoable);
  const editable = !note.stale && !note.truncated;

  return (
    <div className="border-b border-paper-mist px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {note.memoryType ? <Tag tone="blue">{MEMORY_TYPE_LABELS[note.memoryType]}</Tag> : null}
        {note.archived ? <Tag tone="marigold">Archived</Tag> : null}
        <span className="flex-1" />
        <PaperButton variant="ghost" onClick={onEdit} disabled={!editable || busy} title={editable ? "Edit this note" : "Stale or too long to edit here"}>
          <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" /> Edit
        </PaperButton>
        {note.archived ? (
          <PaperButton variant="ghost" disabled={busy || note.stale} onClick={() => restore.mutate({ id: note.id, expectedRevision: note.revision })}>
            <ArchiveRestore className="size-3.5" strokeWidth={2} aria-hidden="true" /> {restore.isPending ? "Restoring…" : "Restore"}
          </PaperButton>
        ) : (
          <PaperButton variant="quiet" disabled={busy || note.stale} onClick={() => archive.mutate({ id: note.id, expectedRevision: note.revision })}>
            <Archive className="size-3.5" strokeWidth={2} aria-hidden="true" /> {archive.isPending ? "Archiving…" : "Archive"}
          </PaperButton>
        )}
        {undoable ? (
          <PaperButton
            variant="quiet"
            disabled={busy}
            title={`Undo: ${undoable.summary}`}
            onClick={() => undo.mutate({ id: note.id, historyId: undoable.id })}
          >
            <Undo2 className="size-3.5" strokeWidth={2} aria-hidden="true" /> {undo.isPending ? "Undoing…" : "Undo"}
          </PaperButton>
        ) : null}
      </div>
      {note.archived ? (
        <p className="mt-2 text-[13px] leading-5 text-paper-char">
          Archived {note.provenance.archivedAt ? formatRelativeTime(note.provenance.archivedAt) : ""}. It stays in the vault and can be restored, but it is no longer given to agents as context.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-5 text-paper-flame-deep">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}

const PROVENANCE_ROWS: ReadonlyArray<[keyof MemoryProvenance, string, "actor" | "date" | "text"]> = [
  ["createdBy", "Created by", "actor"],
  ["createdAt", "Created", "date"],
  ["approvedBy", "Approved by", "actor"],
  ["sourceProject", "Project", "text"],
  ["sourceTask", "Source task", "text"],
  ["sourceRun", "Run", "text"],
  ["sourceArtifact", "Artifact", "text"],
  ["lastSourceTask", "Last updated from", "text"],
  ["updatedBy", "Updated by", "actor"],
  ["updatedAt", "Updated", "date"],
  ["archivedBy", "Archived by", "actor"],
  ["archivedAt", "Archived", "date"],
];

export function NoteProvenance({ provenance }: { provenance: MemoryProvenance }) {
  const rows = PROVENANCE_ROWS.flatMap(([key, label, kind]) => {
    const raw = provenance[key];
    const value = kind === "actor" ? who(raw) : kind === "date" ? when(raw) : raw;
    return value ? [{ key, label, value }] : [];
  });

  return (
    <section aria-label="Provenance" className="border-t border-paper-mist py-3">
      <h3 className="px-5 pb-1.5 font-paper-utility text-[12px] font-semibold tracking-[0.1em] text-paper-char uppercase">Provenance</h3>
      {rows.length === 0 ? (
        <p className="px-5 py-1 text-[13.5px] text-paper-sage">Not recorded — this note was written outside AgentOS.</p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1 px-5 text-[13.5px]">
          {rows.map((row) => (
            <div key={row.key} className="contents">
              <dt className="text-paper-sage">{row.label}</dt>
              <dd className="min-w-0 truncate text-paper-moss" title={row.value}>{row.value}</dd>
            </div>
          ))}
          {!provenance.createdAt ? (
            <div className="contents">
              <dt className="text-paper-sage">Created</dt>
              <dd className="text-paper-sage">Not recorded</dd>
            </div>
          ) : null}
        </dl>
      )}
    </section>
  );
}

const ACTION_LABELS: Record<MemoryHistoryEntry["action"], string> = {
  create: "Created",
  edit: "Edited",
  archive: "Archived",
  restore: "Restored",
  undo: "Undone",
  "update-from-task": "Updated from task",
};

export function NoteHistory({ noteId }: { noteId: string }) {
  const [open, setOpen] = useState(false);
  const history = useMemoryHistory(noteId, open);
  const undo = useUndoMemoryChange();
  const entries = history.data?.entries ?? [];

  return (
    <section aria-label="History" className="border-t border-paper-mist py-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 px-5 pb-1.5 text-left font-paper-utility text-[12px] font-semibold tracking-[0.1em] text-paper-char uppercase hover:text-paper-blue"
      >
        <History className="size-3.5" strokeWidth={2} aria-hidden="true" /> History {open ? "−" : "+"}
      </button>
      {open ? (
        history.isPending ? (
          <p className="px-5 py-1 text-[13.5px] text-paper-sage">Reading history…</p>
        ) : entries.length === 0 ? (
          <p className="px-5 py-1 text-[13.5px] text-paper-sage">No changes made through AgentOS yet. Edits made in Obsidian are not listed here.</p>
        ) : (
          <ol className="px-5">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-3 border-b border-paper-mist/60 py-2 text-[13.5px] last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className={entry.undoneAt ? "text-paper-sage line-through" : "font-medium text-paper-moss"}>{ACTION_LABELS[entry.action]}</span>
                  <span className="text-paper-char"> — {entry.summary}</span>
                  <span className="block text-[12px] text-paper-sage">
                    {who(entry.by) ?? entry.by} · {formatRelativeTime(entry.at)}
                    {entry.sourceTask ? ` · ${entry.sourceTask}` : ""}
                  </span>
                </span>
                {history.data?.undoable === entry.id ? (
                  <PaperButton variant="quiet" disabled={undo.isPending} onClick={() => undo.mutate({ id: noteId, historyId: entry.id })}>
                    <Undo2 className="size-3.5" strokeWidth={2} aria-hidden="true" /> Undo
                  </PaperButton>
                ) : null}
              </li>
            ))}
          </ol>
        )
      ) : null}
      {undo.error ? (
        <p role="alert" className="px-5 pt-1 text-[13px] text-paper-flame-deep">
          {undo.error.message}
        </p>
      ) : null}
    </section>
  );
}
