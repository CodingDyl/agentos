import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import type { PageNote, RebuildRun, RebuildStage } from "@shared/website-rebuild-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useDecideStage, useSavePageNotes } from "@/lib/agentos/rebuilds";
import { cn } from "@/lib/utils";

import type { NoteState } from "./concept-viewer";
import { Storyboard } from "./storyboard";
import { comparePages, noteTotal, pagesOf, snapshotsComplete, writtenNotes } from "./storyboard-model";

/**
 * The baseline checkpoint: every page as a full-page snapshot, notes on each,
 * and the two decisions right here: send the notes back, or approve.
 */
export function BaselineReview({ run, stage }: { run: RebuildRun; stage: RebuildStage }) {
  const id = useId();
  const decide = useDecideStage(run.id);
  const saveNotes = useSavePageNotes(run.id);
  const [note, setNote] = useState("");

  const images = useMemo(() => run.artifacts.filter((artifact) => artifact.stage === stage.id && artifact.media === "image"), [run.artifacts, stage.id]);
  const pages = useMemo(() => pagesOf(images.filter((image) => image.revision === stage.revision)), [images, stage.revision]);
  const changes = useMemo(() => comparePages(images, stage.revision), [images, stage.revision]);
  const complete = snapshotsComplete(pages);
  const previouslyNoted = useMemo(() => Object.keys(run.decisions.filter((decision) => decision.stage === stage.id && decision.decision === "changes_requested").at(-1)?.pageNotes ?? {}), [run.decisions, stage.id]);

  // Notes written on this revision survive a refresh: they start from what the server saved.
  const [notes, setNotes] = useState<Record<string, PageNote[]>>(() =>
    Object.fromEntries(run.pageNotes.filter((entry) => entry.stage === stage.id && entry.revision === stage.revision).map((entry) => [entry.route, entry.notes])),
  );
  const [noteState, setNoteState] = useState<Record<string, NoteState | undefined>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const latest = useRef(notes);
  useEffect(() => {
    latest.current = notes;
  }, [notes]);

  const flush = (route: string) => {
    clearTimeout(timers.current[route]);
    delete timers.current[route];
    setNoteState((state) => ({ ...state, [route]: "saving" }));
    saveNotes.mutate(
      { revision: stage.revision, route, notes: writtenNotes({ [route]: latest.current[route] ?? [] })[route] ?? [] },
      { onSuccess: () => setNoteState((state) => ({ ...state, [route]: "saved" })), onError: () => setNoteState((state) => ({ ...state, [route]: "error" })) },
    );
  };
  const changeNotes = (route: string, next: PageNote[]) => {
    latest.current = { ...latest.current, [route]: next };
    setNotes((current) => ({ ...current, [route]: next }));
    setNoteState((state) => ({ ...state, [route]: "idle" }));
    clearTimeout(timers.current[route]);
    timers.current[route] = setTimeout(() => flush(route), 700);
  };
  // Anything still waiting to be saved goes out when the review closes.
  useEffect(
    () => () => {
      for (const route of Object.keys(timers.current)) {
        clearTimeout(timers.current[route]);
        void fetch(`/api/rebuilds/${encodeURIComponent(run.id)}/stages/build/page-notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: stage.revision, route, notes: writtenNotes({ [route]: latest.current[route] ?? [] })[route] ?? [] }),
          keepalive: true,
        }).catch(() => undefined);
      }
    },
    [run.id, stage.revision],
  );

  const written = writtenNotes(notes);
  const noteCount = noteTotal(written);
  const pageCount = Object.keys(written).length;
  const busy = decide.isPending;

  return (
    <div className="mt-4 border-t border-paper-mist pt-4">
      <p className="text-[13px] font-semibold text-paper-moss">Review the baseline, revision {stage.revision}</p>
      <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-paper-sage">
        <MessageSquareText className="size-3.5" aria-hidden="true" />
        {complete
          ? noteCount === 0
            ? `Open a page to leave notes on it. ${pages.length} page${pages.length === 1 ? "" : "s"}, each at desktop and phone width.`
            : `${noteCount} note${noteCount === 1 ? "" : "s"} on ${pageCount} page${pageCount === 1 ? "" : "s"}. Only those pages go back to the worker.`
          : "The snapshots of this baseline are missing or incomplete."}
      </p>

      {complete ? (
        <Storyboard pages={pages} notes={notes} noteState={noteState} onNotesChange={changeNotes} changes={changes} previouslyNoted={previouslyNoted} revision={stage.revision} />
      ) : (
        <p className="mt-3 max-w-[75ch] text-[13px] text-paper-char">
          There is no complete set of snapshots to review, so this baseline cannot be approved yet. Request changes below to build it again with new snapshots.
        </p>
      )}

      <label htmlFor={`${id}-note`} className="mt-3 block">
        <FieldLabel>Anything that applies to the whole site? (optional when pages have notes)</FieldLabel>
        <textarea id={`${id}-note`} className={cn(PAPER_INPUT, "min-h-20 w-full max-w-[75ch]")} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {decide.error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-paper-flame-deep">
          {decide.error.message}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PaperButton variant="amber" disabled={busy || !complete} onClick={() => decide.mutate({ stage: stage.id, revision: stage.revision, decision: "approve", note: note.trim() || undefined })}>
          Approve baseline
        </PaperButton>
        <PaperButton
          disabled={busy || (!note.trim() && noteCount === 0)}
          onClick={() =>
            decide.mutate(
              { stage: stage.id, revision: stage.revision, decision: "request-changes", note: note.trim() || undefined, pageNotes: noteCount > 0 ? written : undefined },
              { onSuccess: () => setNote("") },
            )
          }
        >
          Send changes{noteCount > 0 ? ` (${noteCount} note${noteCount === 1 ? "" : "s"} on ${pageCount} page${pageCount === 1 ? "" : "s"})` : ""}
        </PaperButton>
        {noteCount > 0 ? <span className="text-[12.5px] text-paper-sage">Approving does not send your notes.</span> : null}
      </div>
    </div>
  );
}
