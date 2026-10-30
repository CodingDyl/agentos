import { AlertTriangle, Check, CircleDot, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PAPER_FOCUS, PaperButton } from "@/components/paper";
import { useRetryIdea } from "@/lib/agentos/video-ideas";
import { cn } from "@/lib/utils";
import type { VideoIdea } from "@shared/video-ideas-types";
import "./idea-progress.css";
import { elapsed, ideaHeadline, ideaHref, ideaSteps, isIdeaWorking, noteHref, typicalWait, type StepState } from "./idea-model";

/** Re-renders every second while something is running, so the stopwatch moves. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** The idea's overall state as one glyph: working, done, stopped, or waiting on Dylan. */
export function IdeaGlyph({ idea, className }: { idea: VideoIdea; className?: string }) {
  if (isIdeaWorking(idea)) return <Loader2 className={cn("size-4 shrink-0 text-paper-blue motion-safe:animate-spin", className)} strokeWidth={2.25} aria-hidden="true" />;
  if (idea.stage === "failed") return <AlertTriangle className={cn("size-4 shrink-0 text-paper-flame-deep", className)} strokeWidth={2} aria-hidden="true" />;
  if (idea.stage === "needs_transcript" || idea.stage === "awaiting_decision") return <CircleDot className={cn("size-4 shrink-0 text-paper-marigold", className)} strokeWidth={2.25} aria-hidden="true" />;
  return <Check className={cn("size-4 shrink-0 text-paper-green", className)} strokeWidth={2.5} aria-hidden="true" />;
}

function StepMark({ state }: { state: StepState }) {
  const box = "flex size-6 shrink-0 items-center justify-center rounded-full";
  if (state === "done") return <span className={cn(box, "bg-paper-green text-white")}><Check className="size-3.5" strokeWidth={3} aria-hidden="true" /></span>;
  if (state === "active") return <span className={cn(box, "bg-paper-blue/15 text-paper-blue")}><Loader2 className="size-3.5 motion-safe:animate-spin" strokeWidth={2.5} aria-hidden="true" /></span>;
  if (state === "failed") return <span className={cn(box, "bg-paper-flame-deep text-white")}><AlertTriangle className="size-3" strokeWidth={2.5} aria-hidden="true" /></span>;
  if (state === "needs_you") return <span className={cn(box, "bg-paper-marigold/20 text-paper-moss ring-1 ring-paper-marigold")}><CircleDot className="size-3.5" strokeWidth={2.5} aria-hidden="true" /></span>;
  return <span className={cn(box, "border border-paper-ash bg-transparent")} aria-hidden="true" />;
}

const STATE_WORDS: Record<StepState, string> = { done: "done", active: "in progress", waiting: "not started", needs_you: "needs you", failed: "stopped" };

/**
 * Where a video idea has got to: who is working on it, for how long, each
 * step ticked off as it finishes, and the one thing to do next when it is done.
 */
export function IdeaProgress({ idea, showOpen = true, className }: { idea: VideoIdea; showOpen?: boolean; className?: string }) {
  const working = isIdeaWorking(idea);
  const now = useNow(working);
  const retry = useRetryIdea();
  const steps = ideaSteps(idea);
  const wait = typicalWait(idea);
  const since = idea.stageStartedAt ?? idea.updatedAt;
  const done = !working && (idea.stage === "noted" || idea.stage === "built");

  return (
    <section
      aria-label={`Progress: ${idea.title}`}
      className={cn(
        "relative overflow-hidden border px-4 pt-4 pb-4 transition-colors duration-300",
        done ? "border-paper-green/50 bg-paper-green/5" : idea.stage === "failed" ? "border-paper-flame-deep/60 bg-paper-cream" : "border-paper-mist bg-paper-cream",
        className,
      )}
    >
      <div className="flex items-start gap-3" aria-live="polite">
        <IdeaGlyph idea={idea} className="mt-0.5 size-5" />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] leading-6 font-medium text-paper-moss">{ideaHeadline(idea)}</p>
          <p className="text-[12.5px] leading-5 text-paper-sage">
            {working ? (
              <>
                <span className="font-mono tabular-nums text-paper-char">{elapsed(since, now)}</span>
                {wait ? ` · ${wait}` : ""}
              </>
            ) : done ? (
              "Done. You can leave this page; it keeps going without you."
            ) : idea.stage === "awaiting_decision" ? (
              "The assessment is ready to read."
            ) : null}
          </p>
        </div>
      </div>

      <ol className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-0">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2.5 sm:flex-1 sm:flex-col sm:items-start sm:gap-1.5">
            <div className="flex items-center sm:w-full">
              <StepMark state={step.state} />
              {index < steps.length - 1 ? (
                <span className={cn("ml-1.5 hidden h-0.5 flex-1 sm:block", step.state === "done" ? "bg-paper-green" : "bg-paper-mist")} aria-hidden="true" />
              ) : null}
            </div>
            <span className={cn("pr-2 text-[12.5px] leading-4", step.state === "waiting" ? "text-paper-sage" : "font-medium text-paper-moss")}>
              {step.label}
              <span className="sr-only">: {STATE_WORDS[step.state]}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2 empty:hidden">
        {idea.notePath && (done || idea.mode === "assess") ? (
          <Link to={noteHref(idea.notePath)} className={cn("inline-flex min-h-[var(--control-height)] items-center px-3.5 text-[14px] font-medium", done ? "bg-primary text-primary-foreground hover:bg-[var(--color-accent-hover)]" : "border border-paper-ash bg-paper-linen text-paper-moss hover:bg-paper-stone", PAPER_FOCUS)}>
            Open the note
          </Link>
        ) : null}
        {showOpen && (idea.stage === "awaiting_decision" || idea.stage === "needs_transcript" || working || idea.mode === "assess") ? (
          <Link to={ideaHref(idea)} className={cn("inline-flex min-h-[var(--control-height)] items-center px-3.5 text-[14px] font-medium", idea.stage === "awaiting_decision" ? "bg-primary text-primary-foreground hover:bg-[var(--color-accent-hover)]" : "text-paper-sage hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}>
            {idea.stage === "awaiting_decision" ? "Read and decide" : idea.stage === "needs_transcript" ? "Paste a transcript" : "Details"}
          </Link>
        ) : null}
        {idea.stage === "failed" || idea.stage === "needs_transcript" ? (
          <PaperButton variant={idea.stage === "failed" ? "amber" : "ghost"} disabled={retry.isPending} onClick={() => retry.mutate(idea.id)}>
            {retry.isPending ? "Starting…" : idea.stage === "needs_transcript" ? "Try captions again" : "Try again"}
          </PaperButton>
        ) : null}
      </div>
      {retry.error ? <p role="alert" className="mt-2 text-[12.5px] text-paper-flame-deep">{retry.error.message}</p> : null}

      {/* The one moving thing: a thin bar along the bottom while an AI is at work. */}
      {working ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-paper-blue/10" aria-hidden="true">
          <span className="block h-full w-1/3 bg-paper-blue motion-safe:animate-[idea-progress_1.6s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:opacity-40" />
        </span>
      ) : null}
    </section>
  );
}

/** One line: glyph, what is happening, stopwatch. For cards and the tray. */
export function IdeaProgressLine({ idea, className }: { idea: VideoIdea; className?: string }) {
  const working = isIdeaWorking(idea);
  const now = useNow(working);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[12.5px] leading-5", className)}>
      <IdeaGlyph idea={idea} className="size-3.5" />
      <span className={cn("min-w-0 truncate", idea.stage === "failed" ? "text-paper-flame-deep" : "text-paper-char")}>{ideaHeadline(idea)}</span>
      {working ? <span className="shrink-0 font-mono tabular-nums text-paper-sage">{elapsed(idea.stageStartedAt ?? idea.updatedAt, now)}</span> : null}
    </span>
  );
}
