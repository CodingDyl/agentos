import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FileText, X } from "lucide-react";
import { HERO_CONCEPTS, type RebuildArtifact } from "@shared/website-rebuild-types";
import { FieldLabel, PAPER_INPUT, PaperButton, SegmentedControl } from "@/components/paper";
import { cn } from "@/lib/utils";

import { conceptLabel } from "./concept-label";

export type NoteState = "idle" | "saving" | "saved" | "error";

export interface ConceptViewerProps {
  concept: string;
  onConceptChange: (concept: string) => void;
  onClose: () => void;
  images: RebuildArtifact[];
  /** The concept's DESIGN.md report, per concept id. */
  designs: Record<string, RebuildArtifact | undefined>;
  /** What each concept was asked to do with the client's brand, when there was one. */
  directions?: Record<string, string>;
  notes: Record<string, string>;
  noteState: Record<string, NoteState | undefined>;
  onNoteChange: (concept: string, note: string) => void;
  /** Present only while the revision is under review. */
  chosen?: string;
  onChoose?: (concept: string) => void;
}

/**
 * One concept up close, inside AgentOS: the hero at desktop and phone width,
 * a link to its DESIGN.md, and a notes field that belongs to this concept only.
 * A native modal dialog, so focus is trapped and Escape closes it.
 */
export function ConceptViewer({ concept, onConceptChange, onClose, images, designs, directions, notes, noteState, onNoteChange, chosen, onChoose }: ConceptViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const desktop = images.find((image) => image.path.includes(`-${concept}-desktop`));
  const mobile = images.find((image) => image.path.includes(`-${concept}-mobile`));
  const design = designs[concept];
  const state = noteState[concept] ?? "idle";

  useEffect(() => {
    const element = dialog.current;
    // No close on cleanup: removing the dialog releases it, and a close here would fire onClose straight away under StrictMode.
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={`${conceptLabel(concept)} hero`}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === dialog.current) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(1120px,calc(100vw-32px))] overflow-y-auto border border-paper-mist bg-paper-white p-0 text-paper-char backdrop:bg-black/60"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-mist px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-paper-display text-[18px] font-bold text-paper-moss">
            {conceptLabel(concept)}
            {directions?.[concept] ? <span className="font-normal text-paper-sage"> · {directions[concept]}</span> : null}
          </h3>
          <SegmentedControl label="Concept" value={concept} onChange={onConceptChange} options={HERO_CONCEPTS.map((id) => ({ value: id, label: `${id.slice(-1).toUpperCase()}${notes[id]?.trim() ? " •" : ""}` }))} />
        </div>
        <button type="button" onClick={onClose} aria-label="Close viewer" className="inline-flex size-9 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-2">
          <p className="text-[12px] text-paper-sage">Desktop</p>
          {desktop ? <img src={desktop.href} alt={`${conceptLabel(concept)} hero at desktop width`} className="w-full border border-paper-mist" /> : <p className="text-[13px] text-paper-sage">No desktop shot.</p>}
        </div>

        <div className="grid content-start gap-4">
          <label className="block">
            <FieldLabel>Notes on {conceptLabel(concept)}</FieldLabel>
            <textarea
              className={cn(PAPER_INPUT, "min-h-28 w-full py-2")}
              value={notes[concept] ?? ""}
              maxLength={2000}
              placeholder="Keep, kill, copy tweaks, what to improve…"
              onChange={(event) => onNoteChange(concept, event.target.value)}
            />
            <span role="status" className={cn("mt-1 block min-h-4 text-[12px]", state === "error" ? "text-paper-flame-deep" : "text-paper-sage")}>
              {state === "saving" ? "Saving…" : state === "saved" ? "Saved with this revision" : state === "error" ? "Could not save. Edit again to retry." : ""}
            </span>
          </label>

          {onChoose ? (
            <PaperButton variant={chosen === concept ? "quiet" : "amber"} onClick={() => onChoose(concept)} aria-pressed={chosen === concept}>
              {chosen === concept ? (
                <>
                  <CheckCircle2 className="size-3.5" aria-hidden="true" /> Chosen to build
                </>
              ) : (
                `Choose ${conceptLabel(concept)}`
              )}
            </PaperButton>
          ) : null}
          {design ? (
            <Link to={design.href} className="inline-flex w-fit items-center gap-1.5 border border-paper-mist px-2.5 py-1 text-[12.5px] text-paper-blue hover:bg-paper-linen">
              <FileText className="size-3.5" aria-hidden="true" /> {design.title}
              <span className="text-paper-sage">r{design.revision}</span>
            </Link>
          ) : null}

          <div className="grid gap-2">
            <p className="text-[12px] text-paper-sage">Phone</p>
            {mobile ? <img src={mobile.href} alt={`${conceptLabel(concept)} hero at phone width`} className="w-[220px] max-w-full border border-paper-mist" /> : <p className="text-[13px] text-paper-sage">No phone shot.</p>}
          </div>

        </div>
      </div>
    </dialog>
  );
}
