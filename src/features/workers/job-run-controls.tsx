import { Pencil, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkerJob } from "@shared/worker-types";
import { CommandButton } from "@/components/os";
import { useCancelWorkerJob, useRetryWorkerJob, useWorkerJob } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { EditRerunPanel } from "./edit-rerun-panel";
import { isCancellable, isFinished, isRetryable } from "./workers-model";

/**
 * Cancel, retry, and edit-and-rerun, for any job the operator owns.
 *
 * Header density is the job page; compact is lists and task rows.
 */
export function JobRunControls({
  job,
  density = "compact",
  className,
}: {
  job: WorkerJob;
  density?: "header" | "compact";
  className?: string;
}) {
  const cancel = useCancelWorkerJob();
  const retry = useRetryWorkerJob();
  const navigate = useNavigate();
  const finished = isFinished(job.status);
  const cancellable = isCancellable(job.status);
  const retryable = isRetryable(job.status);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [editing, setEditing] = useState(false);

  const startRetry = () =>
    retry.mutate(job.id, {
      onSuccess: ({ job: next }) => void navigate(`/workers/jobs/${next.id}`),
    });

  const compact = density === "compact";

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {cancellable && !confirmingCancel ? (
          compact ? (
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => (finished ? setConfirmingCancel(true) : cancel.mutate(job.id))}
              className="os-focus-ring os-meta inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-os-border px-2.5 text-os-muted transition-colors duration-150 hover:border-os-danger/50 hover:text-os-danger disabled:opacity-50"
            >
              <Square className="size-3" strokeWidth={1.75} aria-hidden="true" />
              {cancel.isPending ? (finished ? "Cancelling…" : "Stopping…") : finished ? "Cancel" : "Stop"}
            </button>
          ) : (
            <CommandButton
              variant="danger"
              icon={Square}
              iconPosition="start"
              onClick={() => (finished ? setConfirmingCancel(true) : cancel.mutate(job.id))}
              loading={cancel.isPending}
              loadingLabel={finished ? "Cancelling" : "Stopping"}
            >
              Cancel job
            </CommandButton>
          )
        ) : null}

        {retryable && !editing ? (
          compact ? (
            <button
              type="button"
              disabled={retry.isPending}
              onClick={startRetry}
              className="os-focus-ring os-meta inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-os-border px-2.5 text-os-muted transition-colors duration-150 hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="size-3" strokeWidth={1.75} aria-hidden="true" />
              {retry.isPending ? "Starting…" : "Retry"}
            </button>
          ) : (
            <CommandButton
              variant={job.interruptedAt ? "primary" : "secondary"}
              icon={RotateCcw}
              iconPosition="start"
              onClick={startRetry}
              loading={retry.isPending}
              loadingLabel="Starting"
            >
              Retry
            </CommandButton>
          )
        ) : null}

        {retryable && !editing ? (
          compact ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="os-focus-ring os-meta inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-os-border px-2.5 text-os-muted transition-colors duration-150 hover:text-foreground"
            >
              <Pencil className="size-3" strokeWidth={1.75} aria-hidden="true" />
              Edit & rerun
            </button>
          ) : (
            <CommandButton variant="secondary" icon={Pencil} iconPosition="start" onClick={() => setEditing(true)}>
              Edit & rerun
            </CommandButton>
          )
        ) : null}
      </div>

      {confirmingCancel && cancellable ? (
        <div className="mt-3 max-w-[72ch] rounded-lg border border-os-danger/40 bg-os-danger/5 p-4" role="alertdialog" aria-label="Cancel this job?">
          <p className="os-meta text-os-danger">Cancel this job?</p>
          <p className="mt-2 text-[14px] leading-6 text-foreground">
            This closes the job and frees its task. The worktree is kept until you discard it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CommandButton
              variant="danger"
              onClick={() => {
                cancel.mutate(job.id, { onSuccess: () => setConfirmingCancel(false) });
              }}
              loading={cancel.isPending}
              loadingLabel="Cancelling"
            >
              Yes, cancel
            </CommandButton>
            <CommandButton variant="quiet" onClick={() => setConfirmingCancel(false)}>
              Keep it
            </CommandButton>
          </div>
        </div>
      ) : null}

      {cancel.error ? (
        <p className="mt-2 text-[12px] leading-4 text-os-danger" role="alert">
          {cancel.error.message}
        </p>
      ) : null}
      {retry.error ? (
        <p className="mt-2 text-[12px] leading-4 text-os-danger" role="alert">
          {retry.error.message}
        </p>
      ) : null}

      {editing ? <EditRerunPanel job={job} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/** Compact controls when the caller only has a job id (task rows, activity). */
export function JobIdControls({ jobId, className }: { jobId: string; className?: string }) {
  const { data } = useWorkerJob(jobId);
  if (!data?.job) return null;
  return <JobRunControls job={data.job} density="compact" className={className} />;
}
