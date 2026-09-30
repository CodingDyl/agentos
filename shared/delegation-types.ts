import { z } from "zod";
import { MemoryContextSourceSchema, MemoryContextStatusSchema } from "./memory-types";
import { RoutePolicyRecordSchema, RoutingModeSchema } from "./route-policy-types";
import { VisualAcceptanceContextSchema } from "./visual-verification-types";
import {
  WorkerPerformanceSchema,
  WorkerRoutingDecisionSchema,
  WorkerTaskTypeSchema,
} from "./worker-routing-types";
import { WorkerIdSchema, WorkerJobStatusSchema } from "./worker-types";

/**
 * Handing a project task to a worker.
 *
 * This is the join between the two halves of the system: the vault, which is
 * hand-written and is the project's own account of itself, and the worker
 * pipeline, which is machinery. The rules that keep them from corrupting each
 * other are in the shapes here.
 *
 * - **A plan is proposed, never executed.** Scoping produces a `DelegationPlan`
 *   and stops. What turns it into work is a person reading it and saying yes.
 * - **The vault does not learn about jobs.** The task-to-job mapping lives in
 *   AgentOS's own state. `TASKS.md` is the project's file, and an execution id
 *   is not something the project knows or should have to carry.
 * - **A task closes on integration, not on a claim.** Nothing here can mark a
 *   task done; the furthest it goes is saying a task is ready to be closed.
 */

/**
 * What Hermes scoped the task into.
 *
 * The same fields a worker job takes, which is the point: this is the brief,
 * written before anyone has committed to running it, in a form an operator can
 * read and correct.
 */
export const DelegationPlanSchema = z.object({
  taskId: z.string(),
  project: z.string(),
  objective: z.string().min(1),
  contextFiles: z.array(z.string()),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  validationCommands: z.array(z.string()),
  suggestedTaskType: WorkerTaskTypeSchema.optional(),
  /**
   * What the finished work is supposed to look like, when looking matters.
   *
   * Part of the plan rather than something asked for afterwards, because this
   * is the only moment a person is reading the terms of the work. By the time
   * an implementation exists, the brief that motivated it and the board it was
   * drawn from have to be found again — and a reviewer made to reconstruct
   * them will reconstruct them wrong.
   */
  visualAcceptance: VisualAcceptanceContextSchema.optional(),
  /** Said out loud when Hermes could not scope it and this is a fallback. */
  scopedBy: z.enum(["hermes", "agentos"]),
  /**
   * Which vault notes Hermes was shown while scoping, beyond the project's own
   * four files — so a plan that leans on a note can be traced to it.
   */
  scopingMemory: z
    .object({
      status: MemoryContextStatusSchema,
      sources: z.array(MemoryContextSourceSchema),
      warnings: z.array(z.string()),
    })
    .optional(),
});

/** What the console asks for when the operator clicks Delegate. */
export const TaskDelegationRequestSchema = z.object({
  requestedWorker: z
    .union([WorkerIdSchema, z.literal("auto")])
    .default("auto"),
  /**
   * How the route policy should choose. Absent means the pre-policy behaviour:
   * an explicit `requestedWorker` runs as named and `auto` asks Hermes.
   */
  routingMode: RoutingModeSchema.optional(),
  /** With `manual`, the execution option (e.g. `ollama:qwen2.5-coder:7b`) chosen by hand. */
  manualOptionId: z.string().optional(),
});

/**
 * A prepared delegation, before anything runs.
 *
 * Both halves are shown together because they are decided together: what the
 * work is, and who would do it. Approving one without seeing the other would
 * be approving half a decision.
 */
export const TaskDelegationPreviewSchema = z.object({
  plan: DelegationPlanSchema,
  routing: WorkerRoutingDecisionSchema.optional(),
  candidates: z.array(WorkerPerformanceSchema).optional(),
  /** Why no worker could be recommended, when none could. */
  routingError: z.string().optional(),
  /**
   * The route policy's full finding: what was chosen or why it was blocked,
   * what was ruled out, and the one permitted fallback. Present whenever the
   * policy made the decision, including when it blocked the task.
   */
  policy: RoutePolicyRecordSchema.optional(),
});

/** Re-checking the route for a plan that has been edited or given a new mode. */
export const TaskRouteRequestSchema = TaskDelegationRequestSchema.extend({
  plan: DelegationPlanSchema,
});

export const TaskRoutePreviewSchema = TaskDelegationPreviewSchema.omit({ plan: true });

/** What the console sends back once a person has approved a plan. */
export const TaskDelegationApprovalSchema = z.object({
  plan: DelegationPlanSchema,
  worker: z.union([WorkerIdSchema, z.literal("auto")]),
  routing: WorkerRoutingDecisionSchema.optional(),
  repoPath: z.string().optional(),
  routingMode: RoutingModeSchema.optional(),
  manualOptionId: z.string().optional(),
});

/**
 * What AgentOS remembers about a task it delegated.
 *
 * Deliberately thin. The job is the record of the work; this only says which
 * job belongs to which task, and when that was decided.
 */
export const TaskJobLinkSchema = z.object({
  project: z.string(),
  taskId: z.string(),
  jobId: z.string(),
  delegatedAt: z.string(),
  /** Set when a person has closed the task off the back of this job. */
  completedAt: z.string().optional(),
});

/**
 * A task's delegation, as the project screen needs it.
 *
 * Carries the job's live status so a task row can say what is happening to it
 * without the screen having to know how jobs work.
 */
export const TaskDelegationStateSchema = TaskJobLinkSchema.extend({
  status: WorkerJobStatusSchema.optional(),
  worker: z.string().optional(),
  reviewVerdict: z.enum(["pass", "changes_required", "blocked"]).optional(),
  /** True while a job is still running, which is what blocks a second one. */
  active: z.boolean(),
});

export const TaskDelegationsResponseSchema = z.object({
  delegations: z.array(TaskDelegationStateSchema),
});

/**
 * The change Hermes proposes to `TASKS.md`, once work has been integrated.
 *
 * Shown as before-and-after rather than applied. Every other write in this
 * system is AgentOS's own state; this one edits a file a person wrote, so it
 * is the one that most needs a person to agree to it.
 */
export const TaskCompletionProposalSchema = z.object({
  project: z.string(),
  taskId: z.string(),
  /** The line as it stands in the file today. */
  before: z.string(),
  /** The line as it would be written. */
  after: z.string(),
  jobId: z.string(),
  /** Why it is not ready, when it is not. */
  blockedReason: z.string().optional(),
  ready: z.boolean(),
});

/**
 * Batch-delegating a milestone.
 *
 * Same two-phase shape as a single task — prepare, then start — just N times
 * over, so a milestone with several ready tasks is one review instead of N
 * trips through the single-task flow. Nothing here starts a job on its own.
 */
export const MilestoneTaskPreviewSchema = z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  preview: TaskDelegationPreviewSchema.optional(),
  /** Why this task's plan could not be prepared, when it could not. */
  error: z.string().optional(),
});

export const MilestoneDelegationPreviewSchema = z.object({
  milestoneId: z.string(),
  /** Tasks Hermes was asked to scope — each either ready to approve, or its own error. */
  ready: z.array(MilestoneTaskPreviewSchema),
  /** Tasks never sent to Hermes at all — already done, blocked, or already running. */
  skipped: z.array(z.object({ taskId: z.string(), taskTitle: z.string(), reason: z.string() })),
});

export const MilestoneDelegationRequestSchema = z.object({
  requestedWorker: z
    .union([WorkerIdSchema, z.literal("auto")])
    .default("auto"),
  routingMode: RoutingModeSchema.optional(),
});

/** One approved task, carrying the plan a person reviewed for it. */
export const MilestoneTaskApprovalSchema = TaskDelegationApprovalSchema.extend({
  taskId: z.string(),
});

export const MilestoneDelegationStartRequestSchema = z.object({
  tasks: z.array(MilestoneTaskApprovalSchema).min(1),
});

export const MilestoneDelegationResultSchema = z.object({
  started: z.array(z.object({ taskId: z.string(), jobId: z.string() })),
  failed: z.array(z.object({ taskId: z.string(), error: z.string() })),
});

export type MilestoneTaskPreview = z.infer<typeof MilestoneTaskPreviewSchema>;
export type MilestoneDelegationPreview = z.infer<typeof MilestoneDelegationPreviewSchema>;
export type MilestoneDelegationRequest = z.infer<typeof MilestoneDelegationRequestSchema>;
export type MilestoneTaskApproval = z.infer<typeof MilestoneTaskApprovalSchema>;
export type MilestoneDelegationStartRequest = z.infer<typeof MilestoneDelegationStartRequestSchema>;
export type MilestoneDelegationResult = z.infer<typeof MilestoneDelegationResultSchema>;

export type DelegationPlan = z.infer<typeof DelegationPlanSchema>;
export type TaskRouteRequest = z.infer<typeof TaskRouteRequestSchema>;
export type TaskRoutePreview = z.infer<typeof TaskRoutePreviewSchema>;
export type TaskDelegationRequest = z.infer<typeof TaskDelegationRequestSchema>;
export type TaskDelegationPreview = z.infer<typeof TaskDelegationPreviewSchema>;
export type TaskDelegationApproval = z.infer<
  typeof TaskDelegationApprovalSchema
>;
export type TaskJobLink = z.infer<typeof TaskJobLinkSchema>;
export type TaskDelegationState = z.infer<typeof TaskDelegationStateSchema>;
export type TaskDelegationsResponse = z.infer<
  typeof TaskDelegationsResponseSchema
>;
export type TaskCompletionProposal = z.infer<
  typeof TaskCompletionProposalSchema
>;
