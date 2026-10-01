import { z } from "zod";
import type { MemoryDuplicateMatch } from "./memory-types";

/**
 * Closing a task out: what changed, what was learned, and what is worth
 * remembering.
 *
 * Two kinds of record come out of a finished task and they are kept apart on
 * purpose. **Operational facts** — which worker ran, when it finished, what
 * validation said, which files changed — are recorded automatically in the
 * task's closeout and in Activity. They are history, not knowledge.
 * **Durable memory** — a reusable pattern, a lesson, a decision — is only ever
 * *proposed* by an agent, and becomes memory when a person saves it.
 */

/** What an agent may propose. `preference` and `status` are a person's to write. */
export const PROPOSABLE_MEMORY_TYPES = ["pattern", "lesson", "decision", "constraint", "business-rule", "fact"] as const;

export const ProposableMemoryTypeSchema = z.enum(PROPOSABLE_MEMORY_TYPES);
export type ProposableMemoryType = z.infer<typeof ProposableMemoryTypeSchema>;

export const MemoryProposalSchema = z.object({
  id: z.string().min(1).max(80),
  type: ProposableMemoryTypeSchema,
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(1).max(4000),
  project: z.string().min(1),
  /** The task it came out of. Absent for a memory promoted from a learning with no task. */
  sourceTask: z.string().min(1).optional(),
  /** The learning note it was promoted from. */
  sourceLearning: z.string().optional(),
  /** Where it was learned, at the moment captured. */
  sourceUrl: z.string().optional(),
  /** The worker job the proposal came out of. */
  sourceRun: z.string().optional(),
  sourceArtifact: z.string().optional(),
  /** `agent:<worker>` for a worker's proposal, `human` for one added at closeout. */
  proposedBy: z.string().min(1),
  /** Ticked by default on the closeout screen. */
  selected: z.boolean(),
});

export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;

export interface MemoryProposalReview extends MemoryProposal {
  /** Existing memory in the same project it may be repeating. */
  duplicates: MemoryDuplicateMatch[];
}

export const CloseoutValidationSchema = z.object({
  command: z.string(),
  success: z.boolean(),
});

export const TaskCloseoutSchema = z.object({
  taskId: z.string(),
  project: z.string(),
  summary: z.string(),
  changedFiles: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  memoryProposals: z.array(MemoryProposalSchema),
  suggestedStatusUpdate: z.string().optional(),
  completedAt: z.string(),
  /** Operational facts, recorded automatically. */
  worker: z.string().optional(),
  jobId: z.string().optional(),
  validation: z.array(CloseoutValidationSchema).optional(),
});

export type TaskCloseout = z.infer<typeof TaskCloseoutSchema>;

export const MemoryOutcomeSchema = z.object({
  proposalId: z.string(),
  title: z.string(),
  outcome: z.enum(["created", "updated", "dismissed", "failed"]),
  /** The note, or the decision's title, it ended up in. */
  target: z.string().optional(),
  error: z.string().optional(),
});

export type MemoryOutcome = z.infer<typeof MemoryOutcomeSchema>;

/** What was kept after the task closed: the closeout and what became of each proposal. */
export const TaskCloseoutRecordSchema = TaskCloseoutSchema.extend({
  memoryOutcomes: z.array(MemoryOutcomeSchema),
  statusApplied: z.boolean(),
  statusError: z.string().optional(),
});

export type TaskCloseoutRecord = z.infer<typeof TaskCloseoutRecordSchema>;

/** The closeout screen, before the task is completed. */
export interface TaskCloseoutDraft {
  ready: boolean;
  blockedReason?: string;
  closeout: Omit<TaskCloseout, "completedAt">;
  proposals: MemoryProposalReview[];
  currentStatus?: { heading: string; body?: string; revision: string };
  /** Already closed: the record, so the screen shows what happened. */
  record?: TaskCloseoutRecord;
}

export const MemoryDecisionSchema = z.object({
  proposal: MemoryProposalSchema,
  action: z.enum(["create", "update", "dismiss"]),
  /** For `update`: the note id, or the decision's title. */
  targetId: z.string().optional(),
  targetRevision: z.string().optional(),
  /** The person saw the possible duplicates and chose to create anyway. */
  acknowledgedDuplicates: z.boolean().optional(),
});

export type MemoryDecision = z.infer<typeof MemoryDecisionSchema>;

export const CompleteTaskRequestSchema = z.object({
  summary: z.string().trim().max(4000).optional(),
  memory: z.array(MemoryDecisionSchema).max(12).optional(),
  statusUpdate: z
    .object({
      body: z.string().trim().min(1).max(20_000),
      expectedRevision: z.string(),
    })
    .optional(),
});

export type CompleteTaskRequest = z.infer<typeof CompleteTaskRequestSchema>;

export interface CompleteTaskResponse {
  ok: true;
  record: TaskCloseoutRecord;
}

/** A 409 before anything was written: these proposals look like existing memory. */
export interface CloseoutDuplicateConflict {
  error: string;
  code: "possible_duplicates";
  proposals: Array<{ proposalId: string; duplicates: MemoryDuplicateMatch[] }>;
}
