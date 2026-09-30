import { z } from "zod";

/**
 * The motion studio: a brief in, a rendered film out.
 *
 * A film is made by Claude Code working unattended in a studio folder of its
 * own, following the motion studio rules kept in the vault. AgentOS writes the
 * brief, runs it, shows each review round as it happens, and files the finished
 * MP4s into Creative.
 */

export const MOTION_TEMPLATE_IDS = ["showreel", "brand", "custom"] as const;
export const MotionTemplateIdSchema = z.enum(MOTION_TEMPLATE_IDS);

export const MOTION_FORMATS = ["9:16", "1:1", "16:9"] as const;
export const MotionFormatSchema = z.enum(MOTION_FORMATS);

export const MOTION_EFFORTS = ["high", "xhigh", "max"] as const;
export const MotionEffortSchema = z.enum(MOTION_EFFORTS);

export const MOTION_MIN_SECONDS = 6;
export const MOTION_MAX_SECONDS = 60;
export const MOTION_MAX_REFERENCES = 12;

/** The brief's fields. Stored jobs are read against this, without the cross-field checks. */
export const MotionJobRequestBaseSchema = z.object({
  template: MotionTemplateIdSchema,
  /** What the film is about. Required unless the brief is written by hand. */
  product: z.string().trim().max(120).optional(),
  url: z.string().trim().url().max(500).optional().or(z.literal("")),
  /** The one number that proves it works. Never invented when absent. */
  metric: z.string().trim().max(200).optional(),
  cta: z.string().trim().max(120).optional(),
  durationSec: z.number().int().min(MOTION_MIN_SECONDS).max(MOTION_MAX_SECONDS).default(15),
  /** The first is the master; the rest are cut from the same timeline. */
  formats: z.array(MotionFormatSchema).min(1).max(3).default(["9:16"]),
  /** Extra direction, or the whole brief for `custom`. */
  brief: z.string().trim().max(4000).optional(),
  project: z.string().trim().optional(),
  productTag: z.string().trim().max(60).optional(),
  /** Library assets copied into the studio as brand material. */
  referenceAssetIds: z.array(z.string()).max(MOTION_MAX_REFERENCES).default([]),
  effort: MotionEffortSchema.default("max"),
});

export const MotionJobRequestSchema = MotionJobRequestBaseSchema
  .refine((request) => request.template === "custom" || Boolean(request.product), {
    message: "Name the product or brand the film is about.",
    path: ["product"],
  })
  .refine((request) => request.template !== "custom" || Boolean(request.brief), {
    message: "A custom film needs a brief.",
    path: ["brief"],
  });

export const MotionJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const MotionLogEntrySchema = z.object({
  at: z.string(),
  kind: z.enum(["system", "text", "tool"]),
  message: z.string(),
});

export const MotionPromptSourceSchema = z.object({
  /** `vault` when read from the note, `built-in` when the note was unavailable. */
  source: z.enum(["vault", "built-in"]),
  /** Vault-relative, when it came from the vault. */
  path: z.string().optional(),
});

export const MotionJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: MotionJobStatusSchema,
  request: MotionJobRequestBaseSchema,
  /** Exactly what Claude Code was sent, so a film can be understood later. */
  prompt: z.string(),
  promptSources: z.object({
    rules: MotionPromptSourceSchema,
    template: MotionPromptSourceSchema,
  }),
  model: z.string().optional(),
  /** Claude Code's session, so an interrupted film resumes rather than restarts. */
  sessionId: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  /** Runs made: the first, plus each resume. */
  attempts: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
  /** Claude's closing words: what the film does, final scores, what it could not do. */
  summary: z.string().optional(),
  log: z.array(MotionLogEntrySchema).default([]),
  /** Changes the operator asked for after watching, oldest first. */
  revisions: z.array(z.object({ at: z.string(), note: z.string() })).default([]),
  /** The finished films, filed in Creative. */
  assetIds: z.array(z.string()).default([]),
  usage: z
    .object({
      turns: z.number().optional(),
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
    })
    .optional(),
});

export const MotionRoundSchema = z.object({
  round: z.number(),
  scores: z.record(z.string(), z.number()),
  fixes: z.array(z.string()).default([]),
  /** The round's contact sheet, when Claude saved one where AgentOS looks. */
  sheetUrl: z.string().optional(),
});

/** A job, plus what can be read from its studio folder right now. */
export const MotionJobDetailSchema = MotionJobSchema.extend({
  rounds: z.array(MotionRoundSchema),
  /** Every contact sheet in the studio, oldest first. */
  sheets: z.array(z.object({ name: z.string(), url: z.string() })),
  /** Rendered files in `out/`, before they are filed. */
  outputs: z.array(z.string()),
});

export const MotionTemplateSchema = z.object({
  id: MotionTemplateIdSchema,
  label: z.string(),
  description: z.string(),
  /** The template text with its placeholders still in. */
  text: z.string(),
  source: MotionPromptSourceSchema,
});

export const MotionStudioInfoSchema = z.object({
  rules: z.object({ text: z.string(), source: MotionPromptSourceSchema }),
  templates: z.array(MotionTemplateSchema),
  /** Whether a film can be made on this machine, and what is missing if not. */
  readiness: z.object({
    ready: z.boolean(),
    missing: z.array(z.string()),
  }),
});

export type MotionTemplateId = z.infer<typeof MotionTemplateIdSchema>;
export type MotionFormat = z.infer<typeof MotionFormatSchema>;
export type MotionEffort = z.infer<typeof MotionEffortSchema>;
export type MotionJobRequest = z.infer<typeof MotionJobRequestSchema>;
export type MotionJobRequestInput = z.input<typeof MotionJobRequestSchema>;
export type MotionJobStatus = z.infer<typeof MotionJobStatusSchema>;
export type MotionLogEntry = z.infer<typeof MotionLogEntrySchema>;
export type MotionPromptSource = z.infer<typeof MotionPromptSourceSchema>;
export type MotionJob = z.infer<typeof MotionJobSchema>;
export type MotionRound = z.infer<typeof MotionRoundSchema>;
export type MotionJobDetail = z.infer<typeof MotionJobDetailSchema>;
export type MotionTemplate = z.infer<typeof MotionTemplateSchema>;
export type MotionStudioInfo = z.infer<typeof MotionStudioInfoSchema>;
