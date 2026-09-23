import { z } from "zod";
import { WorkerIdSchema } from "./worker-ids";

/**
 * The validation sprint's record.
 *
 * This exists to answer one question AgentOS cannot currently answer about
 * itself: **does the workflow actually finish work faster than doing it by
 * hand?** Everything here is measurement, not workflow. Nothing in this file
 * routes, reviews, approves or integrates anything, and if it were deleted the
 * pipeline would run exactly as it does now.
 *
 * Two rules shape it.
 *
 * **Store only what nothing else knows.** Revisions, durations, cost, the
 * routing decision and the review verdict are already on the job record — they
 * are read from there, never copied here. What a job record cannot know is
 * whether a person had to step in, whether the whole thing felt worth it, and
 * where it hurt. That is all this store holds.
 *
 * **Absent is not zero.** A cost nobody could measure is `undefined`, not `0`.
 * The point of the sprint is evidence, and an invented number is worse than a
 * gap because a gap is legible as a gap.
 */

/**
 * The friction vocabulary, fixed in advance.
 *
 * Closed on purpose, and deliberately not inferred by a model: the whole value
 * of a friction report is that it takes two seconds to file, and asking an LLM
 * to categorise it afterwards would add both latency and a second opinion to a
 * thing that is supposed to be the operator's own.
 */
export const FrictionCategorySchema = z.enum([
  "too_many_clicks",
  "bad_task_scope",
  "wrong_worker_selected",
  "worker_got_confused",
  "missing_context",
  "review_was_poor",
  "validation_problem",
  "visual_verification_problem",
  "too_slow",
  "too_expensive",
  "approval_flow_annoying",
  "integration_problem",
  "other",
]);

/**
 * One reported annoyance.
 *
 * Append-only, and never acted on automatically. Step 51's discipline is that
 * noticing a problem and fixing a problem are separate activities, and a store
 * that made it easy to jump straight from one to the other would defeat the
 * sprint it was built for.
 */
export const ValidationFrictionSchema = z.object({
  id: z.string(),
  reportedAt: z.string(),
  category: FrictionCategorySchema,
  /** The operator's own words. Never summarised, never rewritten. */
  note: z.string().optional(),
  /** What it was about, when it was about something in particular. */
  taskId: z.string().optional(),
  jobId: z.string().optional(),
  project: z.string().optional(),
  /** Where it was reported from — `mission-control`, `worker-job`. */
  surface: z.string().optional(),
});

/**
 * How a task ended.
 *
 * `manual_takeover` is kept apart from `abandoned` because they are different
 * findings: one says AgentOS could not finish and the work still got done, the
 * other says the work did not get done. Collapsing them would hide the more
 * interesting half.
 */
export const ValidationOutcomeSchema = z.enum([
  "in_progress",
  "completed",
  "abandoned",
  "manual_takeover",
]);

/**
 * The moments a person had to step in.
 *
 * This is the sprint's most valuable measurement, and the reason it is a list
 * of kinds rather than a counter: seven interventions that were all "review
 * incorrect" and seven spread evenly are the same number and completely
 * different problems.
 */
export const InterventionKindSchema = z.enum([
  "scope_edited",
  "worker_overridden",
  "worker_redirected",
  "review_incorrect",
  "validation_fixed",
  "integration_manual",
  "taken_over",
]);

export const ValidationInterventionSchema = z.object({
  kind: InterventionKindSchema,
  at: z.string(),
  note: z.string().optional(),
});

/**
 * The subjective verdict, asked once when the task ends.
 *
 * A technically impressive workflow that feels miserable to use is still a bad
 * workflow, and no derived metric on this page can see that. This is the only
 * field in the sprint that is purely a feeling, and it is deliberately not
 * averaged into any of the others.
 */
export const ValidationVerdictSchema = z.enum([
  "definitely",
  "slightly",
  "no_difference",
  "worse",
]);

/**
 * One task in the sprint, as it is stored.
 *
 * Note what is *not* here: revisions, durations, cost, the recommended worker.
 * Those live on the job and are joined in on read. Storing them twice would
 * create a second truth about the same run, which is exactly the failure this
 * codebase keeps designing against.
 */
export const ValidationTaskSchema = z.object({
  taskId: z.string(),
  project: z.string(),
  /** What the task was, in the operator's words. */
  label: z.string(),
  /** The shape of work this was meant to exercise. Free text, for the review. */
  kind: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  /** The worker job this task was delegated to, once there is one. */
  jobId: z.string().optional(),
  outcome: ValidationOutcomeSchema,
  interventions: z.array(ValidationInterventionSchema).default([]),
  verdict: ValidationVerdictSchema.optional(),
  /** The biggest friction, in the operator's words, asked with the verdict. */
  verdictNote: z.string().optional(),
});

/**
 * A task with everything the job record knows joined onto it.
 *
 * The distinction between this and `ValidationTask` is the whole storage
 * design: the schema above is what is written, this is what is read. Every
 * field below is optional because every one of them can genuinely be unknown —
 * a task with no job yet has no worker, no duration and no cost.
 */
export const ValidationTaskViewSchema = ValidationTaskSchema.extend({
  /** What actually ran it. */
  worker: WorkerIdSchema.optional(),
  /** What the operator asked for — `auto`, or a worker by name. */
  requestedWorker: z.union([WorkerIdSchema, z.literal("auto")]).optional(),
  /** What the router recommended, when a router was involved. */
  recommendedWorker: WorkerIdSchema.optional(),
  /** True when the operator ran a worker the router did not recommend. */
  routingOverridden: z.boolean().optional(),
  /** The current attempt. 1 means it has not been sent back. */
  revisions: z.number().optional(),
  /** Hermes' latest verdict on the code. */
  reviewVerdict: z.enum(["pass", "changes_required", "blocked"]).optional(),
  /** Whether the first attempt passed review without being sent back. */
  firstPassReview: z.boolean().optional(),
  /** Delegation to integration — the number that includes all the waiting. */
  totalDurationMs: z.number().optional(),
  /** Worker start to worker finish — the number that does not. */
  workerDurationMs: z.number().optional(),
  costUsd: z.number().optional(),
  humanInterventions: z.number(),
  friction: z.array(ValidationFrictionSchema).default([]),
});

/**
 * The scorecard.
 *
 * Counts, not charts. Every rate is optional for the same reason the worker
 * performance record's are: a sprint with no finished task has no first-pass
 * rate, and reporting that as `0%` would be a much stronger claim than four
 * unfinished tasks support.
 */
export const ValidationScorecardSchema = z.object({
  tasksAttempted: z.number(),
  completed: z.number(),
  abandoned: z.number(),
  manualTakeover: z.number(),
  /** Share of reviewed tasks that passed on the first attempt. */
  firstPassReviewRate: z.number().optional(),
  avgRevisions: z.number().optional(),
  humanInterventions: z.number(),
  avgCompletionMs: z.number().optional(),
  avgWorkerMs: z.number().optional(),
  /**
   * Cost, and how much of the sprint it actually covers.
   *
   * The count is not decoration. A total of $4.12 across five tasks and the
   * same total across two of them are different facts, and a figure that did
   * not say which would quietly read as the first.
   */
  totalCostUsd: z.number().optional(),
  tasksWithCost: z.number(),
  /** How often the router was followed, and how that went. */
  routedTasks: z.number(),
  routingFollowed: z.number(),
  frictionReports: z.number(),
  /** Friction by category, worst first. Counts only — nothing is interpreted. */
  frictionByCategory: z
    .array(z.object({ category: FrictionCategorySchema, count: z.number() }))
    .default([]),
  /** The subjective answers, tallied. Never averaged into a score. */
  verdicts: z
    .array(z.object({ verdict: ValidationVerdictSchema, count: z.number() }))
    .default([]),
});

export const ValidationSprintSchema = z.object({
  tasks: z.array(ValidationTaskViewSchema).default([]),
  scorecard: ValidationScorecardSchema,
  /** Everything reported, newest first, including reports with no task. */
  friction: z.array(ValidationFrictionSchema).default([]),
});

/** Starting a task. Everything else about it is learned later. */
export const StartValidationTaskSchema = z.object({
  project: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().optional(),
  jobId: z.string().optional(),
});

/**
 * Anything that can change about a task after it starts.
 *
 * An intervention is *added*, never set: the list is a history, and a request
 * that replaced it wholesale would let a later write quietly erase an earlier
 * admission that somebody had to step in.
 */
export const UpdateValidationTaskSchema = z.object({
  jobId: z.string().optional(),
  outcome: ValidationOutcomeSchema.optional(),
  verdict: ValidationVerdictSchema.optional(),
  verdictNote: z.string().optional(),
  intervention: z
    .object({ kind: InterventionKindSchema, note: z.string().optional() })
    .optional(),
});

export const ReportFrictionSchema = z.object({
  category: FrictionCategorySchema,
  note: z.string().max(2000).optional(),
  taskId: z.string().optional(),
  jobId: z.string().optional(),
  project: z.string().optional(),
  surface: z.string().optional(),
});

/**
 * What a write returns: the record as stored, not the joined view.
 *
 * The derived half of a task belongs to the sprint read, which joins it to the
 * job. A write echoing a view would have to do that join too, and would then
 * be a second place that decides what a revision count means.
 */
export const ValidationTaskResponseSchema = z.object({
  task: ValidationTaskSchema,
});

export const ValidationFrictionResponseSchema = z.object({
  friction: ValidationFrictionSchema,
});

export type FrictionCategory = z.infer<typeof FrictionCategorySchema>;
export type ValidationFriction = z.infer<typeof ValidationFrictionSchema>;
export type ValidationOutcome = z.infer<typeof ValidationOutcomeSchema>;
export type InterventionKind = z.infer<typeof InterventionKindSchema>;
export type ValidationIntervention = z.infer<
  typeof ValidationInterventionSchema
>;
export type ValidationVerdict = z.infer<typeof ValidationVerdictSchema>;
export type ValidationTask = z.infer<typeof ValidationTaskSchema>;
export type ValidationTaskView = z.infer<typeof ValidationTaskViewSchema>;
export type ValidationScorecard = z.infer<typeof ValidationScorecardSchema>;
export type ValidationSprint = z.infer<typeof ValidationSprintSchema>;
export type StartValidationTask = z.infer<typeof StartValidationTaskSchema>;
export type UpdateValidationTask = z.infer<typeof UpdateValidationTaskSchema>;
export type ReportFriction = z.infer<typeof ReportFrictionSchema>;
export type ValidationTaskResponse = z.infer<
  typeof ValidationTaskResponseSchema
>;
export type ValidationFrictionResponse = z.infer<
  typeof ValidationFrictionResponseSchema
>;
