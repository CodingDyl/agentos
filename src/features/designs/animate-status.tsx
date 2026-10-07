import type { AnimateJob } from "@shared/animate-types";
import { ANIMATE_STAGE_LABEL } from "@shared/animate-types";
import { PaperIndicator, type IndicatorTone } from "@/components/paper";

const STATUS: Record<AnimateJob["status"], { tone: IndicatorTone; label: string }> = {
  queued: { tone: "muted", label: "Queued" },
  running: { tone: "amber", label: "Claude is working" },
  awaiting_review: { tone: "marigold", label: "Waiting for your review" },
  completed: { tone: "green", label: "In Creative" },
  failed: { tone: "flame", label: "Stopped with a problem" },
  cancelled: { tone: "muted", label: "Stopped" },
  interrupted: { tone: "marigold", label: "Interrupted" },
};

/** A Claude Motion video's state as a dot and words, with the stage it is on. */
export function AnimateStatus({ job, className }: { job: AnimateJob; className?: string }) {
  const status = STATUS[job.status];
  const detail = job.status === "completed" ? undefined : ANIMATE_STAGE_LABEL[job.stage];
  return <PaperIndicator tone={status.tone} label={status.label} detail={detail} className={className} />;
}
