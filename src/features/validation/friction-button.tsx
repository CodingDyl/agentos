import { MessageSquareWarning } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FrictionCategory } from "@shared/validation-sprint-types";
import { CommandButton, SectionLabel } from "@/components/os";
import { PaperButton } from "@/components/paper";
import { useReportFriction } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { FRICTION_LABELS, FRICTION_ORDER } from "./validation-model";

export interface FrictionButtonProps {
  /** Where it was reported from — `mission-control`, `worker-job`. */
  surface: string;
  jobId?: string;
  taskId?: string;
  project?: string;
  className?: string;
  /** Drawn for a paper page (Today). Other screens keep the terminal look. */
  paper?: boolean;
}

/** How long the button says it worked before going quiet again. */
const ACKNOWLEDGEMENT_MS = 2_400;

/**
 * Reporting friction.
 *
 * The whole design brief for this control is **two seconds**. It is used in the
 * middle of doing something else, by someone who has just been annoyed, and any
 * version of it that asks for a form first will simply not get used — which
 * would leave the sprint with no record of exactly the problems it exists to
 * find.
 *
 * So choosing a category files the report and closes the panel. The note is
 * above the list rather than after it, because a person who wants to write one
 * is thinking about the words before they are thinking about the category, and
 * a note field underneath would mean picking a category, stopping, and typing
 * into something that had already committed.
 *
 * Nothing is done with what is filed. It is not classified, not summarised,
 * not turned into an issue and not shown to a model. Step 51's discipline is
 * that noticing and fixing are separate activities, and a button that offered
 * to fix the thing would quietly undo the sprint it was built for.
 */
export function FrictionButton({
  surface,
  jobId,
  taskId,
  project,
  className,
  paper = false,
}: FrictionButtonProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const report = useReportFriction();

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const file = (category: FrictionCategory) => {
    report.mutate({ category, note: note.trim() || undefined, jobId, taskId, project, surface });

    setOpen(false);
    setNote("");
    setAcknowledged(true);

    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAcknowledged(false), ACKNOWLEDGEMENT_MS);
  };

  return (
    <>
      {paper ? (
        <PaperButton variant="quiet" onClick={() => setOpen(true)} className={className} aria-haspopup="dialog">
          <MessageSquareWarning className="size-3.5" aria-hidden="true" />
          {acknowledged ? "Recorded" : "Report friction"}
        </PaperButton>
      ) : (
        <CommandButton
          variant="quiet"
          icon={MessageSquareWarning}
          iconPosition="start"
          onClick={() => setOpen(true)}
          className={cn(acknowledged && "text-os-success", className)}
          aria-haspopup="dialog"
        >
          {acknowledged ? "Recorded" : "Report friction"}
        </CommandButton>
      )}

      {open ? (
        <FrictionDialog
          paper={paper}
          note={note}
          onNoteChange={setNote}
          onChoose={file}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

interface FrictionDialogProps {
  paper: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onChoose: (category: FrictionCategory) => void;
  onClose: () => void;
}

/**
 * The category list.
 *
 * Mounted only while open, so each opening starts from the top of the list
 * rather than remembering where the last report left off — a stale selection
 * is how the wrong category gets filed.
 */
function FrictionDialog({
  paper,
  note,
  onNoteChange,
  onChoose,
  onClose,
}: FrictionDialogProps) {
  // Where focus was before this opened, so closing returns the operator to what
  // they were doing rather than to the top of the document.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh] pb-8">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={cn("absolute inset-0 cursor-default", paper ? "bg-paper-moss/40" : "bg-os-background/85")}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report friction"
        className={cn(
          "relative flex max-h-full w-[min(92vw,34rem)] flex-col overflow-hidden border",
          paper ? "rounded-[4px] border-paper-mist bg-paper-white font-paper-ui text-paper-moss" : "rounded-xl border-os-border-strong bg-os-surface",
        )}
      >
        <header className={cn("border-b px-5 py-4", paper ? "border-paper-stone" : "border-os-border")}>
          {paper ? (
            <p className="font-paper-display text-[17px] font-bold">Report friction</p>
          ) : (
            <SectionLabel>Report friction</SectionLabel>
          )}
          <p className={cn("mt-2 text-[13px] leading-5", paper ? "text-paper-char" : "text-os-muted")}>
            Recorded and left alone. Nothing is fixed from here.
          </p>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-5">
          <label className="block">
            {paper ? (
              <span className="text-[12.5px] font-medium text-paper-char">Note (optional)</span>
            ) : (
              <SectionLabel>Note (optional)</SectionLabel>
            )}
            <textarea
              autoFocus
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={2}
              placeholder="What actually happened"
              className={cn(
                "mt-3 w-full resize-y border px-3 py-2.5 text-[15px] leading-6",
                paper
                  ? "rounded-[4px] border-paper-mist bg-paper-white text-paper-moss placeholder:text-paper-ash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue"
                  : "os-focus-ring rounded-md border-os-border bg-transparent text-foreground placeholder:text-os-subtle",
              )}
            />
          </label>

          <div className="mt-6">
            {paper ? (
              <span className="text-[12.5px] font-medium text-paper-char">Choosing one files the report</span>
            ) : (
              <SectionLabel>Choosing one files the report</SectionLabel>
            )}

            <ul className="mt-3 grid gap-1 sm:grid-cols-2">
              {FRICTION_ORDER.map((category) => (
                <li key={category}>
                  <button
                    type="button"
                    onClick={() => onChoose(category)}
                    className={cn(
                      "w-full cursor-pointer border border-transparent px-3 py-2.5 text-left text-[14px] leading-5 transition-colors duration-150",
                      paper
                        ? "rounded-[4px] text-paper-char hover:border-paper-mist hover:bg-paper-linen hover:text-paper-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue"
                        : "os-focus-ring rounded-md text-os-muted hover:border-os-border-strong hover:bg-os-surface-raised hover:text-foreground",
                    )}
                  >
                    {FRICTION_LABELS[category]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
