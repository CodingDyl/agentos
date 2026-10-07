import { z } from "zod";
import { MotionFormatSchema, MotionLogEntrySchema, MOTION_MAX_REFERENCES, MOTION_MAX_SECONDS, MOTION_MIN_SECONDS } from "./motion-types";

/**
 * Claude Motion: the installed Animate skill, run from Creative.
 *
 * Animate asks its user three questions before it animates anything: is the
 * story right, is the look right, is the storyboard right. In AgentOS those
 * are review gates. Each stage is one Claude Code run that stops at its gate
 * and leaves a checkpoint (notes and frames); a person approves it or asks
 * for changes on the film's page, and only then does the next stage run.
 */

/** The skill's own id in the registry, and the plugin it ships in. */
export const ANIMATE_SKILL_ID = "animate";
export const ANIMATE_SKILL_REF = "animate@animate";

export const ANIMATE_STAGES = ["story", "look", "storyboard", "build"] as const;
export const AnimateStageSchema = z.enum(ANIMATE_STAGES);

/** The stages a person signs off on before the build spends its time. */
export const ANIMATE_GATES = ["story", "look", "storyboard"] as const;

export const ANIMATE_STAGE_LABEL: Record<(typeof ANIMATE_STAGES)[number], string> = {
  story: "Story check",
  look: "Look",
  storyboard: "Storyboard",
  build: "Build and delivery",
};

export const AnimateRequestSchema = z.object({
  /** What the video is about. */
  topic: z.string().trim().min(1, "Say what the video is about.").max(240),
  /** Anything Animate's intake would have asked: audience, tone, facts to include, things to avoid. */
  brief: z.string().trim().max(4000).optional(),
  /** A shipped style's id, or absent to let Animate recommend one. */
  style: z.string().trim().max(64).optional(),
  durationSec: z.number().int().min(MOTION_MIN_SECONDS).max(MOTION_MAX_SECONDS).default(20),
  /** The first is the master. */
  formats: z.array(MotionFormatSchema).min(1).max(3).default(["9:16"]),
  project: z.string().trim().optional(),
  productTag: z.string().trim().max(60).optional(),
  /** Creative images to match the look to, or to use as the subject's own assets. */
  referenceAssetIds: z.array(z.string()).max(MOTION_MAX_REFERENCES).default([]),
});

export const AnimateStatusSchema = z.enum(["queued", "running", "awaiting_review", "completed", "failed", "cancelled", "interrupted"]);

export const AnimateCheckpointSchema = z.object({
  stage: AnimateStageSchema,
  at: z.string(),
  /** What Claude left for review, as markdown: the idea and beat table, the frame notes, the board notes. */
  notes: z.string(),
  /** Frames to look at, in the order to show them. */
  images: z.array(z.object({ name: z.string(), url: z.string() })).default([]),
  decision: z.enum(["approved", "changes"]).optional(),
  /** What the person asked to change. */
  note: z.string().optional(),
  decidedAt: z.string().optional(),
});

export const AnimateJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: AnimateStatusSchema,
  /** The stage being worked on, or waiting for review. */
  stage: AnimateStageSchema,
  request: AnimateRequestSchema,
  skill: z.object({ id: z.string(), ref: z.string(), name: z.string(), version: z.string() }),
  model: z.string().optional(),
  sessionId: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  attempts: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
  /** Claude's closing words after the delivery: what it is, the measured checks, what it could not verify. */
  summary: z.string().optional(),
  log: z.array(MotionLogEntrySchema).default([]),
  checkpoints: z.array(AnimateCheckpointSchema).default([]),
  /** Changes asked for after delivery, oldest first. */
  revisions: z.array(z.object({ at: z.string(), note: z.string() })).default([]),
  assetIds: z.array(z.string()).default([]),
  /** Exactly what Claude was sent for its first run. */
  prompt: z.string(),
});

export const AnimateStyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  blurb: z.string(),
  sampleUrl: z.string().optional(),
});

/** Whether Claude Motion can start, and if not, the one thing to do about it. */
export const AnimateSkillStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), ref: z.string(), name: z.string(), version: z.string() }),
  z.object({ state: z.literal("missing") }),
  z.object({ state: z.literal("disabled"), ref: z.string(), name: z.string() }),
  z.object({ state: z.literal("broken"), ref: z.string(), name: z.string(), errors: z.array(z.string()) }),
]);

export const AnimateStudioSchema = z.object({
  skill: AnimateSkillStateSchema,
  styles: z.array(AnimateStyleSchema),
  /** What is missing on this machine (Claude Code, ffmpeg, Playwright). */
  missing: z.array(z.string()),
});

export const AnimateDecisionSchema = z
  .object({
    decision: z.enum(["approve", "changes"]),
    note: z.string().trim().max(4000).optional(),
  })
  .refine((value) => value.decision === "approve" || Boolean(value.note), {
    message: "Say what should change.",
    path: ["note"],
  });

export type AnimateStage = z.infer<typeof AnimateStageSchema>;
export type AnimateRequest = z.infer<typeof AnimateRequestSchema>;
export type AnimateRequestInput = z.input<typeof AnimateRequestSchema>;
export type AnimateStatus = z.infer<typeof AnimateStatusSchema>;
export type AnimateCheckpoint = z.infer<typeof AnimateCheckpointSchema>;
export type AnimateJob = z.infer<typeof AnimateJobSchema>;
export type AnimateStyle = z.infer<typeof AnimateStyleSchema>;
export type AnimateSkillState = z.infer<typeof AnimateSkillStateSchema>;
export type AnimateStudio = z.infer<typeof AnimateStudioSchema>;
export type AnimateDecisionInput = z.input<typeof AnimateDecisionSchema>;
