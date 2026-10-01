import { Archive, ArchiveRestore, Brain, ExternalLink, Pencil, Play, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatTimestamp, LEARNING_SOURCE_LABELS, type LearningNote, type LearningSource, type LearningSourceType } from "@shared/learning-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, SegmentedControl, Tag } from "@/components/paper";
import { Markdown } from "@/components/os/markdown";
import { formatRelativeTime } from "@/lib/format";
import { useUpdateLearningNote } from "@/lib/agentos/learning";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { LearningCapture, WorkspaceTaskPicker } from "./learning-capture";
import { filterNotes, sourceHref, tagsFromText, type NoteFilters } from "./learning-model";
import { PromoteDialog } from "./promote-dialog";

/**
 * Saved learnings: everything captured, searchable, and each one editable,
 * archivable, linkable to a workspace and task, openable at the moment it
 * came from, and promotable to memory — with approval, one at a time.
 */

const SOURCE_FILTERS: ReadonlyArray<{ value: LearningSourceType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "youtube", label: "YouTube" },
  { value: "spotify", label: "Spotify" },
  { value: "notebook", label: "Notebooks" },
  { value: "manual", label: "Notes" },
];

export function SavedLearning({
  notes,
  sources,
  selectedId,
  onSelect,
}: {
  notes: LearningNote[];
  sources: LearningSource[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const projects = useProjects();
  const [filters, setFilters] = useState<NoteFilters>({ query: "", sourceType: "all", workspace: "all", archived: false });
  const [adding, setAdding] = useState(false);

  const visible = filterNotes(notes, filters);
  const selected = notes.find((note) => note.id === selectedId);
  const projectName = (slug?: string) => projects.data?.projects.find((project) => project.slug === slug)?.name ?? slug;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <label className="relative block flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
            <input
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              placeholder="Search learnings"
              aria-label="Search learnings"
              className={cn(PAPER_INPUT, "min-h-10 w-full pl-9")}
            />
          </label>
          <PaperButton variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" /> New
          </PaperButton>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SegmentedControl label="Source" options={SOURCE_FILTERS} value={filters.sourceType} onChange={(sourceType) => setFilters({ ...filters, sourceType })} />
          <select
            value={filters.workspace}
            onChange={(event) => setFilters({ ...filters, workspace: event.target.value })}
            aria-label="Workspace"
            className={cn(PAPER_INPUT, "min-h-8 cursor-pointer text-[13px]")}
          >
            <option value="all">Any workspace</option>
            <option value="">No workspace</option>
            {(projects.data?.projects ?? []).map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-paper-char">
            <input type="checkbox" checked={filters.archived} onChange={(event) => setFilters({ ...filters, archived: event.target.checked })} /> Archived
          </label>
        </div>

        <ul className="mt-4 divide-y divide-paper-mist border-y border-paper-mist" aria-label="Learnings">
          {visible.length === 0 ? (
            <li className="py-6 text-[14px] text-paper-sage">{notes.length === 0 ? "Nothing captured yet. Capture a learning while you watch, or add one with New." : "No learnings match."}</li>
          ) : (
            visible.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onSelect(note.id)}
                  aria-current={note.id === selectedId ? "true" : undefined}
                  className={cn("block w-full cursor-pointer px-3 py-3 text-left hover:bg-paper-linen", PAPER_FOCUS, note.id === selectedId && "bg-paper-linen")}
                >
                  <span className="block truncate text-[15px] font-medium text-paper-moss">{note.title}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-paper-sage">
                    {LEARNING_SOURCE_LABELS[note.sourceType]}
                    {note.timestampSeconds !== undefined ? ` · ${formatTimestamp(note.timestampSeconds)}` : ""}
                    {note.workspaceId ? ` · ${projectName(note.workspaceId)}` : ""}
                    {note.promotedTo.length > 0 ? " · in memory" : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="min-w-0">
        {adding ? (
          <LearningCapture
            context={{ sourceType: "manual" }}
            onDone={(id) => {
              setAdding(false);
              if (id) onSelect(id);
            }}
          />
        ) : selected ? (
          <LearningDetail key={selected.id} note={selected} sources={sources} projectName={projectName(selected.workspaceId)} />
        ) : (
          <p className="text-[14px] text-paper-sage">Choose a learning to read it, edit it, or promote it to memory.</p>
        )}
      </div>
    </div>
  );
}

function LearningDetail({ note, sources, projectName }: { note: LearningNote; sources: LearningSource[]; projectName?: string }) {
  const update = useUpdateLearningNote();
  const [editing, setEditing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [draft, setDraft] = useState({ title: note.title, content: note.content, tags: note.tags.join(", "), workspaceId: note.workspaceId, taskId: note.taskId });
  const open = sourceHref(note, sources);

  const save = () =>
    update.mutate(
      {
        id: note.id,
        title: draft.title.trim() || note.title,
        content: draft.content,
        tags: tagsFromText(draft.tags),
        workspaceId: draft.workspaceId ?? null,
        taskId: draft.taskId ?? null,
      },
      { onSuccess: () => setEditing(false) },
    );

  return (
    <article className="border border-paper-mist bg-paper-white p-6" aria-label={note.title}>
      {editing ? (
        <div className="space-y-4">
          <label className="block">
            <FieldLabel>Title</FieldLabel>
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={200} className={cn(PAPER_INPUT, "min-h-10 w-full text-[16px]")} />
          </label>
          <label className="block">
            <FieldLabel>Notes</FieldLabel>
            <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} rows={8} className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")} />
          </label>
          <label className="block">
            <FieldLabel>Tags</FieldLabel>
            <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} className={cn(PAPER_INPUT, "min-h-10 w-full")} />
          </label>
          <WorkspaceTaskPicker workspaceId={draft.workspaceId} taskId={draft.taskId} onChange={(link) => setDraft({ ...draft, ...link })} />
          {update.error ? <p role="alert" className="text-[13.5px] text-paper-flame-deep">{update.error.message}</p> : null}
          <div className="flex gap-2">
            <PaperButton variant="amber" onClick={save} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </PaperButton>
            <PaperButton onClick={() => setEditing(false)}>Cancel</PaperButton>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="blue">{LEARNING_SOURCE_LABELS[note.sourceType]}</Tag>
            {note.timestampSeconds !== undefined ? <span className="font-mono text-[13px] text-paper-char">{formatTimestamp(note.timestampSeconds)}</span> : null}
            {note.archived ? <Tag tone="marigold">Archived</Tag> : null}
            {note.promotedTo.length > 0 ? <Tag tone="green">In memory</Tag> : null}
          </div>
          <h2 className="mt-3 font-paper-display text-[26px] leading-tight font-bold tracking-[-0.01em]">{note.title}</h2>
          <p className="mt-1 text-[13px] text-paper-sage">
            {note.sourceTitle ? `${note.sourceTitle} · ` : ""}Captured {formatRelativeTime(note.createdAt)}
            {projectName ? (
              <>
                {" · "}
                <Link to={`/workspaces/${encodeURIComponent(note.workspaceId!)}${note.taskId ? `?tab=tasks&task=${encodeURIComponent(note.taskId)}` : ""}`} className="text-paper-blue underline-offset-2 hover:underline">
                  {projectName}
                  {note.taskId ? ` · ${note.taskId}` : ""}
                </Link>
              </>
            ) : null}
          </p>
          {note.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {note.tags.map((tag) => (
                <span key={tag} className="border border-paper-mist px-1.5 text-[12px] text-paper-char">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-5">
            {note.content.trim() ? <Markdown content={note.content} tone="paper" className="max-w-[68ch]" /> : <p className="text-[14px] text-paper-sage">No notes beyond the title.</p>}
          </div>

          {note.promotedTo.length > 0 ? (
            <p className="mt-4 text-[13px] text-paper-char">
              Memory:{" "}
              {note.promotedTo.map((target) => (
                <Link key={target} to={`/memory?note=${encodeURIComponent(target)}`} className="mr-2 font-mono text-[12.5px] text-paper-blue hover:underline">
                  {target}
                </Link>
              ))}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2 border-t border-paper-mist pt-4">
            {open ? (
              open.internal ? (
                <Link to={open.href} className={cn("inline-flex min-h-8 items-center gap-1.5 bg-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-white uppercase hover:bg-paper-moss", PAPER_FOCUS)}>
                  <Play className="size-3.5" strokeWidth={2} aria-hidden="true" /> {note.timestampSeconds !== undefined ? `Open at ${formatTimestamp(note.timestampSeconds)}` : "Open source"}
                </Link>
              ) : (
                <a href={open.href} target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-8 items-center gap-1.5 border-[1.5px] border-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-blue uppercase hover:bg-paper-linen", PAPER_FOCUS)}>
                  <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" /> Open original
                </a>
              )
            ) : null}
            <PaperButton variant="ghost" onClick={() => setPromoting(true)} disabled={note.archived}>
              <Brain className="size-3.5" strokeWidth={2} aria-hidden="true" /> Promote to memory
            </PaperButton>
            <PaperButton onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" /> Edit
            </PaperButton>
            <PaperButton onClick={() => update.mutate({ id: note.id, archived: !note.archived })} disabled={update.isPending}>
              {note.archived ? <ArchiveRestore className="size-3.5" strokeWidth={2} aria-hidden="true" /> : <Archive className="size-3.5" strokeWidth={2} aria-hidden="true" />}
              {note.archived ? "Restore" : "Archive"}
            </PaperButton>
          </div>
        </>
      )}
      {promoting ? <PromoteDialog note={note} onClose={() => setPromoting(false)} /> : null}
    </article>
  );
}
