import type { ActivityEvent } from "../../shared/agentos-types";
import type { ActiveWorkItem } from "../../shared/mission-control-types";
import type { OperatorRun, OperatorRunStatus } from "../../shared/operator-types";
import type { WorkerJob, WorkerJobStatus } from "../../shared/worker-types";
import { isLive } from "../operator/engine";
import { isRunning } from "../workers/job-manager";

/**
 * What is genuinely executing, right now.
 *
 * The bar is deliberately high. A project that exists is not active work, a job
 * that finished this morning is not either, and a worker that *could* run
 * something is not running something. The whole value of this section is that
 * it is true at the moment it is read; padding it with things that are merely
 * recent would make it another list to distrust.
 */

/** Job states where something is actually executing. */
const RUNNING_STATUSES: readonly WorkerJobStatus[] = [
  "queued",
  "preparing",
  "running",
  "validating",
  "visual_validating",
  "reviewing",
  "integrating",
];

/** What each stage is called on a screen that is not the job's own. */
const STAGE: Partial<Record<WorkerJobStatus, string>> = {
  queued: "Queued",
  preparing: "Preparing an isolated checkout",
  running: "Implementing",
  validating: "Running validation",
  visual_validating: "Photographing the implementation",
  reviewing: "Under review",
  integrating: "Integrating",
};

/**
 * How long a started Hermes run is believed without a reported ending.
 *
 * A run's start is recorded by the adapter; its end is reported by whoever
 * holds the event stream. Close the tab mid-run and no ending is ever written,
 * so an unterminated run is not evidence that anything is still going. Beyond
 * this window it is still shown — it may well be running — but marked as
 * uncertain rather than asserted.
 */
const RUN_CONFIDENCE_MS = 30 * 60 * 1000;

/** Past this, an unterminated run is almost certainly a lost ending. */
const RUN_FORGET_MS = 6 * 60 * 60 * 1000;

const RUN_ENDED = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
]);

function shortTitle(value: string, limit = 90): string {
  const line = value.split("\n")[0].trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/**
 * Worker jobs that are executing.
 *
 * `isRunning` is asked as well as the status, because a status is what was last
 * written to disk and the process registry is what is actually happening. A
 * server restart leaves jobs recorded as `running` that are not; those are
 * reported at their recorded stage rather than claimed as live.
 */
export function activeJobs(jobs: readonly WorkerJob[]): ActiveWorkItem[] {
  return jobs
    .filter((job) => RUNNING_STATUSES.includes(job.status))
    .map((job) => ({
      id: job.id,
      actor: (job.resolvedWorker ?? job.worker).toUpperCase(),
      // `auto` is a request for a worker, not a worker; nothing to point at yet.
      agent: (job.resolvedWorker ?? job.worker) === "auto" ? undefined : (job.resolvedWorker ?? job.worker),
      title: shortTitle(job.objective),
      project: job.project,
      detail: STAGE[job.status],
      startedAt: job.startedAt ?? job.createdAt,
      href: `/workers/jobs/${job.id}`,
      // Recorded as running, but nothing is executing it — the usual cause is
      // a restart, and claiming otherwise would be the one lie this section
      // cannot afford.
      uncertain: !isRunning(job.id),
    }));
}

/**
 * Hermes runs that were started and never reported finishing.
 *
 * Derived from the activity log rather than from a registry, because the log is
 * already the record of runs and Mission Control is not allowed a source of
 * truth of its own. The cost of that choice is honesty about its limits, which
 * `uncertain` carries.
 */
export function activeRuns(
  events: readonly ActivityEvent[],
  now: Date = new Date(),
): ActiveWorkItem[] {
  const ended = new Set<string>();

  for (const event of events) {
    const runId = event.runId;
    if (runId && RUN_ENDED.has(event.type)) ended.add(runId);
  }

  const seen = new Set<string>();
  const items: ActiveWorkItem[] = [];

  for (const event of events) {
    if (event.type !== "run.started") continue;

    const runId = event.runId;
    if (!runId || ended.has(runId) || seen.has(runId)) continue;

    seen.add(runId);

    const age = now.getTime() - Date.parse(event.timestamp);

    // Not merely old — old enough that the ending was almost certainly lost
    // with a closed tab. Showing it would be inventing activity.
    if (!Number.isFinite(age) || age > RUN_FORGET_MS) continue;

    items.push({
      id: runId,
      actor: "HERMES",
      agent: "hermes",
      title: shortTitle(event.description ?? "Hermes run"),
      project: event.project,
      startedAt: event.timestamp,
      href: "/agent",
      uncertain: age > RUN_CONFIDENCE_MS,
    });
  }

  return items;
}

/** Operator states where the run is working, rather than waiting on a person or done. */
const OPERATOR_WORKING: readonly OperatorRunStatus[] = ["planning", "running"];

const OPERATOR_STAGE: Partial<Record<OperatorRunStatus, string>> = {
  planning: "Planning",
  running: "Running its plan",
};

/**
 * Operator runs that are planning or executing.
 *
 * The run file is what was last saved; `isLive` is whether this process is
 * actually working on it. A run saved mid-flight before a restart is reported
 * at its recorded stage and marked uncertain, the same rule as worker jobs.
 */
export function activeOperatorRuns(runs: readonly OperatorRun[]): ActiveWorkItem[] {
  return runs
    .filter((run) => OPERATOR_WORKING.includes(run.status))
    .map((run) => ({
      id: run.id,
      actor: "OPERATOR",
      agent: "operator",
      title: shortTitle(run.objective ?? run.input),
      project: run.workspaceId,
      detail: OPERATOR_STAGE[run.status],
      startedAt: run.approvedAt ?? run.startedAt,
      href: `/operator/runs/${run.id}`,
      uncertain: !isLive(run.id),
    }));
}

/** Everything running, newest first — the thing that just started is the news. */
export function buildActiveWork(
  jobs: readonly WorkerJob[],
  events: readonly ActivityEvent[],
  now: Date = new Date(),
  operatorRuns: readonly OperatorRun[] = [],
): ActiveWorkItem[] {
  return [...activeJobs(jobs), ...activeRuns(events, now), ...activeOperatorRuns(operatorRuns)].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
}
