import { Brain, X } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { formatTimestamp, LEARNING_SOURCE_LABELS, type LearningNote } from "@shared/learning-types";
import { MEMORY_TYPE_LABELS, type MemoryDuplicateMatch } from "@shared/memory-types";
import { PROPOSABLE_MEMORY_TYPES, type ProposableMemoryType } from "@shared/task-closeout-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton } from "@/components/paper";
import { findMemoryDuplicates } from "@/lib/agentos/memory";
import { usePromoteLearningNote } from "@/lib/agentos/learning";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * MEMORY PROPOSAL — a learning, offered as durable memory.
 *
 * Nothing becomes memory without this dialog: the person picks the type and
 * the workspace it belongs to, edits the wording, and saves. Before saving,
 * existing memory in that workspace is checked; a likely repeat is shown and
 * the person chooses to update it, create a new note anyway, or cancel.
 */

type Stage = { kind: "edit" } | { kind: "duplicates"; matches: MemoryDuplicateMatch[] };

export function PromoteDialog({ note, onClose }: { note: LearningNote; onClose: () => void }) {
  const titleId = useId();
  const projects = useProjects();
  const promote = usePromoteLearningNote();

  const [type, setType] = useState<ProposableMemoryType>("pattern");
  const [workspaceId, setWorkspaceId] = useState(note.workspaceId ?? "");
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.content.trim() || note.title);
  const [stage, setStage] = useState<Stage>({ kind: "edit" });
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(onClose, 1400);
    return () => clearTimeout(timer);
  }, [onClose, saved]);

  const valid = workspaceId && title.trim().length >= 3 && body.trim().length > 0;
  const where = `${LEARNING_SOURCE_LABELS[note.sourceType]} learning${note.timestampSeconds !== undefined ? ` · ${formatTimestamp(note.timestampSeconds)}` : ""}`;

  const save = (choice: { action: "create" | "update"; targetId?: string; targetRevision?: string; acknowledgedDuplicates?: boolean }) => {
    setError(undefined);
    promote.mutate(
      { id: note.id, workspaceId, type, title: title.trim(), body: body.trim(), ...choice },
      {
        onSuccess: ({ outcome }) => setSaved(outcome.target ?? "memory"),
        onError: (failure) => setError(failure.message),
      },
    );
  };

  const check = async () => {
    if (!valid || checking) return;
    setChecking(true);
    setError(undefined);
    try {
      const { matches } = await findMemoryDuplicates({ project: workspaceId, title: title.trim(), body: body.trim() });
      if (matches.length > 0) setStage({ kind: "duplicates", matches });
      else save({ action: "create" });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  const busy = checking || promote.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#04051a]/55" />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex max-h-[90vh] w-[min(94vw,560px)] flex-col bg-paper-white font-paper-ui text-paper-moss shadow-[0_30px_80px_rgb(2_2_16/0.5)]">
        <header className="flex items-start justify-between gap-4 border-b border-paper-mist px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Brain className="size-5 text-paper-blue" strokeWidth={1.75} aria-hidden="true" />
            <h2 id={titleId} data-heading="compact" className="font-paper-display text-[22px] leading-none font-extrabold tracking-[-0.015em]">
              Memory proposal
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={cn("inline-flex size-8 cursor-pointer items-center justify-center hover:bg-paper-linen", PAPER_FOCUS)}>
            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {saved ? (
            <p role="status" className="text-[15px] text-paper-moss">
              Saved to memory: <span className="font-mono text-[13px]">{saved}</span>
            </p>
          ) : stage.kind === "edit" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <FieldLabel>Type</FieldLabel>
                  <select value={type} onChange={(event) => setType(event.target.value as ProposableMemoryType)} className={cn(PAPER_INPUT, "min-h-10 w-full cursor-pointer")}>
                    {PROPOSABLE_MEMORY_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {MEMORY_TYPE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>Scope</FieldLabel>
                  <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className={cn(PAPER_INPUT, "min-h-10 w-full cursor-pointer")}>
                    <option value="">Choose a workspace</option>
                    {(projects.data?.projects ?? []).map((project) => (
                      <option key={project.slug} value={project.slug}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <FieldLabel>Title</FieldLabel>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className={cn(PAPER_INPUT, "min-h-10 w-full")} />
              </label>
              <label className="block">
                <FieldLabel>Memory</FieldLabel>
                <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={4000} className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")} />
              </label>
              <div>
                <FieldLabel>Source</FieldLabel>
                <p className="text-[14px] text-paper-char">
                  {where}
                  {note.sourceTitle ? ` — ${note.sourceTitle}` : ""}
                </p>
              </div>
              <p className="text-[12.5px] leading-5 text-paper-sage">
                Memory is what agents are told in future work. Keep it to what is durable — a pattern, a lesson, a rule — not everything the video said.
              </p>
            </>
          ) : (
            <div>
              <p className="font-paper-utility text-[12.5px] font-semibold tracking-[0.1em] text-paper-char uppercase">Possible existing memory</p>
              <ul className="mt-3 space-y-3">
                {stage.matches.map((match) => {
                  // A decision updates a decision; anything else updates a note.
                  const updatable = (type === "decision") === (match.kind === "decision");
                  return (
                    <li key={`${match.kind}:${match.id}`} className="border border-paper-mist p-3">
                      <p className="text-[15px] font-medium">{match.title}</p>
                      <p className="mt-0.5 text-[12.5px] text-paper-sage">
                        {match.kind === "decision" ? "DECISIONS.md" : match.id}
                        {match.createdAt ? ` · added ${new Date(match.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
                        {match.archived ? " · archived" : ""}
                      </p>
                      {match.excerpt ? <p className="mt-1.5 text-[13px] leading-5 text-paper-char">{match.excerpt}</p> : null}
                      {updatable ? (
                        <PaperButton
                          variant="ghost"
                          className="mt-2"
                          disabled={busy}
                          onClick={() => save({ action: "update", targetId: match.id, targetRevision: match.revision })}
                        >
                          Update existing
                        </PaperButton>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {error ? (
            <p role="alert" className="text-[13.5px] text-paper-flame-deep">
              {error}
            </p>
          ) : null}
        </div>

        {!saved ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-paper-mist px-6 py-4">
            {stage.kind === "edit" ? (
              <>
                <PaperButton onClick={onClose}>Dismiss</PaperButton>
                <PaperButton variant="amber" disabled={!valid || busy} onClick={() => void check()}>
                  {busy ? "Checking…" : "Save"}
                </PaperButton>
              </>
            ) : (
              <>
                <PaperButton onClick={() => setStage({ kind: "edit" })} disabled={busy}>
                  Cancel
                </PaperButton>
                <PaperButton variant="amber" disabled={busy} onClick={() => save({ action: "create", acknowledgedDuplicates: true })}>
                  Create new
                </PaperButton>
              </>
            )}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
