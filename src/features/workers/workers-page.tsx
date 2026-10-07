import { ArrowUpRight, Plus, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { WorkerJob, WorkerSummary } from "@shared/worker-types";
import {
  AppShell,
  EmptyState,
  ErrorState,
  HairlineCard,
  LoadingState,
  PageHeader,
  Section,
  StatusPill,
  SystemIndicator,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { formatRelativeTime } from "@/lib/format";
import { useCancelWorkerJob, useWorkerJobs, useWorkers } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { DelegateJobForm } from "./delegate-job-form";
import { GrokBotPanel } from "./grok-bot-panel";
import { OllamaPanel } from "./ollama-panel";
import { formatDuration, isCancellable, isFinished, jobTitle, statusLabel, statusPill } from "./workers-model";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

/**
 * Who does the work, and what each of them is busy with.
 *
 * Hermes plans and reviews; a worker executes one scoped job; the operator has
 * the final say. Each worker carries its open jobs — running, waiting on
 * review, sent back, approved — so "what is Claude doing?" is answered on the
 * worker itself, and any of them can be cancelled from here. The full history
 * follows below. Reached from Agents in the sidebar footer.
 */
export function WorkersPage() {
  const navigationItems = useNavigationItems();
  const [isDelegating, setIsDelegating] = useState(false);

  const workers = useWorkers();
  const jobs = useWorkerJobs();

  const available = useMemo(
    () => (workers.data?.workers ?? []).filter((worker) => worker.available),
    [workers.data],
  );

  // Open work, by the worker that is actually doing it (routing may have
  // picked it, so the resolved worker wins over the requested one).
  const openByWorker = useMemo(() => {
    const map = new Map<string, WorkerJob[]>();
    for (const job of jobs.data?.jobs ?? []) {
      if (!isCancellable(job.status) && job.status !== "integrating") continue;
      const id = job.resolvedWorker ?? job.worker;
      map.set(id, [...(map.get(id) ?? []), job]);
    }
    return map;
  }, [jobs.data]);

  const busy = [...openByWorker.values()].reduce((sum, list) => sum + list.length, 0);

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="workers"
      activeHref="/workers"
      modelLabel="Model / AgentOS V1"
    >
      <div className={PAGE_PADDING}>
        {workers.isPending ? (
          <LoadingState
            label="Workers"
            message="Checking who is available…"
            detail="Workers / health"
          />
        ) : !workers.data ? (
          <ErrorState
            label="Workers unavailable"
            title="Could not read the worker registry."
            detail={workers.error?.message}
            onRetry={() => void workers.refetch()}
            isRetrying={workers.isFetching}
          />
        ) : (
          <>
            <PageHeader
              title="Workers"
              description="Hermes plans and reviews. A worker executes one scoped job, in isolation, and reports what it did."
              actions={
                <SystemIndicator
                  state={busy > 0 ? "running" : available.length > 0 ? "online" : "idle"}
                  label={busy > 0 ? `${busy} open ${busy === 1 ? "job" : "jobs"}` : `${available.length} available`}
                  detail={`${available.length} of ${workers.data.workers.length} ready`}
                />
              }
            />

            <Section label="Workers" className="mt-10">
              <HairlineCard className="overflow-hidden">
                <ul className="divide-y divide-os-border">
                  {/* Busy workers first: they are the ones worth looking at. */}
                  {[...workers.data.workers]
                    .sort((a, b) => (openByWorker.get(b.id)?.length ?? 0) - (openByWorker.get(a.id)?.length ?? 0))
                    .map((worker) => (
                      <WorkerRow key={worker.id} worker={worker} jobs={openByWorker.get(worker.id) ?? []} />
                    ))}
                </ul>
              </HairlineCard>
            </Section>

            <Section label="Local models (Ollama)" className="mt-12">
              <OllamaPanel />
            </Section>

            <Section label="Grok Bot (SSD workspace)" className="mt-12">
              <GrokBotPanel />
            </Section>

            <Section
              label="Recent jobs"
              className="mt-12 pb-4"
              action={
                available.length > 0 && !isDelegating ? (
                  <button
                    type="button"
                    onClick={() => setIsDelegating(true)}
                    className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-1.5 rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
                  >
                    <Plus className="size-3" aria-hidden="true" />
                    Delegate a job
                  </button>
                ) : null
              }
            >
              {isDelegating ? (
                <DelegateJobForm
                  workers={available}
                  onClose={() => setIsDelegating(false)}
                  className="mb-6"
                />
              ) : null}

              {jobs.isPending ? (
                <EmptyState variant="inline" description="Reading job history…" />
              ) : (jobs.data?.jobs ?? []).length === 0 ? (
                <EmptyState
                  label="No jobs yet"
                  description={
                    available.length > 0
                      ? "Nothing has been delegated. Mock runs the whole pipeline without spending anything."
                      : "No worker is available to delegate to yet."
                  }
                />
              ) : (
                <HairlineCard className="overflow-hidden">
                  <ul className="divide-y divide-os-border">
                    {(jobs.data?.jobs ?? []).map((job) => (
                      <JobRow key={job.id} job={job} />
                    ))}
                  </ul>
                </HairlineCard>
              )}
            </Section>
          </>
        )}
      </div>
    </AppShell>
  );
}

/**
 * A bridge worker's state is about its workspace, not the worker: reachable
 * folders say nothing about whether the thing on the other side is online.
 */
function workerStateLabel(worker: WorkerSummary): string {
  if (worker.transport) {
    if (worker.enabled === false) return "Disabled";
    return worker.available ? "Workspace available" : "Workspace unavailable";
  }
  return worker.available ? "Ready" : "Not available";
}

/** One worker: whether it can be used, and the jobs it is busy with. */
function WorkerRow({ worker, jobs }: { worker: WorkerSummary; jobs: WorkerJob[] }) {
  return (
    <li className="px-5 py-5 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h3 className="text-base leading-6 font-medium">{worker.name}</h3>
        <p className="mt-1.5 text-[13px] leading-5 text-os-muted">{worker.role}</p>
        <p className="os-meta mt-3 text-os-subtle">
          {[...worker.capabilities, ...(worker.manualOnly ? ["Manually triggered"] : []), ...(worker.transport ? [worker.transport] : [])].join(" · ")}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <StatusPill
          status={worker.available ? "healthy" : "paused"}
          label={workerStateLabel(worker)}
        />
        {/* Says why, rather than leaving an unexplained grey dot. */}
        {worker.unavailableReason ? (
          <p className="max-w-64 text-right text-[12px] leading-4 text-os-subtle">
            {worker.unavailableReason}
          </p>
        ) : null}
      </div>
      </div>

      <div className="mt-4 border-t border-os-border pt-4">
        {jobs.length === 0 ? (
          <p className="os-meta text-os-subtle">Idle · no open jobs</p>
        ) : (
          <>
            <p className="os-meta text-os-amber">
              Busy with {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
            </p>
            <ul className="mt-3 space-y-2">
              {jobs.map((job) => (
                <BusyJob key={job.id} job={job} />
              ))}
            </ul>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * A job a worker is holding, with a way to end it.
 *
 * A live run stops on the first click. Finished work asks first, because
 * cancelling it closes something that may never have been reviewed.
 */
function BusyJob({ job }: { job: WorkerJob }) {
  const cancel = useCancelWorkerJob();
  const [confirming, setConfirming] = useState(false);
  const live = !isFinished(job.status);
  const cancellable = isCancellable(job.status);

  return (
    <li className="rounded-md border border-os-border bg-os-surface/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          to={`/workers/jobs/${job.id}`}
          className="os-focus-ring min-w-0 flex-1 cursor-pointer rounded-sm text-[14px] leading-5 text-foreground transition-colors duration-150 hover:text-os-amber"
        >
          <span className="line-clamp-1">{jobTitle(job.objective)}</span>
          <span className="os-meta mt-1 block text-os-subtle">
            {job.project}
            {job.lastEventAt ?? job.startedAt ? ` · last heard ${formatRelativeTime(job.lastEventAt ?? job.startedAt)}` : ""}
          </span>
        </Link>

        <StatusPill
          status={job.stalledSince && live ? "attention" : statusPill(job.status)}
          label={job.stalledSince && live ? "Stalled" : statusLabel(job.status)}
          className="shrink-0"
        />

        {!cancellable ? (
          <span className="os-meta shrink-0 text-os-subtle">Applying…</span>
        ) : confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <span className="os-meta mr-1 text-os-danger">Cancel?</span>
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(job.id, { onSuccess: () => setConfirming(false) })}
              className="os-focus-ring os-meta min-h-8 cursor-pointer rounded-md border border-os-danger/50 px-2.5 text-os-danger transition-colors duration-150 hover:bg-os-danger/10 disabled:opacity-50"
            >
              {cancel.isPending ? "Cancelling…" : "Yes"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="os-focus-ring os-meta min-h-8 cursor-pointer rounded-md px-2.5 text-os-subtle transition-colors duration-150 hover:text-foreground"
            >
              No
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => (live ? cancel.mutate(job.id) : setConfirming(true))}
            aria-label={`Cancel ${jobTitle(job.objective, 80)}`}
            className={cn(
              "os-focus-ring os-meta inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-os-border px-2.5 text-os-muted transition-colors duration-150 hover:border-os-danger/50 hover:text-os-danger disabled:opacity-50",
            )}
          >
            <Square className="size-3" strokeWidth={1.75} aria-hidden="true" />
            {cancel.isPending ? "Stopping…" : "Cancel"}
          </button>
        )}
      </div>
      {cancel.error ? <p className="mt-2 text-[12px] leading-4 text-os-danger">{cancel.error.message}</p> : null}
    </li>
  );
}

function JobRow({ job }: { job: WorkerJob }) {
  const duration = formatDuration(job.startedAt, job.completedAt);

  return (
    <li className="min-w-0">
      <Link
        to={`/workers/jobs/${job.id}`}
        className="group block cursor-pointer px-5 py-5 transition-colors duration-150 outline-none hover:bg-os-surface-raised focus-visible:inset-ring-2 focus-visible:inset-ring-ring/70 md:px-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h3 className="truncate text-base leading-6 font-medium">
              {jobTitle(job.objective)}
            </h3>
            <p className="os-meta mt-2 text-os-subtle">
              {(job.resolvedWorker ?? job.worker).toUpperCase()} · {job.project}
              {duration ? ` · ${duration}` : ""}
              {/* The pulse. A running job says when it was last heard from,
                  so "running" is checkable against a clock rather than taken
                  on trust. */}
              {!isFinished(job.status) && (job.lastEventAt ?? job.startedAt) ? (
                <span className={job.stalledSince ? "text-os-warning" : undefined}>
                  {" · "}last heard {formatRelativeTime(job.lastEventAt ?? job.startedAt)}
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {job.stalledSince && !isFinished(job.status) ? (
              <StatusPill status="attention" label="Stalled" />
            ) : null}
            <StatusPill
              status={statusPill(job.status)}
              label={job.interruptedAt ? "Interrupted" : statusLabel(job.status)}
            />
            <ArrowUpRight
              className="size-4 text-os-subtle transition-colors duration-150 group-hover:text-foreground"
              aria-hidden="true"
            />
          </div>
        </div>

        {job.error ? (
          <p className={`mt-3 max-w-[72ch] truncate font-mono text-[12px] leading-5 ${job.interruptedAt ? "text-os-warning" : "text-os-danger"}`}>
            {job.error}
          </p>
        ) : job.result?.summary ? (
          <p className="mt-3 max-w-[72ch] truncate text-[13px] leading-5 text-os-muted">
            {job.result.summary}
          </p>
        ) : null}
      </Link>
    </li>
  );
}
