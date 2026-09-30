import type {
  WorkerPerformance,
  WorkerRoutingDecision,
  WorkerTaskComplexity,
  WorkerTaskType,
} from "../../shared/worker-routing-types";
import type { WorkerCapability, WorkerId } from "../../shared/worker-types";
import { buildRoutingPacket, requestRouting } from "../hermes/worker-routing";
import { workerPerformance } from "./metrics";
import { listWorkers } from "./registry";
import type { Worker } from "./worker";

/**
 * Choosing a worker.
 *
 * Three things happen here, in an order that is the whole design:
 *
 * 1. **AgentOS rules candidates out.** Health and capability are decided from
 *    the record, before Hermes is asked anything. A model cannot select an
 *    offline worker if an offline worker was never on the list — which is a
 *    stronger guarantee than asking it nicely not to.
 * 2. **Hermes chooses among what is left.** It gets the objective, the
 *    candidates, and their history. Nothing else.
 * 3. **AgentOS can finish the job alone.** If Hermes is unreachable or its
 *    reply cannot be read, a deterministic ranking of the same evidence
 *    produces a decision, marked as AgentOS's own.
 *
 * Step 3 is the one worth defending. It would be simpler to fail, but routing
 * is a convenience laid over a pipeline that already validates and reviews
 * everything: a delegation screen that would not open because the router was
 * down would be trading a real capability for a cosmetic one. What must never
 * happen is a fallback that looks like a considered choice, so it is recorded
 * as `decidedBy: "agentos"` and says so in its reasons.
 */

/** Words that give a job away, and what they give it away as. */
const TASK_SIGNALS: ReadonlyArray<[WorkerTaskType, RegExp]> = [
  ["debugging", /\b(debug|bug|broken|failing|crash|error|investigate|why (is|does|are)|regression|flaky)\b/i],
  ["testing", /\b(test|tests|testing|coverage|spec|specs)\b/i],
  ["code-review", /\b(review|audit|critique)\b/i],
  ["architecture", /\b(architect|architecture|design the system|restructure|rearchitect|migration plan|approach)\b/i],
  ["refactor", /\b(refactor|clean ?up|tidy|simplify|rename|extract|deduplicate|consolidate)\b/i],
  ["research", /\b(research|investigate options|compare|evaluate|spike|explore)\b/i],
  ["design-implementation", /\b(ui|design|layout|component|css|styling|screen|page|responsive|grid|masonry|animation|frontend)\b/i],
  ["implementation", /\b(implement|add|build|create|write|wire up|support)\b/i],
];

/** What each kind of work actually needs a worker to be able to do. */
const REQUIRED_CAPABILITY: Record<WorkerTaskType, WorkerCapability> = {
  implementation: "code",
  debugging: "code",
  refactor: "code",
  testing: "code",
  "design-implementation": "code",
  "code-review": "review",
  architecture: "research",
  research: "research",
};

/**
 * Reading the objective.
 *
 * Deliberately shallow. This exists to give Hermes a starting point and to
 * have an answer at all when Hermes is not there — not to be the classifier.
 * Hermes' own reading, when it returns one, is preferred over this.
 *
 * Order matters: the signals are checked most-specific first, so "investigate
 * why the tests fail" is debugging rather than testing.
 */
export function classifyTask(objective: string): WorkerTaskType {
  for (const [type, pattern] of TASK_SIGNALS) {
    if (pattern.test(objective)) return type;
  }

  // Most delegated work is someone asking for something to be built.
  return "implementation";
}

/**
 * A rough size for the job.
 *
 * Length is a weak signal and is treated as one — this only ever widens or
 * narrows the brief Hermes is given, and never rules a worker out.
 */
export function estimateComplexity(objective: string): WorkerTaskComplexity {
  const words = objective.trim().split(/\s+/).length;

  const broad =
    /\b(refactor|migrate|architecture|redesign|rewrite|across|end.to.end|whole|entire)\b/i.test(
      objective,
    );

  if (broad || words > 60) return "high";
  if (words > 18) return "medium";

  return "low";
}

/** A worker that survived the deterministic filter, with its record. */
export interface RoutingCandidate {
  worker: Worker;
  performance: WorkerPerformance;
}

export interface RoutingContext {
  candidates: RoutingCandidate[];
  excluded: { worker: WorkerId; reason: string }[];
  taskType: WorkerTaskType;
  complexity: WorkerTaskComplexity;
}

/**
 * Who could take this job at all.
 *
 * Health is asked for rather than assumed, and a worker that cannot answer is
 * excluded — the same fail-closed rule the job manager uses before starting
 * anything. Exclusions are kept with their reasons: a screen that silently
 * showed two candidates where there were three would be hiding the most
 * useful thing it knows.
 */
export async function buildRoutingContext(
  objective: string,
): Promise<RoutingContext> {
  const taskType = classifyTask(objective);
  const complexity = estimateComplexity(objective);
  const required = REQUIRED_CAPABILITY[taskType];

  const workers = listWorkers();

  const performance = await workerPerformance(
    workers.map((worker) => worker.id),
  );

  const byId = new Map(performance.map((entry) => [entry.worker, entry]));

  const candidates: RoutingCandidate[] = [];
  const excluded: { worker: WorkerId; reason: string }[] = [];

  for (const worker of workers) {
    // A rehearsal worker has a perfect record by construction — it never
    // fails, never revises, and costs nothing — so on the evidence it beats
    // every real worker. It is excluded here rather than allowed to win.
    if (worker.simulated) {
      excluded.push({
        worker: worker.id,
        reason: "A development worker. It rehearses the pipeline without doing the work.",
      });
      continue;
    }

    if (worker.manualOnly) {
      excluded.push({ worker: worker.id, reason: "Manually triggered. Only runs when picked by hand." });
      continue;
    }

    if (!worker.capabilities.includes(required)) {
      excluded.push({
        worker: worker.id,
        reason: `Cannot do ${required} work, which this job needs.`,
      });
      continue;
    }

    const health = await worker.healthCheck().catch(() => ({
      available: false,
      reason: "The worker could not report its health.",
    }));

    if (!health.available) {
      excluded.push({
        worker: worker.id,
        reason: health.reason ?? "Not available.",
      });
      continue;
    }

    candidates.push({
      worker,
      performance: byId.get(worker.id) ?? {
        worker: worker.id,
        jobs: 0,
        reviews: 0,
      },
    });
  }

  return { candidates, excluded, taskType, complexity };
}

/**
 * How good a worker looks on the record alone.
 *
 * The weights follow the order the router is told to use: reliability first,
 * then how much rework it tends to need, then cost, then speed. Cost is in
 * there, and is deliberately worth less than reliability — a worker that costs
 * forty cents less and needs a second attempt has cost more, not less.
 *
 * An unmeasured worker scores at the neutral prior rather than at zero. That
 * is what allows a newly added worker to be tried at all; scoring it as a
 * total failure would make "never been used" self-perpetuating.
 */
export function scoreCandidate(performance: WorkerPerformance): number {
  const NEUTRAL = 0.5;

  const reliability =
    ((performance.reviewPassRate ?? NEUTRAL) * 2 +
      (performance.validationPassRate ?? NEUTRAL) * 2 +
      (performance.successRate ?? NEUTRAL)) /
    5;

  // Two revisions or more is treated as the floor; beyond that the difference
  // stops being informative.
  const rework =
    performance.avgRevisions === undefined
      ? NEUTRAL
      : Math.max(0, 1 - performance.avgRevisions / 2);

  // Anchored at $2 so that "cheap" means something fixed rather than "cheaper
  // than whoever else happens to be listed today".
  const thrift =
    performance.avgCostUsd === undefined
      ? NEUTRAL
      : Math.max(0, 1 - performance.avgCostUsd / 2);

  const speed =
    performance.avgDurationMs === undefined
      ? NEUTRAL
      : Math.max(0, 1 - performance.avgDurationMs / (20 * 60 * 1000));

  // Evidence is worth something on its own: with everything else equal, the
  // worker that has actually been measured is the safer choice.
  const evidence = Math.min(performance.jobs, 10) / 10;

  return (
    reliability * 0.5 + rework * 0.2 + thrift * 0.15 + speed * 0.05 + evidence * 0.1
  );
}

/** Why the fallback chose this one, in terms an operator can check. */
function fallbackReasons(
  best: WorkerPerformance,
  taskType: WorkerTaskType,
): string[] {
  const reasons = [
    "Hermes could not be reached for a recommendation, so this was chosen from the job history.",
    `Reads as a ${taskType} job.`,
  ];

  if (best.jobs === 0) {
    reasons.push("No finished jobs on record for this worker yet.");
    return reasons;
  }

  if (best.reviewPassRate !== undefined) {
    reasons.push(
      `Review pass rate ${Math.round(best.reviewPassRate * 100)}% over ${best.reviews} reviewed ${best.reviews === 1 ? "job" : "jobs"}.`,
    );
  }

  if (best.avgCostUsd !== undefined) {
    reasons.push(`Average cost $${best.avgCostUsd.toFixed(2)}.`);
  }

  return reasons;
}

/**
 * The deterministic decision.
 *
 * Used when Hermes cannot answer, and never dressed up as more than it is:
 * the confidence is capped at medium, because a ranking of six numbers has not
 * read the objective and should not claim to be sure about it.
 */
export function decideFromRecord(context: RoutingContext): WorkerRoutingDecision {
  const ranked = [...context.candidates].sort(
    (a, b) => scoreCandidate(b.performance) - scoreCandidate(a.performance),
  );

  const [best, ...rest] = ranked;

  return {
    selectedWorker: best.worker.id,
    // Only a worker with a real record earns medium. Otherwise this is a
    // reasonable guess and is labelled as one.
    confidence: best.performance.jobs >= 3 ? "medium" : "low",
    reasons: fallbackReasons(best.performance, context.taskType),
    alternatives: rest.map((candidate) => ({
      worker: candidate.worker.id,
      reason:
        candidate.performance.jobs === 0
          ? "No finished jobs on record yet."
          : `Scored lower on the record (${candidate.performance.jobs} finished ${candidate.performance.jobs === 1 ? "job" : "jobs"}).`,
    })),
    taskType: context.taskType,
    complexity: context.complexity,
    decidedBy: "agentos",
    decidedAt: new Date().toISOString(),
    excluded: context.excluded.length > 0 ? context.excluded : undefined,
  };
}

export interface RoutingResult {
  decision?: WorkerRoutingDecision;
  candidates: WorkerPerformance[];
  /** Why no decision could be made, when none could. */
  error?: string;
}

/**
 * Routes one job.
 *
 * Returns the decision and the evidence behind it. Nothing is started here —
 * routing recommends, and the operator or the job manager acts on it.
 */
export async function routeJob(input: {
  objective: string;
  project: string;
}): Promise<RoutingResult> {
  const context = await buildRoutingContext(input.objective);

  if (context.candidates.length === 0) {
    return {
      candidates: [],
      error:
        context.excluded.length > 0
          ? `No worker can take this job. ${context.excluded
              .map((entry) => `${entry.worker}: ${entry.reason}`)
              .join(" ")}`
          : "There are no workers registered.",
    };
  }

  const candidates = context.candidates.map(
    (candidate) => candidate.performance,
  );

  // Nothing to decide. Asking a model to choose from a list of one would spend
  // a call to be told the only available answer.
  if (context.candidates.length === 1) {
    const only = context.candidates[0];

    return {
      candidates,
      decision: {
        selectedWorker: only.worker.id,
        confidence: "high",
        reasons: [
          `${only.worker.name} is the only worker able to take this job right now.`,
          ...context.excluded.map(
            (entry) => `${entry.worker} was ruled out: ${entry.reason}`,
          ),
        ],
        taskType: context.taskType,
        complexity: context.complexity,
        decidedBy: "agentos",
        decidedAt: new Date().toISOString(),
        excluded: context.excluded.length > 0 ? context.excluded : undefined,
      },
    };
  }

  const packet = buildRoutingPacket({
    objective: input.objective,
    project: input.project,
    taskType: context.taskType,
    complexity: context.complexity,
    candidates: context.candidates.map((candidate) => ({
      performance: candidate.performance,
      capabilities: candidate.worker.capabilities,
    })),
  });

  const chosen = await requestRouting(
    packet,
    context.candidates.map((candidate) => candidate.worker.id),
    input.project,
  );

  if (!chosen) return { candidates, decision: decideFromRecord(context) };

  return {
    candidates,
    decision: {
      ...chosen,
      // The classifier's reading is kept only where Hermes did not give its
      // own, so the record shows one reading rather than two competing ones.
      taskType: chosen.taskType ?? context.taskType,
      complexity: chosen.complexity ?? context.complexity,
      excluded: context.excluded.length > 0 ? context.excluded : undefined,
    },
  };
}
