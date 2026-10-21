import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkerJob, WorkerReview } from "@shared/worker-types";
import { CommandButton } from "@/components/os";
import { useRetryWorkerJob } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * Whether a review's findings are for a person, not the worker: it was
 * blocked, or every serious finding needs something the worker cannot do in
 * its checkout. Sending such a review back only repeats the round.
 */
export function needsPerson(review: WorkerReview | undefined): boolean {
  if (!review) return false;
  if (review.verdict === "blocked") return true;
  const serious = review.issues.filter((issue) => issue.severity !== "minor");
  return serious.length > 0 && serious.every((issue) => issue.fixable === false);
}

/**
 * The way out of a review the worker cannot satisfy: change what it is asked
 * to meet, then run it again. The old job is closed once the new one starts.
 */
export function CriteriaRerun({ job }: { job: WorkerJob }) {
  const retry = useRetryWorkerJob();
  const navigate = useNavigate();
  const [text, setText] = useState((job.acceptanceCriteria ?? []).join("\n"));
  const criteria = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocked = (job.review?.issues ?? []).filter((issue) => issue.fixable === false || job.review?.verdict === "blocked");

  return (
    <div className="mt-6 max-w-[72ch] rounded-lg border border-os-warning/40 bg-os-warning/5 p-5">
      <p className="os-meta text-os-warning">Not sent back: this needs you</p>
      <p className="mt-2 text-[14px] leading-6 text-foreground">
        The worker cannot fix {blocked.length === 1 ? "this finding" : "these findings"} in its checkout, so sending the job back would only repeat the round. Change the acceptance criteria to what can be checked here, then re-run it.
      </p>
      {blocked.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] leading-5 text-os-muted">
          {blocked.map((issue) => (
            <li key={issue.title}>{issue.title.replace(/^(still open:\s*)+/i, "")}</li>
          ))}
        </ul>
      ) : null}
      <label className="mt-4 block">
        <span className="os-meta text-os-subtle">Acceptance criteria, one per line</span>
        <textarea
          rows={Math.min(10, Math.max(4, criteria.length + 1))}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={cn("os-focus-ring mt-2 w-full rounded-md border border-os-border bg-os-border/5 px-3 py-2 text-[13.5px] leading-6 text-foreground")}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CommandButton
          variant="primary"
          icon={RotateCcw}
          disabled={criteria.length === 0 || retry.isPending}
          loading={retry.isPending}
          loadingLabel="Starting"
          onClick={() => retry.mutate({ id: job.id, acceptanceCriteria: criteria }, { onSuccess: ({ job: next }) => void navigate(`/workers/jobs/${next.id}`) })}
        >
          Re-run with these criteria
        </CommandButton>
      </div>
      {retry.error ? <p className="mt-2 text-[13px] text-os-danger">{retry.error.message}</p> : null}
    </div>
  );
}
