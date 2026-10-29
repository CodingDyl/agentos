import { z } from "zod";

/**
 * Video ideas: a saved YouTube video turned into a `learning` note and,
 * when asked, an assessment of whether AgentOS should adopt what it shows.
 *
 * ```text
 * PASTE → TRANSCRIPT → NOTE → (ASSESS → DECIDE → PLAN → BUILD, one task at a time)
 * ```
 *
 * Nothing is built until Dylan approves the assessment, and every built change
 * still goes through the normal worker review before it merges.
 */

export const IdeaModeSchema = z.enum(["learn", "assess"]);
export type IdeaMode = z.infer<typeof IdeaModeSchema>;

export const IDEA_STAGES = [
  "transcribing",
  "needs_transcript",
  "noting",
  "noted",
  "assessing",
  "awaiting_decision",
  "declined",
  "planning",
  "building",
  "built",
  "failed",
] as const;
export const IdeaStageSchema = z.enum(IDEA_STAGES);
export type IdeaStage = z.infer<typeof IdeaStageSchema>;

/** Stages where something is happening without Dylan. */
export const WORKING_STAGES: readonly IdeaStage[] = ["transcribing", "noting", "assessing", "planning", "building"];

export const VerdictSchema = z.enum(["adopt", "adapt", "skip"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const VERDICT_LABELS: Record<Verdict, string> = { adopt: "Adopt", adapt: "Adapt", skip: "Skip" };

export const SizeSchema = z.enum(["small", "medium", "large"]);

/** At most this many build tasks come from one approved idea. */
export const MAX_TASKS = 5;

export const PlannedTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(8000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(12),
});
export type PlannedTask = z.infer<typeof PlannedTaskSchema>;

/** A worker run the idea made, so the card can say who ran and for how long. */
export const IdeaRunSchema = z.object({
  step: z.enum(["note", "assessment", "plan", "build"]),
  worker: z.string(),
  jobId: z.string().optional(),
  taskId: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.string().optional(),
});
export type IdeaRun = z.infer<typeof IdeaRunSchema>;

export const VideoIdeaSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  videoId: z.string(),
  title: z.string(),
  mode: IdeaModeSchema,
  stage: IdeaStageSchema,
  /** The stage a failed idea failed at, so Retry knows where to go back to. */
  failedAt: IdeaStageSchema.optional(),
  error: z.string().optional(),
  notePath: z.string().optional(),
  transcriptPath: z.string().optional(),
  noteId: z.string().optional(),
  assessmentPath: z.string().optional(),
  verdict: VerdictSchema.optional(),
  verdictWhy: z.string().optional(),
  size: SizeSchema.optional(),
  /** The worker job of the current assessment, plan or build step. */
  jobId: z.string().optional(),
  plan: z.array(PlannedTaskSchema).optional(),
  taskIds: z.array(z.string()),
  /** Index into `taskIds` of the build task now running or next to run. */
  currentTask: z.number().int().nonnegative().optional(),
  declineReason: z.string().optional(),
  runs: z.array(IdeaRunSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VideoIdea = z.infer<typeof VideoIdeaSchema>;

export const StartIdeaRequestSchema = z.object({
  sourceId: z.string().min(1).max(80),
  mode: IdeaModeSchema,
});
export type StartIdeaRequest = z.infer<typeof StartIdeaRequestSchema>;

export const DecideRequestSchema = z.object({
  decision: z.enum(["approve", "decline"]),
  reason: z.string().trim().max(500).optional(),
});
export type DecideRequest = z.infer<typeof DecideRequestSchema>;

export const PasteTranscriptRequestSchema = z.object({
  text: z.string().trim().min(1).max(400_000),
});
export type PasteTranscriptRequest = z.infer<typeof PasteTranscriptRequestSchema>;

export interface VideoIdeaReadiness {
  ytDlp: boolean;
  claude: boolean;
  missing: string[];
}
