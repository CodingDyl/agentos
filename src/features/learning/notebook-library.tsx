import { BookmarkPlus, Check, Copy, ExternalLink, NotebookText, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { LearningNote, LearningSource, Notebook } from "@shared/learning-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, Tag } from "@/components/paper";
import { useCreateNotebook, useDeleteNotebook, useUpdateNotebook } from "@/lib/agentos/learning";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { LearningCapture } from "./learning-capture";
import { notebookSourceList, relatedNotes } from "./learning-model";

/**
 * Research notebooks — NotebookLM or anything like it — beside AgentOS.
 *
 * AgentOS keeps the record: the name, the link, which videos and learnings
 * the research drew on. The notebook itself lives in its own tool; AgentOS
 * never reads or drives it. To start one, gather sources here, copy the list
 * into the tool, and paste the notebook's link back. What is learned there
 * comes back through Capture, like any other learning.
 */

const NOTEBOOKLM = "https://notebooklm.google.com/";

export function NotebookLibrary({ notebooks, sources, notes }: { notebooks: Notebook[]; sources: LearningSource[]; notes: LearningNote[] }) {
  const [creating, setCreating] = useState(false);
  const [capturingFor, setCapturingFor] = useState<Notebook>();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-[14px] leading-6 text-paper-char">
          Notebooks are where research happens; AgentOS keeps the link and what you learned. Nothing here reads or automates NotebookLM.
        </p>
        <PaperButton variant="amber" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" /> Create research notebook
        </PaperButton>
      </div>

      {creating ? <ResearchNotebookForm sources={sources} notes={notes} onDone={() => setCreating(false)} /> : null}
      {capturingFor ? (
        <LearningCapture
          context={{ sourceType: "notebook", sourceUrl: capturingFor.externalUrl, sourceTitle: capturingFor.name, workspaceId: capturingFor.workspaceId }}
          onDone={() => setCapturingFor(undefined)}
        />
      ) : null}

      {notebooks.length === 0 && !creating ? (
        <p className="text-[14px] text-paper-sage">No notebooks yet. Gather videos and learnings into one with Create research notebook.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {notebooks.map((notebook) => (
            <NotebookCard key={notebook.id} notebook={notebook} sources={sources} notes={notes} onCapture={() => setCapturingFor(notebook)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotebookCard({ notebook, sources, notes, onCapture }: { notebook: Notebook; sources: LearningSource[]; notes: LearningNote[]; onCapture: () => void }) {
  const update = useUpdateNotebook();
  const remove = useDeleteNotebook();
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const related = relatedNotes(notebook, notes);
  const count = notebook.sourceIds.length + notebook.noteIds.length + notebook.externalSources.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notebookSourceList(notebook, sources, notes));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused: nothing to do but not claim success.
    }
  };

  return (
    <li className="flex flex-col border border-paper-mist bg-paper-white p-5">
      <div className="flex items-start gap-2.5">
        <NotebookText className="mt-1 size-5 shrink-0 text-paper-blue" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="font-paper-display text-[19px] leading-tight font-bold">{notebook.name}</h3>
          <p className="mt-1 text-[13px] text-paper-sage">
            {count} source{count === 1 ? "" : "s"} · {related.length} learning{related.length === 1 ? "" : "s"}
          </p>
        </div>
        <Tag tone={notebook.provider === "notebooklm" ? "blue" : "muted"}>{notebook.provider === "notebooklm" ? "NotebookLM" : "Linked"}</Tag>
      </div>
      {notebook.description ? <p className="mt-3 text-[14px] leading-6 text-paper-char">{notebook.description}</p> : null}

      {related.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[13px]">
          {related.slice(0, 4).map((note) => (
            <li key={note.id} className="truncate text-paper-char">
              · {note.title}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {notebook.externalUrl ? (
          <a href={notebook.externalUrl} target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-8 items-center gap-1.5 bg-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-white uppercase hover:bg-paper-moss", PAPER_FOCUS)}>
            <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" /> Open notebook
          </a>
        ) : (
          <form
            className="flex w-full gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (link.trim()) update.mutate({ id: notebook.id, externalUrl: link.trim() });
            }}
          >
            <input value={link} onChange={(event) => setLink(event.target.value)} type="url" placeholder="Paste the notebook's link" aria-label="Notebook link" className={cn(PAPER_INPUT, "min-h-8 flex-1 text-[13px]")} />
            <PaperButton type="submit" variant="ghost" disabled={!link.trim() || update.isPending}>
              Link
            </PaperButton>
          </form>
        )}
        <PaperButton onClick={() => void copy()} title="Copy the sources to paste into the notebook tool">
          {copied ? <Check className="size-3.5" strokeWidth={2} aria-hidden="true" /> : <Copy className="size-3.5" strokeWidth={2} aria-hidden="true" />} {copied ? "Copied" : "Copy sources"}
        </PaperButton>
        <PaperButton onClick={onCapture}>
          <BookmarkPlus className="size-3.5" strokeWidth={2} aria-hidden="true" /> Capture learning
        </PaperButton>
        <PaperButton variant="quiet" onClick={() => remove.mutate(notebook.id)} disabled={remove.isPending} aria-label={`Remove ${notebook.name}`}>
          <Trash2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
        </PaperButton>
      </div>
      {update.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{update.error.message}</p> : null}
    </li>
  );
}

function ResearchNotebookForm({ sources, notes, onDone }: { sources: LearningSource[]; notes: LearningNote[]; onDone: () => void }) {
  const create = useCreateNotebook();
  const projects = useProjects();
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedNotes, setPickedNotes] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<Array<{ title: string; url: string }>>([]);
  const [created, setCreated] = useState<Notebook>();

  const toggle = (set: Set<string>, id: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  const total = picked.size + pickedNotes.size + documents.filter((entry) => entry.title.trim()).length;
  const live = sources.filter((source) => !source.archived);
  const liveNotes = notes.filter((note) => !note.archived);

  if (created) {
    return (
      <section className="border border-paper-mist bg-paper-white p-5">
        <p className="font-paper-display text-[19px] font-bold">{created.name}</p>
        <p className="mt-1 text-[14px] text-paper-char">
          Sources {created.sourceIds.length + created.noteIds.length + created.externalSources.length}.{" "}
          {created.externalUrl ? "Linked." : "Create the notebook in NotebookLM, add the copied sources, then paste its link on the card."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={created.externalUrl ?? NOTEBOOKLM} target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-8 items-center gap-1.5 bg-paper-blue px-3.5 font-paper-utility text-[13px] font-medium tracking-[0.1em] text-paper-white uppercase hover:bg-paper-moss", PAPER_FOCUS)}>
            <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" /> Open notebook
          </a>
          <PaperButton onClick={() => void navigator.clipboard?.writeText(notebookSourceList(created, sources, notes)).catch(() => undefined)}>
            <Copy className="size-3.5" strokeWidth={2} aria-hidden="true" /> Copy sources
          </PaperButton>
          <PaperButton onClick={onDone}>Done</PaperButton>
        </div>
      </section>
    );
  }

  return (
    <form
      className="space-y-5 border border-paper-mist bg-paper-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || create.isPending) return;
        create.mutate(
          {
            name: name.trim(),
            workspaceId: workspaceId || undefined,
            externalUrl: externalUrl.trim() || undefined,
            sourceIds: [...picked],
            noteIds: [...pickedNotes],
            externalSources: documents.filter((entry) => entry.title.trim()).map((entry) => ({ title: entry.title.trim(), url: entry.url.trim() || undefined })),
          },
          { onSuccess: setCreated },
        );
      }}
    >
      <div className="flex items-start justify-between">
        <h2 className="font-paper-display text-[19px] font-bold">Create research notebook</h2>
        <button type="button" onClick={onDone} aria-label="Close" className="inline-flex size-8 cursor-pointer items-center justify-center hover:bg-paper-linen">
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Agentic OS Memory Research" className={cn(PAPER_INPUT, "min-h-10 w-full")} />
        </label>
        <label className="block">
          <FieldLabel>Workspace</FieldLabel>
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className={cn(PAPER_INPUT, "min-h-10 w-full cursor-pointer")}>
            <option value="">None</option>
            {(projects.data?.projects ?? []).map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-[12.5px] font-medium text-paper-char">Videos ({picked.size})</legend>
        {live.length === 0 ? <p className="text-[13px] text-paper-sage">No saved videos.</p> : null}
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {live.map((source) => (
            <label key={source.id} className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" checked={picked.has(source.id)} onChange={() => toggle(picked, source.id, setPicked)} />
              <span className="truncate">{source.title}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-[12.5px] font-medium text-paper-char">Saved learnings ({pickedNotes.size})</legend>
        {liveNotes.length === 0 ? <p className="text-[13px] text-paper-sage">No learnings yet.</p> : null}
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {liveNotes.map((note) => (
            <label key={note.id} className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" checked={pickedNotes.has(note.id)} onChange={() => toggle(pickedNotes, note.id, setPickedNotes)} />
              <span className="truncate">{note.title}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-[12.5px] font-medium text-paper-char">Documents ({documents.length})</legend>
        <div className="space-y-2">
          {documents.map((entry, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={entry.title}
                onChange={(event) => setDocuments(documents.map((doc, at) => (at === index ? { ...doc, title: event.target.value } : doc)))}
                placeholder="Title"
                aria-label="Document title"
                className={cn(PAPER_INPUT, "min-h-8 flex-1 text-[13px]")}
              />
              <input
                value={entry.url}
                onChange={(event) => setDocuments(documents.map((doc, at) => (at === index ? { ...doc, url: event.target.value } : doc)))}
                placeholder="https:// (optional)"
                type="url"
                aria-label="Document link"
                className={cn(PAPER_INPUT, "min-h-8 flex-1 text-[13px]")}
              />
              <button type="button" aria-label="Remove document" onClick={() => setDocuments(documents.filter((_, at) => at !== index))} className="cursor-pointer px-1 text-paper-sage hover:text-paper-moss">
                <X className="size-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setDocuments([...documents, { title: "", url: "" }])} className="inline-flex cursor-pointer items-center gap-1 text-[13px] text-paper-blue hover:underline">
            <Plus className="size-3.5" /> Add a document
          </button>
        </div>
      </fieldset>

      <label className="block">
        <FieldLabel>Notebook link (optional — add it later if the notebook doesn't exist yet)</FieldLabel>
        <input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} type="url" placeholder="https://notebooklm.google.com/notebook/…" className={cn(PAPER_INPUT, "min-h-10 w-full")} />
      </label>

      {create.error ? <p role="alert" className="text-[13.5px] text-paper-flame-deep">{create.error.message}</p> : null}
      <div className="flex items-center gap-3">
        <PaperButton type="submit" variant="amber" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "Creating…" : `Create research notebook${total ? ` · ${total}` : ""}`}
        </PaperButton>
      </div>
    </form>
  );
}
