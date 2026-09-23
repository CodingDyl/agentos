import { CircleHelp, Sparkles, SquareCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RoadmapMilestone } from "@shared/agentos-types";
import { CommandButton, ProgressBar, SectionLabel } from "@/components/os";
import { useWorkspaceFeedback } from "@/features/workspace";
import { useCompleteMilestone, useDraftMilestoneReview } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * Closing a milestone, with the facts in front of you.
 *
 * Progress is a count; success is a judgement. This shows both — tasks done,
 * criteria met or still open — and asks. `Keep active` is the default; the
 * primary action completes anyway, because the person reading this has more
 * context than the checkboxes. Hermes can draft the review from what
 * shipped; it is a draft until it is saved here.
 */
export function MilestoneReview({
  slug,
  milestone,
  revision,
  onClose,
  onReload,
}: {
  slug: string;
  milestone: RoadmapMilestone;
  revision: string;
  onClose: () => void;
  onReload: () => void;
}) {
  const [review, setReview] = useState(milestone.review ?? "");
  const complete = useCompleteMilestone(slug);
  const draft = useDraftMilestoneReview(slug);
  const feedback = useWorkspaceFeedback();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const { progress } = milestone;
  const unresolved = milestone.criteria.filter((criterion) => !criterion.done);
  const openTasks = milestone.tasks.filter((task) => task.status !== "done");
  const clean = unresolved.length === 0 && openTasks.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[8vh] pb-8">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-os-background/85" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Milestone review"
        className="relative flex max-h-full w-[min(92vw,40rem)] flex-col overflow-hidden rounded-xl border border-os-border-strong bg-os-surface"
      >
        <header className="flex items-start justify-between gap-4 border-b border-os-border px-5 py-4">
          <div>
            <SectionLabel>Milestone review</SectionLabel>
            <h2 className="mt-2 text-[20px] leading-7 text-foreground">{milestone.title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="os-focus-ring -mr-2 cursor-pointer rounded-md p-2 text-os-subtle hover:text-foreground">
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-5">
          <div className="flex items-center gap-4">
            <ProgressBar percent={progress.percent} label="Tasks complete" tone={progress.percent === 100 ? "success" : "amber"} className="max-w-[20rem]" />
            <span className="os-meta shrink-0 text-os-muted tabular-nums">
              {progress.completed} / {progress.total} tasks
            </span>
          </div>

          {openTasks.length > 0 ? (
            <p className="mt-2 text-[13px] leading-5 text-os-warning">
              {openTasks.length} {openTasks.length === 1 ? "task is" : "tasks are"} still open: {openTasks.map((task) => task.id).join(", ")}.
            </p>
          ) : null}

          <div className="mt-6">
            <SectionLabel>Success criteria</SectionLabel>
            {milestone.criteria.length === 0 ? (
              <p className="mt-3 text-[14px] leading-5 text-os-subtle">No criteria were written for this milestone.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {milestone.criteria.map((criterion, index) => (
                  <li key={index} className="flex items-start gap-3 text-[15px] leading-6">
                    {criterion.done ? (
                      <SquareCheck className="mt-1 size-4 shrink-0 text-os-success" strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                      <CircleHelp className="mt-1 size-4 shrink-0 text-os-warning" strokeWidth={1.5} aria-hidden="true" />
                    )}
                    <span className={criterion.done ? "text-os-muted" : "text-foreground"}>{criterion.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {unresolved.length > 0 ? (
              <p className="mt-3 text-[13px] leading-5 text-os-warning">
                {unresolved.length} {unresolved.length === 1 ? "criterion is" : "criteria are"} still unresolved.
              </p>
            ) : milestone.criteria.length > 0 ? (
              <p className="mt-3 text-[13px] leading-5 text-os-success">All criteria met.</p>
            ) : null}
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-4">
              <SectionLabel>Review</SectionLabel>
              <button
                type="button"
                disabled={draft.isPending}
                onClick={() =>
                  draft.mutate(milestone.id, {
                    onSuccess: (text) => setReview(text),
                  })
                }
                className="os-focus-ring os-meta inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-os-muted transition-colors duration-150 hover:text-foreground disabled:opacity-50"
              >
                <Sparkles className={cn("size-3.5", draft.isPending && "motion-safe:animate-pulse")} strokeWidth={1.5} aria-hidden="true" />
                {draft.isPending ? "Drafting" : "Draft with Hermes"}
              </button>
            </div>
            {draft.error ? <p className="mt-2 text-[13px] leading-5 text-os-warning">{draft.error.message}</p> : null}
            <textarea
              rows={8}
              value={review}
              onChange={(event) => setReview(event.target.value)}
              placeholder={"What shipped\nWhat changed\nWhat remains\nLessons learned"}
              className="os-focus-ring mt-3 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[14px] leading-6 text-foreground placeholder:text-os-subtle"
            />
            <p className="mt-2 text-[13px] leading-5 text-os-subtle">Saved under the milestone in MILESTONES.md. Optional.</p>
          </div>

          {complete.error ? <p className="mt-4 text-[13px] leading-5 text-os-danger">{complete.error.message}</p> : null}

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <CommandButton
              variant={clean ? "primary" : "secondary"}
              loading={complete.isPending}
              loadingLabel="Completing"
              onClick={() =>
                complete.mutate(
                  { id: milestone.id, review: review.trim() || undefined, expectedRevision: revision },
                  {
                    onSuccess: (result) => {
                      feedback.recordEdit(`${milestone.title} completed.`, result.undoId);
                      onClose();
                    },
                    onError: (error) => feedback.reportFailure(error, onReload),
                  },
                )
              }
            >
              {clean ? "Complete milestone" : "Complete anyway"}
            </CommandButton>
            <CommandButton variant={clean ? "quiet" : "primary"} onClick={onClose}>
              Keep active
            </CommandButton>
          </div>
        </div>
      </div>
    </div>
  );
}
