import { Save, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { normaliseTag } from "@shared/memory-paths";
import { MEMORY_TYPE_LABELS, MEMORY_TYPES, isMemoryType, type MemoryNoteDetail, type MemoryType } from "@shared/memory-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { MemoryRequestError, useEditMemoryNote, useMemoryNote } from "@/lib/agentos/memory";
import { cn } from "@/lib/utils";

/**
 * Editing a note in place: its text, its type and its tags.
 *
 * The edit is composed against the revision on screen. If the file changed
 * since — saved in Obsidian, edited in another window — the save is refused
 * and the person chooses: load the latest version (their draft stays visible
 * to copy from), or keep editing. Nothing is overwritten without that choice.
 * Provenance is not editable here; the server keeps it.
 */

function frontmatterTags(note: MemoryNoteDetail): string[] {
  const raw = note.frontmatter.tags ?? note.frontmatter.tag;
  const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  return list.flatMap((tag) => (typeof tag === "string" && normaliseTag(tag) ? [normaliseTag(tag) as string] : []));
}

export function NoteEditor({ note, onDone }: { note: MemoryNoteDetail; onDone: () => void }) {
  const formId = useId();
  const edit = useEditMemoryNote();
  const latest = useMemoryNote(note.id);

  const [revision, setRevision] = useState(note.revision);
  const [body, setBody] = useState(note.content);
  const [type, setType] = useState<MemoryType | "">(note.memoryType ?? "");
  const [tags, setTags] = useState(frontmatterTags(note).join(", "));
  const [orphanedDraft, setOrphanedDraft] = useState<string>();

  const conflict = edit.error instanceof MemoryRequestError && edit.error.isConflict;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (edit.isPending || !body.trim()) return;
    const nextTags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const typeChanged = (note.memoryType ?? "") !== type;
    const tagsChanged = nextTags.join(",") !== frontmatterTags(note).join(",");

    edit.mutate(
      {
        id: note.id,
        expectedRevision: revision,
        body,
        type: typeChanged ? (type === "" ? null : type) : undefined,
        tags: tagsChanged ? nextTags : undefined,
      },
      { onSuccess: onDone },
    );
  };

  const loadLatest = async () => {
    const fresh = (await latest.refetch()).data;
    if (!fresh) return;
    setOrphanedDraft(body);
    setRevision(fresh.revision);
    setBody(fresh.content);
    setType(fresh.memoryType ?? "");
    setTags(frontmatterTags(fresh).join(", "));
    edit.reset();
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-4 px-6 py-5" aria-label={`Edit ${note.title}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Type</FieldLabel>
          <select
            value={type}
            onChange={(event) => setType(isMemoryType(event.target.value) ? event.target.value : "")}
            className={cn(PAPER_INPUT, "min-h-10 w-full cursor-pointer text-[14px]")}
          >
            <option value="">No type</option>
            {MEMORY_TYPES.map((value) => (
              <option key={value} value={value}>
                {MEMORY_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <FieldLabel>Tags</FieldLabel>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="comma, separated"
            className={cn(PAPER_INPUT, "min-h-10 w-full text-[14px]")}
          />
        </label>
      </div>

      <label className="block">
        <FieldLabel>Note</FieldLabel>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={18}
          spellCheck
          className={cn(PAPER_INPUT, "w-full resize-y font-mono text-[13px] leading-6")}
        />
      </label>

      {conflict ? (
        <div role="alert" className="border-l-2 border-paper-flame-deep bg-paper-linen px-4 py-3 text-[13.5px] leading-5">
          <p className="font-medium text-paper-flame-deep">{edit.error?.message}</p>
          <PaperButton variant="ghost" className="mt-2" onClick={() => void loadLatest()} disabled={latest.isFetching}>
            {latest.isFetching ? "Loading…" : "Load the latest version"}
          </PaperButton>
          <p className="mt-1.5 text-[12.5px] text-paper-sage">Your text stays below so you can copy what you need back in.</p>
        </div>
      ) : edit.error ? (
        <p role="alert" className="text-[13.5px] text-paper-flame-deep">
          {edit.error.message}
        </p>
      ) : null}

      {orphanedDraft !== undefined ? (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-paper-char">Your unsaved text</summary>
          <textarea readOnly value={orphanedDraft} rows={8} className={cn(PAPER_INPUT, "mt-2 w-full font-mono text-[12.5px]")} />
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <PaperButton type="submit" variant="amber" disabled={edit.isPending || !body.trim()}>
          <Save className="size-3.5" strokeWidth={2} aria-hidden="true" /> {edit.isPending ? "Saving…" : "Save"}
        </PaperButton>
        <PaperButton onClick={onDone} disabled={edit.isPending}>
          <X className="size-3.5" strokeWidth={2} aria-hidden="true" /> Cancel
        </PaperButton>
        <span className="text-[12.5px] text-paper-sage">Front matter and provenance are kept. The change can be undone.</span>
      </div>
    </form>
  );
}
