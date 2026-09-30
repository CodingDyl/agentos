import type { MotionJob } from "@shared/motion-types";
import { PaperIndicator, type IndicatorTone } from "@/components/paper";

const STATUS: Record<MotionJob["status"], { tone: IndicatorTone; label: string }> = {
  queued: { tone: "muted", label: "Queued" },
  running: { tone: "amber", label: "Making the film" },
  completed: { tone: "green", label: "In Creative" },
  failed: { tone: "flame", label: "Stopped with a problem" },
  cancelled: { tone: "muted", label: "Stopped" },
  interrupted: { tone: "marigold", label: "Interrupted" },
};

/** A film's state as a dot and words, with the round it is on while it runs. */
export function MotionStatus({ job, rounds, className }: { job: MotionJob; rounds?: number; className?: string }) {
  const status = STATUS[job.status];
  const detail =
    job.status === "running" && rounds
      ? `round ${rounds}`
      : job.status === "completed" && job.assetIds.length > 1
        ? `${job.assetIds.length} films`
        : undefined;
  return <PaperIndicator tone={status.tone} label={status.label} detail={detail} className={className} />;
}

/** A prompt, verbatim, as Claude receives it. */
export function PromptBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-medium text-paper-char">{label}</p>
      <pre className="max-h-72 overflow-auto border border-paper-mist bg-paper-linen p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-paper-moss">
        {text}
      </pre>
    </div>
  );
}
