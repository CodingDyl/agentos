import { z } from "zod";
import { RoutePolicyRecordSchema } from "./route-policy-types";
import { WorkerIdSchema } from "./worker-ids";

/**
 * How a job finds a worker.
 *
 * Until now the operator picked. `auto` hands that choice to Hermes — which
 * makes it the first decision in the system a model gets to make about the
 * system itself, so the shape of it matters more than the cleverness of it.
 *
 * Two properties are built into these types rather than left to the
 * implementation:
 *
 * - **A decision is a record, not a hint.** Every routed job keeps what was
 *   chosen, what else was considered, and why. A recommendation nobody can
 *   audit afterwards is not a recommendation, it is a black box.
 * - **What the operator asked for survives the routing.** `requestedWorker`
 *   and the resolved worker are kept apart, so "Hermes chose Grok" and "the
 *   operator chose Grok" never become the same record.
 */

/**
 * What kind of work a job is.
 *
 * Coarse on purpose. These exist to make a routing decision explainable, not
 * to model the whole of software engineering, and a category nobody can tell
 * apart from its neighbour would not help anyone read the decision.
 */
export const WorkerTaskTypeSchema = z.enum([
  "implementation",
  "debugging",
  "refactor",
  "code-review",
  "architecture",
  "research",
  "design-implementation",
  "testing",
]);

export const WorkerTaskComplexitySchema = z.enum(["low", "medium", "high"]);

export const RoutingConfidenceSchema = z.enum(["high", "medium", "low"]);

/** A worker that was considered but not chosen, and why not. */
export const RoutingAlternativeSchema = z.object({
  worker: WorkerIdSchema,
  reason: z.string(),
});

/**
 * One routing decision, kept with the job it routed.
 *
 * `decidedBy` is here because the fallback is not a lesser version of the same
 * thing: a decision Hermes made and a decision AgentOS made from the numbers
 * when Hermes could not be reached should never be mistaken for one another
 * when someone reads the history back.
 */
export const WorkerRoutingDecisionSchema = z.object({
  selectedWorker: WorkerIdSchema,
  confidence: RoutingConfidenceSchema,
  reasons: z.array(z.string()),
  alternatives: z.array(RoutingAlternativeSchema).optional(),
  taskType: WorkerTaskTypeSchema.optional(),
  complexity: WorkerTaskComplexitySchema.optional(),
  /** Who actually chose: Hermes, or AgentOS falling back to the record. */
  decidedBy: z.enum(["hermes", "agentos"]),
  decidedAt: z.string(),
  /** Workers ruled out before Hermes was asked, and what ruled them out. */
  excluded: z.array(RoutingAlternativeSchema).optional(),
  /**
   * The route-policy record: profile, eligibility rejections, fallback plan
   * and any operator override. Optional so earlier jobs still parse.
   */
  policy: RoutePolicyRecordSchema.optional(),
});

/**
 * What a worker's history says about it.
 *
 * Every rate is optional, and deliberately so. A worker with no finished jobs
 * has no success rate — and reporting that as 0% would read as "it fails",
 * which is a different and much worse claim than "nothing is known yet".
 */
export const WorkerPerformanceSchema = z.object({
  worker: WorkerIdSchema,
  /** Finished jobs this is computed from. The weight behind every rate below. */
  jobs: z.number(),
  successRate: z.number().optional(),
  reviewPassRate: z.number().optional(),
  validationPassRate: z.number().optional(),
  avgRevisions: z.number().optional(),
  avgDurationMs: z.number().optional(),
  avgCostUsd: z.number().optional(),
  /** How many reviews the pass rate is drawn from. */
  reviews: z.number(),
});

export const WorkerPerformanceResponseSchema = z.object({
  performance: z.array(WorkerPerformanceSchema),
});

/** What the console asks for when it wants a recommendation. */
export const WorkerRoutingRequestSchema = z.object({
  project: z.string(),
  objective: z.string().min(1),
  repoPath: z.string().optional(),
});

export const WorkerRoutingResponseSchema = z.object({
  decision: WorkerRoutingDecisionSchema,
  /** The candidates the decision was made from, so the screen can show them. */
  candidates: z.array(WorkerPerformanceSchema),
});

export type WorkerTaskType = z.infer<typeof WorkerTaskTypeSchema>;
export type WorkerTaskComplexity = z.infer<typeof WorkerTaskComplexitySchema>;
export type RoutingConfidence = z.infer<typeof RoutingConfidenceSchema>;
export type RoutingAlternative = z.infer<typeof RoutingAlternativeSchema>;
export type WorkerRoutingDecision = z.infer<typeof WorkerRoutingDecisionSchema>;
export type WorkerPerformance = z.infer<typeof WorkerPerformanceSchema>;
export type WorkerPerformanceResponse = z.infer<
  typeof WorkerPerformanceResponseSchema
>;
export type WorkerRoutingRequest = z.infer<typeof WorkerRoutingRequestSchema>;
export type WorkerRoutingResponse = z.infer<typeof WorkerRoutingResponseSchema>;

/** Re-exported so a routing consumer does not need the base module too. */
export {
  WorkerCapabilitySchema,
  WorkerIdSchema,
  type WorkerCapability,
  type WorkerId,
} from "./worker-ids";
