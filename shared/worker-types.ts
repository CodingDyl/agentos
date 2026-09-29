import { z } from "zod";
import {
  VisualAcceptanceContextSchema,
  VisualVerificationResultSchema,
} from "./visual-verification-types";
import { WorkerCapabilitySchema, WorkerIdSchema } from "./worker-ids";
import { ExecutionAttemptSchema, RoutingModeSchema, TaskMetadataSchema } from "./route-policy-types";
import { WorkerRoutingDecisionSchema } from "./worker-routing-types";

/**
 * The worker contract.
 *
 * A worker executes one scoped job and reports what it did. It does not decide
 * what matters, what to work on next, or whether the result is good — Hermes
 * plans and reviews, AgentOS holds the state, and the operator has the final
 * say. Everything here is provider-neutral: nothing in this file knows that
 * Grok, Claude, or any other runner exists.
 *
 * Schemas are the source of truth, as with the rest of the wire contract, so
 * the adapter and React can never drift apart on what a job is.
 */

export {
  WorkerCapabilitySchema,
  WorkerIdSchema,
  type WorkerCapability,
  type WorkerId,
} from "./worker-ids";

/**
 * Where a job is in its life.
 *
 * `validating` and `awaiting_review` are separate on purpose. A worker saying
 * it finished is a claim, not a result: AgentOS runs the validation commands
 * itself, and then the job waits for a person. Nothing here ever moves to
 * `completed` because a worker said so.
 */
export const WorkerJobStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "waiting",
  /** AgentOS is running the job's validation commands itself. */
  "validating",
  /**
   * AgentOS is running the implementation and photographing it.
   *
   * Separate from `validating` because it answers a separate question. Passing
   * the build says the code works; this says the screen looks like what was
   * designed, and a job can do one without the other.
   */
  "visual_validating",
  /** Verified, and waiting on review — Hermes' and then the operator's. */
  "awaiting_review",
  /** Hermes is reading the diff. */
  "reviewing",
  /** Review found something. The job goes back to the worker, not forward. */
  "changes_required",
  /** A person approved it. Nothing has been integrated yet. */
  "approved",
  /** Being merged into the source repository. */
  "integrating",
  /** Implemented, validated, reviewed, approved, integrated, and re-validated. */
  "completed",
  /** A person turned it down. The work is kept until they discard it. */
  "rejected",
  "failed",
  "cancelled",
]);

/**
 * A worker as the console sees it.
 *
 * `available` is discovered, never assumed: a worker that has not been
 * configured is listed and said to be unconfigured, rather than hidden.
 */
export const WorkerSummarySchema = z.object({
  id: WorkerIdSchema,
  name: z.string(),
  /** One line on what this worker is for. */
  role: z.string(),
  capabilities: z.array(WorkerCapabilitySchema),
  available: z.boolean(),
  /** Why it cannot be used, when it cannot. Shown verbatim. */
  unavailableReason: z.string().optional(),
});

export const WorkersResponseSchema = z.object({
  workers: z.array(WorkerSummarySchema),
});

export const WorkerHealthSchema = z.object({
  id: WorkerIdSchema,
  available: z.boolean(),
  reason: z.string().optional(),
});

/**
 * The handoff contract.
 *
 * This is everything a worker is given, and deliberately no more: an objective,
 * the few files that bear on it, what it may not do, and how the work will be
 * judged. A worker never receives the whole vault.
 */
export const WorkerJobRequestSchema = z.object({
  /** `auto` asks Hermes to choose. Resolved before anything is started. */
  worker: z.union([WorkerIdSchema, z.literal("auto")]),
  project: z.string(),
  objective: z.string().min(1),
  /** Absolute path to the repository the work happens in. */
  repoPath: z.string().optional(),
  /** Commit-ish the isolated copy branches from. Defaults to the checkout. */
  baseRef: z.string().optional(),
  contextFiles: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  validationCommands: z.array(z.string()).optional(),
  /**
   * What the operator asked for, kept apart from what ran.
   *
   * Without this, a job routed to Grok and a job an operator chose Grok for
   * are the same record — and the difference is the whole point of routing.
   * It is also what makes an override legible: `auto` here, beside a routing
   * decision naming someone else, is a person disagreeing with Hermes.
   */
  requestedWorker: z.union([WorkerIdSchema, z.literal("auto")]).optional(),
  /**
   * What this work is supposed to look like, when looking matters.
   *
   * Attached when the job is created rather than reconstructed afterwards: by
   * the time an implementation exists, the brief that motivated it and the
   * references it was drawn from are two lookups and a guess away. Absent, or
   * present with `enabled: false`, and the job never sees a browser.
   */
  visualAcceptance: VisualAcceptanceContextSchema.optional(),
  /**
   * The decision behind this worker, when something other than the operator
   * chose it. Sent back by the console so the recommendation it showed is the
   * one recorded, rather than a second one made after the fact.
   */
  routing: WorkerRoutingDecisionSchema.optional(),
  /**
   * How the route policy should treat this job. Absent means the legacy
   * behaviour: an explicit worker runs as asked, and `auto` asks Hermes.
   */
  routingMode: RoutingModeSchema.optional(),
  /** With `manual`, the execution option (e.g. `ollama:qwen3:4b`) chosen by hand. */
  manualOptionId: z.string().optional(),
  /** Explicit task metadata for the profiler: local-only, budget, category, … */
  routingHints: TaskMetadataSchema.optional(),
  /**
   * Material the objective works on, supplied inline (notes, a snippet).
   * Text-only workers receive this in place of a repository context packet.
   */
  inputText: z.string().optional(),
  /**
   * What the deliverable must look like. `json` output is parsed, and checked
   * against `schema` (JSON Schema) when one is given, before a result counts.
   */
  expectedOutput: z
    .object({
      format: z.enum(["text", "json"]),
      schema: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export const WorkerValidationSchema = z.object({
  command: z.string(),
  success: z.boolean(),
  /** What the command actually said, when it has something worth saying. */
  detail: z.string().optional(),
});

/**
 * What an independent review concluded.
 *
 * `blocked` is not a worse `changes_required`: it means the review could not
 * responsibly reach a verdict — the diff was unreadable, the reply could not be
 * parsed, something is wrong beyond the implementation. It never converts into
 * a pass, which is the property that makes an unreliable reviewer safe to have.
 */
export const WorkerReviewVerdictSchema = z.enum([
  "pass",
  "changes_required",
  "blocked",
]);

export const WorkerReviewIssueSchema = z.object({
  severity: z.enum(["critical", "major", "minor"]),
  title: z.string(),
  detail: z.string(),
  /** Where it is, when the reviewer could say. */
  file: z.string().optional(),
  /** The acceptance criterion it bears on, when it bears on one. */
  criterion: z.string().optional(),
});

export const WorkerReviewCriterionSchema = z.object({
  criterion: z.string(),
  satisfied: z.boolean(),
  note: z.string().optional(),
});

export const WorkerReviewSchema = z.object({
  jobId: z.string(),
  verdict: WorkerReviewVerdictSchema,
  summary: z.string(),
  issues: z.array(WorkerReviewIssueSchema),
  acceptanceCriteria: z.array(WorkerReviewCriterionSchema),
  reviewedAt: z.string(),
  /** Which revision of the work was reviewed. */
  revision: z.number().optional(),
  /**
   * The reviewer's reply as it arrived.
   *
   * Kept because a structured summary is a reading of the review, and when the
   * reading is wrong the original is the only way to find out.
   */
  raw: z.string().optional(),
});

/** One file in a reviewable diff. */
export const WorkerDiffFileSchema = z.object({
  path: z.string(),
  /** Added, Modified, Deleted, Renamed — git's own letter. */
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  /** The unified diff for this file. Absent when it is too large to show. */
  patch: z.string().optional(),
});

export const WorkerDiffSchema = z.object({
  jobId: z.string(),
  baseCommit: z.string().optional(),
  files: z.array(WorkerDiffFileSchema),
  /** Said out loud when the diff was too big to render in full. */
  truncated: z.boolean(),
});

/**
 * What one run cost, as the runner counted it.
 *
 * Provider-neutral on purpose: a worker that can report what it spent fills
 * this in, and one that cannot simply leaves it out. Nothing depends on it
 * being there — it is evidence for the operator, and later for routing, not a
 * number any decision is currently made on.
 *
 * The figures are the runner's own estimates, not a bill.
 */
export const WorkerProviderMetricsSchema = z.object({
  costUsd: z.number().optional(),
  turns: z.number().optional(),
  /**
   * Tokens, for runners that count them but do not price them.
   *
   * Kept apart from `costUsd` rather than converted into it. A runner that
   * reports tokens and no dollars leaves the cost unknown, and unknown is the
   * honest answer — multiplying by a rate table this codebase would have to
   * guess at, and then keep current, would produce a number that looks like
   * evidence and is not.
   */
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  /** Context served from cache. Still context, but usually priced far lower. */
  cachedTokens: z.number().optional(),
  /** Thinking tokens, for models that bill them apart from output. */
  reasoningTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  /** Who billed it, and what ran — for the usage ledger's model breakdown. */
  provider: z.string().optional(),
  model: z.string().optional(),
  /**
   * How much to trust the token figures above.
   *
   * The reason this is on the worker contract rather than inferred downstream:
   * only the adapter that spoke to the provider knows whether a number was
   * reported or derived, and by the time a job record reaches the ledger that
   * knowledge is gone. `unknown` is the default, so a worker that says nothing
   * is never read as having measured nothing.
   */
  measurement: z.enum(["exact", "estimated", "unknown"]).optional(),
  /** The runner's session, for finding this run in its own logs. */
  sessionId: z.string().optional(),
  /** The ceiling the run was given, so a cost can be read against something. */
  budgetUsd: z.number().optional(),
  /** Exact model digest, for runners that report one (Ollama). */
  modelDigest: z.string().optional(),
  location: z.enum(["local", "cloud"]).optional(),
  /** Time spent waiting for a concurrency slot before the run began. */
  queueMs: z.number().optional(),
  /** Time the provider spent loading the model. High on a cold start. */
  loadMs: z.number().optional(),
  /** Provider-reported total for the successful generation. */
  totalMs: z.number().optional(),
  /** Generation attempts made, including a structured-output repair. */
  attempts: z.number().optional(),
});

/**
 * A document a worker says it produced. A claim: AgentOS checks the file
 * exists, is Markdown, and sits inside the worktree before it registers it.
 */
export const WorkerArtifactSchema = z.object({
  title: z.string(),
  /** Worktree-relative, as the worker named it. */
  path: z.string(),
  type: z.string().optional(),
  /** True when AgentOS found it rather than the worker declaring it. */
  detected: z.boolean().optional(),
  /** Where it was registered, once it was. Vault-relative. */
  registeredPath: z.string().optional(),
});

export const WorkerJobResultSchema = z.object({
  summary: z.string(),
  changedFiles: z.array(z.string()).optional(),
  artifacts: z.array(WorkerArtifactSchema).optional(),
  tests: z.array(WorkerValidationSchema).optional(),
  /** What stopped the worker finishing the job properly. */
  blockers: z.array(z.string()).optional(),
  worktreePath: z.string().optional(),
  providerMetrics: WorkerProviderMetricsSchema.optional(),
});

export const WorkerJobSchema = WorkerJobRequestSchema.extend({
  id: z.string(),
  status: WorkerJobStatusSchema,
  /** The worker that actually ran it, once `auto` has been resolved. */
  resolvedWorker: WorkerIdSchema.optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  /** The isolated checkout the work happened in. Never the live working copy. */
  worktreePath: z.string().optional(),
  /**
   * Where the work came from, and what it was branched off.
   *
   * Recorded when the worktree is made, and checked again before anything is
   * integrated: work reviewed against one commit must not be fast-forwarded
   * onto a different one.
   */
  sourceRepoPath: z.string().optional(),
  baseCommit: z.string().optional(),
  targetBranch: z.string().optional(),
  workerBranch: z.string().optional(),
  /** 1 for the first attempt, 2 after one round of review feedback, and so on. */
  revision: z.number().optional(),
  /** The most recent review. */
  review: WorkerReviewSchema.optional(),
  /**
   * The most recent visual verdict, for the revision that is current.
   *
   * Earlier revisions are not overwritten — they are kept on disk beside their
   * screenshots — because "did the revision actually fix what we sent back?"
   * cannot be answered by a record that only holds the latest attempt.
   */
  visualVerification: VisualVerificationResultSchema.optional(),
  /** When a person approved it, and the commit that carried it in. */
  approvedAt: z.string().optional(),
  integratedCommit: z.string().optional(),
  /**
   * Every execution attempt, in order: exact model, digest, usage, timings,
   * validation and any fallback. Absent on jobs that predate route policy.
   */
  attempts: z.array(ExecutionAttemptSchema).optional(),
  /** Why the job failed, when it did. */
  error: z.string().optional(),
  result: WorkerJobResultSchema.optional(),
  /**
   * The last moment the worker was heard from. The console's liveness signal:
   * a job that is `running` but has not spoken for minutes is stalled, and a
   * job that is `running` on disk with no process behind it is interrupted.
   */
  lastEventAt: z.string().optional(),
  /** Set when the stall watch first noticed silence; cleared on the next event. */
  stalledSince: z.string().optional(),
  /** Set when the process died under the job — a restart, a crash, a signal. */
  interruptedAt: z.string().optional(),
  /** The job this one re-ran, when it was started as a retry. */
  retryOf: z.string().optional(),
});

/**
 * One thing a worker did, in the console's own vocabulary.
 *
 * Adapters translate whatever their runner emits into these. The UI must never
 * need to know that one worker speaks JSON-RPC and another speaks SDK events.
 */
export const WorkerEventTypeSchema = z.enum([
  "job.started",
  "job.progress",
  "tool.started",
  "tool.completed",
  "file.changed",
  "validation.started",
  "validation.completed",
  "visual.started",
  "visual.completed",
  "review.started",
  "review.completed",
  "revision.requested",
  "job.approved",
  "job.rejected",
  "integration.started",
  "integration.completed",
  "job.completed",
  "job.failed",
  "job.cancelled",
  /** Silence past the stall threshold while the run is still live. A warning, not an end. */
  "job.stalled",
  /** A document the worker produced was registered in the vault. */
  "artifact.created",
  /** The process holding the run died. Terminal: the work cannot be resumed. */
  "job.interrupted",
]);

export const WorkerEventSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  timestamp: z.string(),
  type: WorkerEventTypeSchema,
  message: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const WorkerJobsResponseSchema = z.object({
  jobs: z.array(WorkerJobSchema),
});

export const WorkerJobResponseSchema = z.object({
  job: WorkerJobSchema,
});

export const WorkerJobEventsResponseSchema = z.object({
  jobId: z.string(),
  events: z.array(WorkerEventSchema),
});

export type WorkerJobStatus = z.infer<typeof WorkerJobStatusSchema>;
export type WorkerSummary = z.infer<typeof WorkerSummarySchema>;
export type WorkersResponse = z.infer<typeof WorkersResponseSchema>;
export type WorkerHealth = z.infer<typeof WorkerHealthSchema>;
export type WorkerJobRequest = z.infer<typeof WorkerJobRequestSchema>;
export type WorkerValidation = z.infer<typeof WorkerValidationSchema>;
export type WorkerReviewVerdict = z.infer<typeof WorkerReviewVerdictSchema>;
export type WorkerReviewIssue = z.infer<typeof WorkerReviewIssueSchema>;
export type WorkerReviewCriterion = z.infer<typeof WorkerReviewCriterionSchema>;
export type WorkerReview = z.infer<typeof WorkerReviewSchema>;
export type WorkerDiffFile = z.infer<typeof WorkerDiffFileSchema>;
export type WorkerDiff = z.infer<typeof WorkerDiffSchema>;
export type WorkerProviderMetrics = z.infer<typeof WorkerProviderMetricsSchema>;
export type WorkerJobResult = z.infer<typeof WorkerJobResultSchema>;
export type WorkerArtifact = z.infer<typeof WorkerArtifactSchema>;
export type WorkerJob = z.infer<typeof WorkerJobSchema>;
export type WorkerEventType = z.infer<typeof WorkerEventTypeSchema>;
export type WorkerEvent = z.infer<typeof WorkerEventSchema>;
export type WorkerJobsResponse = z.infer<typeof WorkerJobsResponseSchema>;
export type WorkerJobResponse = z.infer<typeof WorkerJobResponseSchema>;
export type WorkerJobEventsResponse = z.infer<
  typeof WorkerJobEventsResponseSchema
>;

/**
 * A reason a reviewed job cannot be applied, and what would resolve it.
 *
 * The cure is decided on the server, where the condition is known, rather
 * than matched from the sentence in React — a reworded blocker should never
 * silently remove the button that fixes it.
 *
 * `retry` is the odd one and the important one: it is the cure for a base
 * that has moved, where there is deliberately no way to apply the existing
 * work. Rebasing it would integrate a tree nobody reviewed, so the offer is
 * to run the job again against what is there now.
 */
export const IntegrationCureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("switch"), branch: z.string() }),
  z.object({ kind: z.literal("stash") }),
  z.object({ kind: z.literal("validate") }),
  z.object({ kind: z.literal("review") }),
  z.object({ kind: z.literal("retry") }),
]);

export const IntegrationBlockerSchema = z.object({
  message: z.string(),
  cure: IntegrationCureSchema.optional(),
});

export type IntegrationCure = z.infer<typeof IntegrationCureSchema>;
export type IntegrationBlocker = z.infer<typeof IntegrationBlockerSchema>;
