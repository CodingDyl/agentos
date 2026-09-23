import { ArrowUpRight, Plus } from "lucide-react";
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
import { useWorkerJobs, useWorkers } from "@/lib/agentos/queries";
import { DelegateJobForm } from "./delegate-job-form";
import { formatDuration, isFinished, statusLabel, statusPill } from "./workers-model";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

/**
 * Who does the work, and what they have been asked to do.
 *
 * Hermes plans and reviews; a worker executes one scoped job; the operator has
 * the final say. This screen is the middle of that — deliberately small, because
 * the interesting part is the job, not the roster.
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
                  state={available.length > 0 ? "online" : "idle"}
                  label={`${available.length} available`}
                  detail={`${workers.data.workers.length} declared`}
                />
              }
            />

            <Section label="Available" className="mt-10">
              <HairlineCard className="overflow-hidden">
                <ul className="divide-y divide-os-border">
                  {workers.data.workers.map((worker) => (
                    <WorkerRow key={worker.id} worker={worker} />
                  ))}
                </ul>
              </HairlineCard>
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

/** One worker, and whether it can actually be used. */
function WorkerRow({ worker }: { worker: WorkerSummary }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-5 md:px-6">
      <div className="min-w-0">
        <h3 className="text-base leading-6 font-medium">{worker.name}</h3>
        <p className="mt-1.5 text-[13px] leading-5 text-os-muted">{worker.role}</p>
        <p className="os-meta mt-3 text-os-subtle">
          {worker.capabilities.join(" · ")}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <StatusPill
          status={worker.available ? "healthy" : "paused"}
          label={worker.available ? "Ready" : "Not available"}
        />
        {/* Says why, rather than leaving an unexplained grey dot. */}
        {worker.unavailableReason ? (
          <p className="max-w-64 text-right text-[12px] leading-4 text-os-subtle">
            {worker.unavailableReason}
          </p>
        ) : null}
      </div>
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
              {job.objective}
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
