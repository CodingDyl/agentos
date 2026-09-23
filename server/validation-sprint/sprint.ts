import type {
  FrictionCategory,
  ValidationFriction,
  ValidationScorecard,
  ValidationSprint,
  ValidationTask,
  ValidationTaskView,
  ValidationVerdict,
} from "../../shared/validation-sprint-types";
import type { WorkerJob } from "../../shared/worker-types";
import { listJobs } from "../workers/job-store";
import { listFriction, listTasks } from "./store";

/**
 * Reading the sprint.
 *
 * The join is the whole module: a stored task holds only what a person had to
 * tell us, and every number worth reporting comes off the job it was delegated
 * to. Nothing is written here, and nothing is copied — read it twice and the
 * revisions, cost and durations come from the job record both times.
 *
 * The same rule as the worker performance record governs every figure below:
 * **absent is not zero.** A task with no job has no duration. A worker that
 * cannot report cost has no cost. Filling either with `0` would turn a gap in
 * the evidence into a claim about the system, which is precisely the mistake a
 * validation sprint exists to avoid making.
 */

/** Far more history than a five-task sprint needs. */
const JOB_LIMIT = 200;

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function rate(hits: number, total: number): number | undefined {
  return total > 0 ? hits / total : undefined;
}

/** A span in milliseconds, or nothing when either end is missing or absurd. */
function elapsed(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;

  const span = Date.parse(to) - Date.parse(from);

  return Number.isFinite(span) && span >= 0 ? span : undefined;
}

/**
 * One task, with everything the job knows joined onto it.
 *
 * Note what `humanInterventions` counts: only interventions somebody recorded.
 * An override is visible in `routingOverridden` and is *not* silently added to
 * the count — a number that mixed what was reported with what was inferred
 * would be impossible to read back, and the point of the metric is that it
 * trends downward honestly.
 */
export function joinTask(
  task: ValidationTask,
  job: WorkerJob | undefined,
  friction: readonly ValidationFriction[],
): ValidationTaskView {
  const routed = job?.routing;
  const worker = job?.resolvedWorker;
  const review = job?.review;

  // Which attempt the reviewer looked at. The review carries its own revision
  // where it can, because a job re-read at revision 3 must not make a passing
  // review of revision 1 look like a first-pass success.
  const reviewedRevision = review?.revision ?? job?.revision ?? 1;

  return {
    ...task,

    worker,
    requestedWorker: job?.requestedWorker ?? job?.worker,
    recommendedWorker: routed?.selectedWorker,
    routingOverridden:
      routed && worker ? worker !== routed.selectedWorker : undefined,

    revisions: job?.revision,
    reviewVerdict: review?.verdict,
    firstPassReview: review
      ? review.verdict === "pass" && reviewedRevision === 1
      : undefined,

    // The operator's span, which is the one that includes all the waiting, and
    // the worker's, which is the one that does not. Reporting only the first
    // would blame the worker for the orchestration around it.
    totalDurationMs: elapsed(task.startedAt, task.completedAt),
    workerDurationMs: elapsed(job?.startedAt, job?.completedAt),

    costUsd: job?.result?.providerMetrics?.costUsd,

    humanInterventions: task.interventions.length,

    friction: friction.filter(
      (entry) =>
        entry.taskId === task.taskId ||
        (task.jobId !== undefined && entry.jobId === task.jobId),
    ),
  };
}

/** Counts by key, largest first, with ties broken by name so it is stable. */
function tally<T extends string>(values: readonly T[]): { key: T; count: number }[] {
  const counts = new Map<T, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * The scorecard, from the joined tasks.
 *
 * Exported separately from the reader so it can be tested against fixed tasks
 * rather than against whatever this machine happens to hold.
 */
export function scoreSprint(
  tasks: readonly ValidationTaskView[],
  friction: readonly ValidationFriction[],
): ValidationScorecard {
  const reviewed = tasks.filter((task) => task.firstPassReview !== undefined);
  const revisions = tasks.flatMap((task) =>
    typeof task.revisions === "number" ? [task.revisions] : [],
  );
  const costs = tasks.flatMap((task) =>
    typeof task.costUsd === "number" ? [task.costUsd] : [],
  );

  // Only tasks a router actually decided. A task the operator picked a worker
  // for by hand says nothing about whether AUTO routing works.
  const routed = tasks.filter((task) => task.recommendedWorker !== undefined);

  return {
    tasksAttempted: tasks.length,
    completed: tasks.filter((task) => task.outcome === "completed").length,
    abandoned: tasks.filter((task) => task.outcome === "abandoned").length,
    manualTakeover: tasks.filter((task) => task.outcome === "manual_takeover")
      .length,

    firstPassReviewRate: rate(
      reviewed.filter((task) => task.firstPassReview === true).length,
      reviewed.length,
    ),

    avgRevisions: mean(revisions),

    humanInterventions: tasks.reduce(
      (total, task) => total + task.humanInterventions,
      0,
    ),

    avgCompletionMs: mean(
      tasks.flatMap((task) =>
        typeof task.totalDurationMs === "number" ? [task.totalDurationMs] : [],
      ),
    ),

    avgWorkerMs: mean(
      tasks.flatMap((task) =>
        typeof task.workerDurationMs === "number" ? [task.workerDurationMs] : [],
      ),
    ),

    // A total across two of five tasks is a different fact from a total across
    // all five, so the count travels with the figure rather than beside it.
    totalCostUsd:
      costs.length > 0
        ? costs.reduce((total, cost) => total + cost, 0)
        : undefined,
    tasksWithCost: costs.length,

    routedTasks: routed.length,
    routingFollowed: routed.filter((task) => task.routingOverridden === false)
      .length,

    frictionReports: friction.length,
    frictionByCategory: tally(
      friction.map((entry) => entry.category as FrictionCategory),
    ).map(({ key, count }) => ({ category: key, count })),

    verdicts: tally(
      tasks.flatMap((task) =>
        task.verdict ? [task.verdict as ValidationVerdict] : [],
      ),
    ).map(({ key, count }) => ({ verdict: key, count })),
  };
}

/** The whole sprint, read from the stores that already hold its parts. */
export async function getValidationSprint(): Promise<ValidationSprint> {
  const [tasks, friction, jobs] = await Promise.all([
    listTasks(),
    listFriction(),
    listJobs(JOB_LIMIT),
  ]);

  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  const joined = tasks.map((task) =>
    joinTask(task, task.jobId ? jobsById.get(task.jobId) : undefined, friction),
  );

  return {
    tasks: joined,
    scorecard: scoreSprint(joined, friction),
    friction,
  };
}
