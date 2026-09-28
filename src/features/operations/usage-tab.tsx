import { Link } from "react-router-dom";
import type { JobUsage, OperationsData } from "@shared/usage-types";
import { cn } from "@/lib/utils";
import { Breakdown } from "./figures";
import { formatDuration, formatTokens, measuredCost, measuredTokens, paperTone, UNKNOWN } from "./operations-model";
import { PAPER_FOCUS, PaperCard, PaperSection, Tag } from "@/components/paper";

/**
 * What is using the tokens.
 *
 * The answer to the question the whole ledger was built for, and the reason
 * this is the first tab. "Hermes used 900k tokens" sends nobody anywhere;
 * "Hermes general chat used 312k tokens" sends you to look at what the console
 * is loading. Every row here is an agent *and* an operation for that reason.
 */
export function UsageTab({ data }: { data: OperationsData }) {
  const scope = data.window.label.toLowerCase();

  return (
    <div className="space-y-12">
      {data.anomalies.length > 0 ? <Anomalies data={data} /> : null}

      <Breakdown rows={data.tokenSources} label="What is using my tokens" empty={`Nothing has been recorded ${scope === "today" ? "today" : `in ${scope}`} yet.`} />

      <Breakdown rows={data.operations} label="By operation" empty="No operations recorded." />

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
    <PaperSection label="Unusual usage" count={data.anomalies.length}>
      <ul className="space-y-2">
        {data.anomalies.map((anomaly) => {
          const ratio = anomaly.typicalTokens > 0 ? anomaly.tokens / anomaly.typicalTokens : undefined;

          return (
            <li key={anomaly.id}>
              <PaperCard className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 bg-paper-cream">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Tag tone="flame">{ratio ? `${ratio.toFixed(1)}× typical` : "Unusual"}</Tag>
                    <p className="truncate text-[14.5px] text-paper-moss">{anomaly.label}</p>
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-paper-sage">
                    {anomaly.project ? `${anomaly.project} · ` : ""}compared with {anomaly.sampleSize} similar run{anomaly.sampleSize === 1 ? "" : "s"}
                  </p>
                </div>

                <dl className="flex shrink-0 gap-8 text-right">
                  <div>
                    <dt className="text-[12px] text-paper-sage">This run</dt>
                    <dd className="font-paper-display text-[18px] font-bold text-paper-flame-deep tabular-nums">{formatTokens(anomaly.tokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-paper-sage">Typical</dt>
                    <dd className="font-paper-display text-[18px] font-bold text-paper-char tabular-nums">{formatTokens(anomaly.typicalTokens)}</dd>
                  </div>
                </dl>
              </PaperCard>
            </li>
          );
        })}
      </ul>
    </PaperSection>
  );
}

const JOB_COLUMNS = "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_3rem_4.5rem] gap-x-4";

/**
 * Recent jobs, priced.
 *
 * Cost sits beside revisions and the review verdict on purpose. A job's price
 * is only meaningful next to what it bought — a cheap run that needed three
 * attempts and a review is not the cheap option, and this is the table where
 * that becomes obvious.
 *
 * Exported: the agent page shows the same table for one worker.
 */
export function RecentJobs({ jobs }: { jobs: readonly JobUsage[] }) {
  if (jobs.length === 0) {
    return (
      <PaperSection label="Recent jobs">
        <p className="text-[14px] leading-6 text-paper-sage">No jobs have run in this window.</p>
      </PaperSection>
    );
  }

  return (
    <PaperSection label="Recent jobs" count={jobs.length}>
      <div className="min-w-0 overflow-x-auto rounded-[4px] border border-paper-mist">
        <div className="min-w-[46rem]">
          <div className={cn(JOB_COLUMNS, "border-b border-paper-mist bg-paper-linen px-4 py-2 text-[12px] font-medium text-paper-char")}>
            <span>Job</span>
            <span>Agent</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Rev</span>
            <span className="text-right">Duration</span>
          </div>

          <ul className="divide-y divide-paper-stone">
            {jobs.map((job) => {
              const tokens = measuredTokens(job.total);
              const cost = measuredCost(job.total);

              return (
                <li key={job.jobId} className={cn(JOB_COLUMNS, "items-baseline px-4 py-3 text-[13.5px] leading-5 transition-colors duration-150 hover:bg-paper-cream")}>
                  <span className="min-w-0">
                    <Link
                      to={`/workers/jobs/${job.jobId}`}
                      className={cn(
                        "block truncate rounded-[2px] text-paper-moss underline decoration-paper-mist decoration-[1.5px] underline-offset-[3px] transition-colors duration-150 hover:text-paper-blue hover:decoration-paper-blue",
                        PAPER_FOCUS,
                      )}
                    >
                      {job.taskId ? `${job.taskId} · ` : ""}
                      {job.objective}
                    </Link>
                    <span className="mt-1 block truncate text-[12px] text-paper-sage">
                      {job.project ?? ""}
                      {job.reviewVerdict ? ` · ${job.reviewVerdict.replace(/_/g, " ")}` : ""}
                    </span>
                  </span>

                  <span className="truncate text-paper-char capitalize">{job.agent ?? UNKNOWN}</span>
                  <span className={cn("text-right tabular-nums", paperTone(tokens.measurement))}>{tokens.text}</span>
                  <span className={cn("text-right tabular-nums", paperTone(cost.measurement))}>{cost.text}</span>
                  <span className="text-right text-paper-char tabular-nums">{job.revisions ?? UNKNOWN}</span>
                  <span className="text-right text-paper-sage tabular-nums">{formatDuration(job.durationMs)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </PaperSection>
  );
}
