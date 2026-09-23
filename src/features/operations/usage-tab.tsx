import { Link } from "react-router-dom";
import type { JobUsage, OperationsData } from "@shared/usage-types";
import { HairlineCard, SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";
import { Breakdown } from "./figures";
import {
  formatDuration,
  formatTokens,
  measuredCost,
  measuredTokens,
  measurementTone,
  UNKNOWN,
} from "./operations-model";

/**
 * What is using the tokens.
 *
 * The answer to the question the whole ledger was built for, and the reason
 * this is the first tab. "Hermes used 900k tokens" sends nobody anywhere;
 * "Hermes general chat used 312k tokens" sends you to look at what the console
 * is loading. Every row here is an agent *and* an operation for that reason.
 */
export function UsageTab({ data }: { data: OperationsData }) {
  return (
    <div className="space-y-12">
      {data.anomalies.length > 0 ? <Anomalies data={data} /> : null}

      <Breakdown
        rows={data.tokenSources}
        label="What is using my tokens"
        empty="Nothing has been recorded this month yet."
      />

      <Breakdown
        rows={data.operations}
        label="By operation"
        empty="No operations recorded."
      />

      <RecentJobs jobs={data.recentJobs} />
    </div>
  );
}

/**
 * Runs that cost far more than their own history says they should.
 *
 * Found by dividing, not by asking a model — a run compared against this
 * system's own rolling average for the same operation. The sample size is on
 * screen because a judgement built on four runs deserves to be read as one.
 */
function Anomalies({ data }: { data: OperationsData }) {
  return (
    <section>
      <SectionLabel>Unusual usage</SectionLabel>

      <ul className="mt-4 space-y-3">
        {data.anomalies.map((anomaly) => (
          <li key={anomaly.id}>
            <HairlineCard className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-os-warning/30 p-4">
              <div className="min-w-0">
                <p className="text-[15px] leading-6 text-foreground">
                  {anomaly.label}
                </p>
                <p className="os-meta mt-1.5 text-os-subtle">
                  {anomaly.project ? `${anomaly.project} · ` : ""}
                  from {anomaly.sampleSize} similar run
                  {anomaly.sampleSize === 1 ? "" : "s"}
                </p>
              </div>

              <div className="flex shrink-0 items-baseline gap-8">
                <span className="text-right">
                  <span className="block tabular-nums text-[18px] text-os-warning">
                    {formatTokens(anomaly.tokens)}
                  </span>
                  <span className="os-meta mt-1 block text-os-subtle">
                    This run
                  </span>
                </span>
                <span className="text-right">
                  <span className="block tabular-nums text-[18px] text-os-muted">
                    {formatTokens(anomaly.typicalTokens)}
                  </span>
                  <span className="os-meta mt-1 block text-os-subtle">
                    Typical
                  </span>
                </span>
              </div>
            </HairlineCard>
          </li>
        ))}
      </ul>
    </section>
  );
}

const JOB_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4rem_3rem_4.5rem] gap-x-4";

/**
 * Recent jobs, priced.
 *
 * Cost sits beside revisions and the review verdict on purpose. A job's price
 * is only meaningful next to what it bought — a cheap run that needed three
 * attempts and a review is not the cheap option, and this is the table where
 * that becomes obvious.
 */
/** Exported: the agent page shows the same table for one worker. */
export function RecentJobs({ jobs }: { jobs: readonly JobUsage[] }) {
  if (jobs.length === 0) {
    return (
      <section>
        <SectionLabel>Recent jobs</SectionLabel>
        <p className="mt-4 text-[15px] leading-6 text-os-muted">
          No jobs have run this month.
        </p>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel>Recent jobs</SectionLabel>

      <div className="mt-4 min-w-0 overflow-x-auto">
        <div className="min-w-[46rem]">
          <div className={cn(JOB_COLUMNS, "os-meta pb-3 text-os-subtle")}>
            <span>Job</span>
            <span>Agent</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Rev</span>
            <span className="text-right">Duration</span>
          </div>

          <ul className="border-t border-os-border">
            {jobs.map((job) => {
              const tokens = measuredTokens(job.total);
              const cost = measuredCost(job.total);

              return (
                <li
                  key={job.jobId}
                  className={cn(
                    JOB_COLUMNS,
                    "items-baseline border-b border-os-border py-3 text-[14px] leading-5",
                  )}
                >
                  <span className="min-w-0">
                    <Link
                      to={`/workers/jobs/${job.jobId}`}
                      className="os-focus-ring block truncate rounded-md text-foreground transition-colors duration-150 hover:text-os-amber"
                    >
                      {job.taskId ? `${job.taskId} · ` : ""}
                      {job.objective}
                    </Link>
                    <span className="os-meta mt-1 block truncate text-os-subtle">
                      {job.project ?? ""}
                      {job.reviewVerdict
                        ? ` · ${job.reviewVerdict.replace(/_/g, " ")}`
                        : ""}
                    </span>
                  </span>

                  <span className="os-meta truncate text-os-muted">
                    {job.agent ?? UNKNOWN}
                  </span>
                  <span
                    className={cn(
                      "text-right tabular-nums",
                      measurementTone(tokens.measurement),
                    )}
                  >
                    {tokens.text}
                  </span>
                  <span
                    className={cn(
                      "text-right tabular-nums",
                      measurementTone(cost.measurement),
                    )}
                  >
                    {cost.text}
                  </span>
                  <span className="text-right tabular-nums text-os-muted">
                    {job.revisions ?? UNKNOWN}
                  </span>
                  <span className="text-right tabular-nums text-os-subtle">
                    {formatDuration(job.durationMs)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
