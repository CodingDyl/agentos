import type { WorkerPerformance } from "../../shared/worker-routing-types";
import type { WorkerId, WorkerJob } from "../../shared/worker-types";
import { listJobs } from "./job-store";

/**
 * What the job history says about each worker.
 *
 * Routing needs evidence rather than opinion, and this is the only place that
 * evidence is produced. It is read from the job records AgentOS wrote itself —
 * validation AgentOS ran, verdicts Hermes returned, decisions the operator
 * made — so nothing here rests on a worker's own account of how it did.
 *
 * One rule shapes the whole module: **absent is not zero.** A worker with no
 * finished jobs has no success rate, and every rate below is therefore
 * optional. Reporting an unknown as `0` would tell a router that a worker
 * fails every job, which is a far stronger claim than the record supports —
 * and it is exactly the claim that would stop a new worker ever being tried.
 */

/** How far back the record is read. Far more than routing needs. */
const HISTORY_LIMIT = 200;

/**
 * Statuses that mean the run is over and the worker's part is done.
 *
 * `awaiting_review` counts: the worker finished and AgentOS verified the work.
 * What a person decided afterwards is a separate measurement.
 */
const FINISHED = new Set([
  "awaiting_review",
  "reviewing",
  "changes_required",
  "approved",
  "integrating",
  "completed",
  "rejected",
  "failed",
]);

/**
 * Statuses where the worker delivered something that could be verified.
 *
 * `changes_required` and `rejected` are successes by this measure, which reads
 * oddly until you notice what it is measuring: whether the worker produced
 * work at all. Whether the work was any good is `reviewPassRate`, and keeping
 * the two apart is what stops one bad review looking like a crash.
 */
const DELIVERED = new Set([
  "awaiting_review",
  "reviewing",
  "changes_required",
  "approved",
  "integrating",
  "completed",
  "rejected",
]);

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;

  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** A proportion, or nothing when there was nothing to measure. */
function rate(hits: number, total: number): number | undefined {
  return total > 0 ? hits / total : undefined;
}

/**
 * One worker's record.
 *
 * Exported separately from the reader so it can be tested against fixed jobs
 * rather than against whatever happens to be on this machine.
 */
export function summarise(
  worker: WorkerId,
  history: readonly WorkerJob[],
): WorkerPerformance {
  // A cancelled job says something about the operator's afternoon, not about
  // the worker, so it is left out of the record entirely.
  const jobs = history.filter(
    (job) => job.resolvedWorker === worker && FINISHED.has(job.status),
  );

  const reviews = jobs.filter((job) => job.review !== undefined);

  const validated = jobs.filter((job) => (job.result?.tests?.length ?? 0) > 0);

  const durations = jobs.flatMap((job) => {
    if (!job.startedAt || !job.completedAt) return [];

    const elapsed = Date.parse(job.completedAt) - Date.parse(job.startedAt);

    return Number.isFinite(elapsed) && elapsed >= 0 ? [elapsed] : [];
  });

  const costs = jobs.flatMap((job) => {
    const cost = job.result?.providerMetrics?.costUsd;

    return typeof cost === "number" && cost >= 0 ? [cost] : [];
  });

  return {
    worker,
    jobs: jobs.length,
    reviews: reviews.length,

    successRate: rate(
      jobs.filter((job) => DELIVERED.has(job.status)).length,
      jobs.length,
    ),

    reviewPassRate: rate(
      reviews.filter((job) => job.review?.verdict === "pass").length,
      reviews.length,
    ),

    validationPassRate: rate(
      validated.filter((job) =>
        (job.result?.tests ?? []).every((test) => test.success),
      ).length,
      validated.length,
    ),

    // A first attempt is revision 1, so the number worth reporting is how many
    // times the work had to go back — which is one less than that.
    avgRevisions: mean(jobs.map((job) => Math.max((job.revision ?? 1) - 1, 0))),

    avgDurationMs: mean(durations),
    avgCostUsd: mean(costs),
  };
}

/** Every named worker's record, read from the job history. */
export async function workerPerformance(
  workers: readonly WorkerId[],
): Promise<WorkerPerformance[]> {
  const history = await listJobs(HISTORY_LIMIT);

  return workers.map((worker) => summarise(worker, history));
}
