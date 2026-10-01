import { MessageSquareWarning, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { pageNameForRoute, type FrictionFrequency, type FrictionSeverity } from "@shared/friction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, SegmentedControl } from "@/components/paper";
import { useReportFriction } from "@/lib/agentos/friction";
import { cn } from "@/lib/utils";

/**
 * ⌘K → Report friction.
 *
 * Four fields and a save, so writing down an annoyance costs less than
 * putting up with it. The page it happened on is filled in from where the
 * palette was opened; it is the in-app path only, never a full URL.
 */

const FREQUENCIES: ReadonlyArray<{ value: FrictionFrequency; label: string }> = [
  { value: "once", label: "Once" },
  { value: "sometimes", label: "Sometimes" },
  { value: "often", label: "Often" },
];

const SEVERITIES: ReadonlyArray<{ value: FrictionSeverity; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function ReportFrictionDialog({ route, onClose }: { route: string; onClose: () => void }) {
  const titleId = useId();
  const report = useReportFriction();
  const input = useRef<HTMLTextAreaElement>(null);

  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<FrictionFrequency>("sometimes");
  const [severity, setSeverity] = useState<FrictionSeverity>("medium");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(onClose, 900);
    return () => clearTimeout(timer);
  }, [onClose, saved]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (description.trim().length < 3 || report.isPending) return;
    report.mutate({ description: description.trim(), route, frequency, severity }, { onSuccess: () => setSaved(true) });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#04051a]/55" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        className="relative w-[min(94vw,520px)] bg-paper-white font-paper-ui text-paper-moss shadow-[0_30px_80px_rgb(2_2_16/0.5)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-paper-mist px-6 py-4">
          <div className="flex items-center gap-2.5">
            <MessageSquareWarning className="size-5 text-paper-blue" strokeWidth={1.75} aria-hidden="true" />
            <h2 id={titleId} data-heading="compact" className="font-paper-display text-[22px] leading-none font-extrabold tracking-[-0.015em]">
              Report friction
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={cn("inline-flex size-8 cursor-pointer items-center justify-center hover:bg-paper-linen", PAPER_FOCUS)}>
            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-5 px-6 py-5">
          <label className="block">
            <FieldLabel>What annoyed you?</FieldLabel>
            <textarea
              ref={input}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="I can't edit existing memory."
              className={cn(PAPER_INPUT, "w-full resize-y py-2 text-[15px] leading-6")}
            />
          </label>

          <div>
            <FieldLabel>Page</FieldLabel>
            <p className="text-[14px] text-paper-char">
              {pageNameForRoute(route) ?? "—"} <span className="font-mono text-[12px] text-paper-sage">{route}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-6">
            <div>
              <FieldLabel>Frequency</FieldLabel>
              <SegmentedControl label="Frequency" options={FREQUENCIES} value={frequency} onChange={setFrequency} />
            </div>
            <div>
              <FieldLabel>Severity</FieldLabel>
              <SegmentedControl label="Severity" options={SEVERITIES} value={severity} onChange={setSeverity} />
            </div>
          </div>

          {report.error ? (
            <p role="alert" className="text-[13.5px] text-paper-flame-deep">
              {report.error.message}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-paper-mist px-6 py-4">
          <span className="text-[12.5px] text-paper-sage" role="status">
            {saved ? "Saved. Review it under Operations → Friction." : "⌘↵ to save"}
          </span>
          <PaperButton type="submit" variant="amber" disabled={description.trim().length < 3 || report.isPending || saved}>
            {report.isPending ? "Saving…" : saved ? "Saved" : "Save"}
          </PaperButton>
        </footer>
      </form>
    </div>
  );
}
