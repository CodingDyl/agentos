import { Marked } from "marked";
import { Check, FilePlus2, Folder, FolderPlus, Link2, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { memoryMarkdownExtensions, type WikiLinkToken } from "@shared/memory-markdown";
import { checkFolder, composeNote, normaliseTag, noteFileName } from "@shared/memory-paths";
import { isMemoryType, MEMORY_TYPE_LABELS, MEMORY_TYPES, type MemoryType } from "@shared/memory-types";
import { Markdown, type InlineOverride } from "@/components/os/markdown";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, SegmentedControl } from "@/components/paper";
import { useCreateMemoryNote } from "@/lib/agentos/memory";
import { cn } from "@/lib/utils";

/**
 * Adding a note to the vault, one decision at a time.
 *
 * Where it lives, what it is called, what it says (and what it connects to),
 * then a look at the exact file before it is written. The path is shown the
 * whole way through, computed by the same rules the server writes with, so
 * nothing about where the note lands is a surprise.
 *
 * The server only ever creates — a clash is reported, never overwritten — and
 * the note is indexed before the dialog closes, so it opens straight into the
 * graph.
 */

const lexer = new Marked({ extensions: memoryMarkdownExtensions, gfm: true });

/** In the review, a [[link]] reads as a link — it will be one the moment the note exists. */
const previewLinks: InlineOverride = (token) => {
  if (token.type === "obsidianComment") return null;
  if (token.type !== "wikilink") return undefined;
  const wiki = token as WikiLinkToken;
  return (
    <span className="text-paper-blue underline decoration-paper-blue/40 underline-offset-[0.2em]">
      {wiki.parts.label ?? wiki.parts.target.split("/").pop() ?? wiki.inner}
    </span>
  );
};

const STEPS = [
  { key: "folder", label: "Folder" },
  { key: "name", label: "Name" },
  { key: "write", label: "Write" },
  { key: "review", label: "Review" },
] as const;

type FolderMode = "existing" | "new";

const MODES = [
  { value: "existing" as const, label: "Existing folder" },
  { value: "new" as const, label: "New folder" },
];

export interface NewNoteDialogProps {
  folders: ReadonlyArray<{ folder: string; count: number }>;
  notes: ReadonlyArray<{ id: string; title: string }>;
  tags: ReadonlyArray<{ tag: string; count: number }>;
  defaultFolder?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function NewNoteDialog({ folders, notes, tags: knownTags, defaultFolder = "", onClose, onCreated }: NewNoteDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const create = useCreateMemoryNote();

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const [mode, setMode] = useState<FolderMode>("existing");
  const [existing, setExisting] = useState(defaultFolder);
  const [folderQuery, setFolderQuery] = useState("");
  const [parent, setParent] = useState(defaultFolder);
  const [newName, setNewName] = useState("");

  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [memoryType, setMemoryType] = useState<MemoryType | "">("");
  const [tagDraft, setTagDraft] = useState("");
  const [body, setBody] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const knownFolders = useMemo(() => new Set(folders.map((entry) => entry.folder.toLowerCase())), [folders]);
  const folderPath = mode === "existing" ? existing : [parent, newName.trim()].filter(Boolean).join("/");
  const folderCheck = checkFolder(folderPath);
  const folder = folderCheck.ok ? folderCheck.folder : "";
  const folderIsNew = mode === "new" && folderCheck.ok && !knownFolders.has(folder.toLowerCase());

  const fileName = noteFileName(title);
  const id = fileName ? (folder ? `${folder}/${fileName}` : fileName) : "";
  const duplicate = Boolean(id) && notes.some((note) => note.id.toLowerCase() === id.toLowerCase());

  const stepError: string | undefined =
    step === 0
      ? !folderCheck.ok
        ? folderCheck.reason
        : mode === "new" && !newName.trim()
          ? "Name the new folder."
          : undefined
      : step === 1
        ? !title.trim()
          ? "Give the note a title."
          : !fileName
            ? "That title has no characters a file name can use."
            : duplicate
              ? `There is already a note at ${id}.`
              : undefined
        : undefined;

  const dirty = Boolean(title.trim() || body.trim() || tags.length || links.length || newName.trim());
  const contents = useMemo(
    () => composeNote({ title: title.trim() || "Untitled", body, tags, links, allIds: notes.map((note) => note.id) }),
    [title, body, tags, links, notes],
  );

  const go = (next: number) => {
    setDirection(next > step ? "forward" : "back");
    setStep(next);
  };

  const requestClose = () => {
    if (create.isPending) return;
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else onClose();
  };

  const submit = () => {
    if (stepError) return;
    if (step < STEPS.length - 1) {
      go(step + 1);
      return;
    }
    create.mutate(
      { folder, title: title.trim(), body, tags, links, type: memoryType || undefined },
      { onSuccess: (created) => onCreated(created.id) },
    );
  };

  // Focus: the first field of each step; the previous focus is restored on close.
  useEffect(() => {
    const field = dialog.current?.querySelector<HTMLElement>("[data-autofocus]");
    field?.focus();
  }, [step, mode]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  // Escape backs out; Tab stays inside the dialog; ⌘/Ctrl-Enter moves on.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (confirmDiscard) setConfirmDiscard(false);
      else requestClose();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = [
      ...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, select, [tabindex="0"]'),
    ].filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const addTag = (raw: string) => {
    const tag = normaliseTag(raw);
    if (tag && !tags.includes(tag) && tags.length < 12) setTags([...tags, tag]);
    setTagDraft("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={requestClose} className="memory-backdrop absolute inset-0 cursor-default bg-background/65" />

      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="memory-dialog relative flex max-h-[min(88vh,760px)] w-[min(94vw,680px)] flex-col bg-paper-white font-paper-ui text-paper-moss shadow-[0_30px_80px_rgb(2_2_16/0.5)]"
      >
        {/* Header and progress */}
        <header className="border-b border-paper-mist px-6 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <FilePlus2 className="size-5 text-paper-blue" strokeWidth={1.75} aria-hidden="true" />
              <h2 id={titleId} data-heading="compact" className="font-paper-display text-[24px] leading-none font-extrabold tracking-[-0.015em]">
                New note
              </h2>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className={cn("-mt-1 -mr-2 inline-flex size-9 cursor-pointer items-center justify-center text-paper-sage hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <ol className="mt-5 flex gap-2 sm:grid sm:grid-cols-4" aria-label="Steps">
            {STEPS.map((entry, index) => {
              const done = index < step;
              const current = index === step;
              return (
                <li key={entry.key} className={cn(current ? "min-w-0 flex-1" : "shrink-0", "sm:min-w-0")}>
                  <button
                    type="button"
                    disabled={!done}
                    aria-current={current ? "step" : undefined}
                    onClick={() => go(index)}
                    className={cn(
                      "flex w-full items-center gap-2 pb-3 text-left text-[13px] font-medium transition-colors duration-150",
                      PAPER_FOCUS,
                      done ? "cursor-pointer text-paper-moss hover:text-paper-blue" : current ? "text-paper-blue" : "text-paper-ash",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center text-[12px] tabular-nums transition-colors duration-300",
                        done ? "bg-paper-moss text-paper-white" : current ? "bg-paper-blue text-paper-white" : "border border-paper-mist",
                      )}
                      aria-hidden="true"
                    >
                      {done ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
                    </span>
                    <span className={cn("truncate", !current && "max-sm:sr-only")}>
                      {entry.label}
                      {done ? <span className="sr-only"> (done, go back)</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="-mx-6 h-[3px] bg-paper-linen" aria-hidden="true">
            <div className="memory-progress h-full bg-paper-blue" style={{ transform: `scaleX(${(step + 1) / STEPS.length})` }} />
          </div>
        </header>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div key={step} className="memory-step min-h-0 flex-1 overflow-y-auto px-6 py-6" data-direction={direction}>
            {step === 0 ? (
              <StepFolder
                mode={mode}
                onMode={(value) => setMode(value)}
                folders={folders}
                existing={existing}
                onExisting={setExisting}
                query={folderQuery}
                onQuery={setFolderQuery}
                parent={parent}
                onParent={setParent}
                newName={newName}
                onNewName={setNewName}
                resulting={folderCheck.ok ? folder : undefined}
                folderIsNew={folderIsNew}
              />
            ) : null}

            {step === 1 ? (
              <div className="space-y-6">
                <Field label="Title" hint="The file is named after it, as in Obsidian.">
                  <input
                    data-autofocus
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={140}
                    placeholder="e.g. Pricing experiments"
                    className={cn(PAPER_INPUT, "min-h-12 w-full text-[18px] font-medium")}
                  />
                </Field>
                <Field label="Type" hint="Optional. What kind of memory this is.">
                  <select
                    value={memoryType}
                    onChange={(event) => setMemoryType(isMemoryType(event.target.value) ? event.target.value : "")}
                    className={cn(PAPER_INPUT, "min-h-10 w-full cursor-pointer text-[14px]")}
                  >
                    <option value="">No type</option>
                    {MEMORY_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {MEMORY_TYPE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tags" hint="Optional. Press Enter or comma to add one.">
                  <div className={cn(PAPER_INPUT, "flex min-h-11 w-full flex-wrap items-center gap-1.5 py-1.5 focus-within:outline-2 focus-within:outline-paper-blue")}>
                    {tags.map((tag) => (
                      <Chip key={tag} onRemove={() => setTags(tags.filter((entry) => entry !== tag))} label={`Remove tag ${tag}`}>
                        #{tag}
                      </Chip>
                    ))}
                    <input
                      value={tagDraft}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value.endsWith(",")) addTag(value.slice(0, -1));
                        else setTagDraft(value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && tagDraft.trim()) {
                          event.preventDefault();
                          addTag(tagDraft);
                        } else if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
                          setTags(tags.slice(0, -1));
                        }
                      }}
                      aria-label="Add a tag"
                      placeholder={tags.length ? "" : "research, pricing…"}
                      className="min-w-[8ch] flex-1 bg-transparent text-[14px] outline-none"
                    />
                  </div>
                  {knownTags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] text-paper-sage">In use:</span>
                      {knownTags
                        .filter((entry) => !tags.includes(entry.tag))
                        .slice(0, 10)
                        .map((entry) => (
                          <button
                            key={entry.tag}
                            type="button"
                            onClick={() => addTag(entry.tag)}
                            className={cn("cursor-pointer border border-paper-mist px-1.5 py-px text-[12.5px] text-paper-char hover:border-paper-blue hover:text-paper-blue", PAPER_FOCUS)}
                          >
                            #{entry.tag}
                          </button>
                        ))}
                    </div>
                  ) : null}
                </Field>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-6">
                <Field label="Note" hint="Markdown works, and so do [[links]] — or connect notes below.">
                  <textarea
                    data-autofocus
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={9}
                    placeholder="What do you want to remember?"
                    className={cn(PAPER_INPUT, "min-h-[190px] w-full resize-y py-3 text-[15px] leading-6")}
                  />
                </Field>
                <LinkPicker notes={notes} selected={links} onChange={setLinks} query={linkQuery} onQuery={setLinkQuery} />
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-5">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5 text-[14px]">
                  <dt className="text-paper-sage">Folder</dt>
                  <dd className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-[13px]">{folder ? `${folder}/` : "Vault root"}</span>
                    {folderIsNew ? <span className="bg-paper-marigold px-1.5 text-[12px] font-semibold tracking-[0.06em] text-primary-foreground uppercase">New</span> : null}
                  </dd>
                  <dt className="text-paper-sage">File</dt>
                  <dd className="truncate font-mono text-[13px]">{fileName}</dd>
                  <dt className="text-paper-sage">Tags</dt>
                  <dd>{tags.length ? tags.map((tag) => `#${tag}`).join("  ") : <span className="text-paper-sage">None</span>}</dd>
                  <dt className="text-paper-sage">Links to</dt>
                  <dd>
                    {links.length ? (
                      <ul className="space-y-0.5">
                        {links.map((link) => (
                          <li key={link} className="truncate font-mono text-[13px]">{link}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-paper-sage">Nothing yet — it will be an orphan in the graph.</span>
                    )}
                  </dd>
                </dl>

                <div className="border border-paper-mist">
                  <div className="flex items-center justify-between border-b border-paper-mist bg-paper-linen px-3 py-1.5">
                    <span className="text-[12.5px] font-medium text-paper-char">{showRaw ? "Exactly what will be written" : "Preview"}</span>
                    <SegmentedControl
                      label="Preview format"
                      options={[
                        { value: "preview" as const, label: "Preview" },
                        { value: "markdown" as const, label: "Markdown" },
                      ]}
                      value={showRaw ? "markdown" : "preview"}
                      onChange={(value) => setShowRaw(value === "markdown")}
                    />
                  </div>
                  <div className="max-h-[260px] overflow-y-auto px-4 py-4">
                    {showRaw ? (
                      <pre className="font-mono text-[12.5px] leading-5 whitespace-pre-wrap text-paper-moss">{contents}</pre>
                    ) : (
                      <Markdown content={contents.replace(/^---\n[\s\S]*?\n---\n/, "")} tone="paper" lexer={lexer} inline={previewLinks} className="break-words" />
                    )}
                  </div>
                </div>

                {create.error ? (
                  <p role="alert" className="border border-paper-flame-deep px-3 py-2 text-[13.5px] text-paper-flame-deep">
                    {create.error.message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Footer: where it will land, and the way forward. */}
          <footer className="border-t border-paper-mist px-6 py-4">
            {confirmDiscard ? (
              <div role="alertdialog" aria-label="Discard this note?" className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[14px] font-medium">Discard this note? Nothing has been saved.</p>
                <div className="flex gap-2">
                  <PaperButton variant="ghost" onClick={() => setConfirmDiscard(false)} autoFocus>
                    Keep writing
                  </PaperButton>
                  <PaperButton variant="danger" onClick={onClose}>
                    Discard
                  </PaperButton>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-3 flex min-w-0 items-center gap-2 text-[12.5px]" aria-live="polite">
                  {stepError && (step > 0 || folderPath) ? (
                    <span className="text-paper-flame-deep">{stepError}</span>
                  ) : (
                    <>
                      <span className="shrink-0 text-paper-sage">Saves to</span>
                      <span className="truncate font-mono text-paper-moss">
                        {id || (folder ? `${folder}/…` : "…")}
                      </span>
                    </>
                  )}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <PaperButton variant="quiet" onClick={() => (step === 0 ? requestClose() : go(step - 1))} disabled={create.isPending}>
                    {step === 0 ? "Cancel" : "Back"}
                  </PaperButton>
                  <div className="flex items-center gap-3">
                    <span className="hidden text-[12px] text-paper-sage tabular-nums sm:inline">
                      Step {step + 1} of {STEPS.length}
                    </span>
                    <PaperButton type="submit" variant="amber" disabled={Boolean(stepError) || create.isPending} className="min-w-[132px]">
                      {step < STEPS.length - 1 ? (step === 2 && !body.trim() && !links.length ? "Skip" : "Next") : create.isPending ? "Writing…" : "Create note"}
                    </PaperButton>
                  </div>
                </div>
              </>
            )}
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block">
        <span className="block font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">{label}</span>
        {hint ? <span className="mt-1 block text-[13px] text-paper-sage">{hint}</span> : null}
        <span className="mt-2.5 block">{children}</span>
      </label>
    </div>
  );
}

function Chip({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-paper-stone py-0.5 pr-0.5 pl-2 text-[13px] text-paper-moss">
      {children}
      <button type="button" onClick={onRemove} aria-label={label} className={cn("inline-flex size-5 cursor-pointer items-center justify-center hover:bg-paper-mist", PAPER_FOCUS)}>
        <X className="size-3" strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}

function StepFolder({
  mode,
  onMode,
  folders,
  existing,
  onExisting,
  query,
  onQuery,
  parent,
  onParent,
  newName,
  onNewName,
  resulting,
  folderIsNew,
}: {
  mode: FolderMode;
  onMode: (mode: FolderMode) => void;
  folders: ReadonlyArray<{ folder: string; count: number }>;
  existing: string;
  onExisting: (folder: string) => void;
  query: string;
  onQuery: (query: string) => void;
  parent: string;
  onParent: (folder: string) => void;
  newName: string;
  onNewName: (name: string) => void;
  resulting?: string;
  folderIsNew: boolean;
}) {
  const options = [{ folder: "", count: undefined as number | undefined }, ...folders];
  const needle = query.trim().toLowerCase();
  const visible = needle ? options.filter((entry) => (entry.folder || "vault root").toLowerCase().includes(needle)) : options;

  // The chosen folder starts in view, even deep in a long list.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: "center" });
  }, [mode]);

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = visible.findIndex((entry) => entry.folder === existing);
    const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      onExisting(next.folder);
      event.currentTarget.querySelector<HTMLElement>(`[data-folder="${CSS.escape(next.folder)}"]`)?.focus();
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[14px] leading-6 text-paper-char">Where should the note live? Pick a folder you already use, or start a new one.</p>
      <SegmentedControl label="Folder" options={MODES} value={mode} onChange={onMode} />

      {mode === "existing" ? (
        <div>
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
            <input
              data-autofocus
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Find a folder…"
              aria-label="Find a folder"
              className={cn(PAPER_INPUT, "min-h-10 w-full pl-9 text-[14px]")}
            />
          </label>
          <div ref={list} role="radiogroup" aria-label="Folders" className="mt-2 max-h-[280px] overflow-y-auto border border-paper-mist" onKeyDown={onListKey}>
            {visible.length === 0 ? (
              <p className="px-3 py-3 text-[13.5px] text-paper-sage">No folder matches. Switch to “New folder” to make it.</p>
            ) : (
              visible.map((entry) => {
                const selected = entry.folder === existing;
                const depth = entry.folder ? entry.folder.split("/").length - 1 : 0;
                return (
                  <button
                    key={entry.folder || "(root)"}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    data-folder={entry.folder}
                    onClick={() => onExisting(entry.folder)}
                    style={{ paddingLeft: 12 + (needle ? 0 : depth * 16) }}
                    className={cn(
                      "flex min-h-9 w-full cursor-pointer items-center gap-2 pr-3 text-left text-[14px] transition-colors duration-100",
                      PAPER_FOCUS,
                      "focus-visible:outline-offset-[-2px]",
                      selected ? "bg-paper-blue text-paper-white" : "hover:bg-paper-linen",
                    )}
                  >
                    <Folder className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{entry.folder ? (needle ? entry.folder : entry.folder.split("/").pop()) : "Vault root"}</span>
                    {entry.count !== undefined ? (
                      <span className={cn("text-[12px] tabular-nums", selected ? "text-paper-white" : "text-paper-sage")}>{entry.count}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <Field label="Inside">
            <select value={parent} onChange={(event) => onParent(event.target.value)} className={cn(PAPER_INPUT, "min-h-10 w-full cursor-pointer text-[14px]")}>
              <option value="">Vault root</option>
              {folders.map((entry) => (
                <option key={entry.folder} value={entry.folder}>
                  {entry.folder}/
                </option>
              ))}
            </select>
          </Field>
          <Field label="Folder name">
            <input
              data-autofocus
              value={newName}
              onChange={(event) => onNewName(event.target.value)}
              placeholder="e.g. research"
              maxLength={80}
              className={cn(PAPER_INPUT, "min-h-11 w-full text-[15px]")}
            />
          </Field>
          {resulting && newName.trim() ? (
            <p className="flex items-center gap-2 text-[13.5px] text-paper-char">
              <FolderPlus className="size-4 text-paper-blue" strokeWidth={1.75} aria-hidden="true" />
              <span className="font-mono text-[13px]">{resulting}/</span>
              <span className="text-paper-sage">{folderIsNew ? "will be created with the note" : "already exists — the note goes there"}</span>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function LinkPicker({
  notes,
  selected,
  onChange,
  query,
  onQuery,
}: {
  notes: ReadonlyArray<{ id: string; title: string }>;
  selected: string[];
  onChange: (links: string[]) => void;
  query: string;
  onQuery: (query: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? notes
        .filter((note) => !selected.includes(note.id) && (note.title.toLowerCase().includes(needle) || note.id.toLowerCase().includes(needle)))
        .slice(0, 8)
    : [];

  return (
    <div>
      <span className="flex items-center gap-1.5 font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">
        <Link2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
        Connect to notes
      </span>
      <span className="mt-1 block text-[13px] text-paper-sage">Optional. Each one becomes a [[link]] under “Related”, and a beam in the graph.</span>

      {selected.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <Chip key={id} onRemove={() => onChange(selected.filter((entry) => entry !== id))} label={`Remove link to ${id}`}>
              <span className="font-mono text-[12.5px]">{id.replace(/\.md$/i, "")}</span>
            </Chip>
          ))}
        </div>
      ) : null}

      <label className="relative mt-2.5 block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              onChange([...selected, matches[0].id]);
              onQuery("");
            }
          }}
          placeholder="Find a note to link…"
          aria-label="Find a note to link"
          className={cn(PAPER_INPUT, "min-h-10 w-full pl-9 text-[14px]")}
        />
      </label>
      {matches.length > 0 ? (
        <ul className="mt-1 border border-paper-mist" aria-label="Matching notes">
          {matches.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, note.id]);
                  onQuery("");
                }}
                className={cn("flex w-full cursor-pointer items-baseline gap-3 px-3 py-2 text-left hover:bg-paper-linen", PAPER_FOCUS, "focus-visible:outline-offset-[-2px]")}
              >
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{note.title}</span>
                <span className="truncate font-mono text-[12px] text-paper-sage">{note.id}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : needle ? (
        <p className="mt-2 text-[13px] text-paper-sage">No notes match “{query.trim()}”.</p>
      ) : null}
    </div>
  );
}
