import { z } from "zod";

/**
 * The Compass: direction, what matters, life areas, goals, projects and this
 * week's outcomes. Stored as `me/COMPASS.md` in the vault, in a fixed format
 * a person can also edit by hand (see docs/compass/README.md). It sits beside
 * GOALS.md and CURRENT_FOCUS.md and never rewrites them; when they disagree,
 * the Compass is the current word.
 */

export const AreaStatusSchema = z.enum(["on track", "slipping", "neglected", "unrated"]);
export type AreaStatus = z.infer<typeof AreaStatusSchema>;

export const ProjectStatusSchema = z.enum(["active", "paused", "admin", "done"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

const Line = (max: number) => z.string().trim().max(max);

export const CompassAreaSchema = z.object({
  name: Line(40).min(1),
  status: AreaStatusSchema.default("unrated"),
});

export const GoalIdSchema = z.string().regex(/^G\d{1,3}$/);

export const CompassGoalSchema = z.object({
  /** G1, G2…: what projects and Today's reasons point at. */
  id: GoalIdSchema,
  title: Line(200).min(1),
  area: Line(40).default(""),
  /** "2027-12", or anything you write. */
  by: Line(40).default(""),
  /** What is counted, e.g. "monthly income". */
  measure: Line(80).default(""),
  /** Where it stands, e.g. "R38,000". */
  now: Line(60).default(""),
  /** Where it should get to, e.g. "R100,000". */
  target: Line(60).default(""),
});

export const CompassProjectSchema = z.object({
  name: Line(120).min(1),
  serves: z.array(GoalIdSchema).max(10).default([]),
  status: ProjectStatusSchema.default("active"),
});

export const CompassSchema = z.object({
  direction: Line(600).default(""),
  values: z.array(Line(60).min(1)).max(20).default([]),
  areas: z.array(CompassAreaSchema).max(12).default([]),
  goals: z.array(CompassGoalSchema).max(30).default([]),
  projects: z.array(CompassProjectSchema).max(40).default([]),
  thisWeek: z.array(Line(200).min(1)).max(5).default([]),
});
export type Compass = z.infer<typeof CompassSchema>;
export type CompassGoal = z.infer<typeof CompassGoalSchema>;
export type CompassProject = z.infer<typeof CompassProjectSchema>;
export type CompassArea = z.infer<typeof CompassAreaSchema>;

/** A line in the file that could not be read. Shown, never dropped. */
export const CompassProblemSchema = z.object({ line: z.number().int(), text: z.string(), reason: z.string(), section: z.string().optional() });
export type CompassProblem = z.infer<typeof CompassProblemSchema>;

export const CompassReadSchema = z.object({
  /** False until me/COMPASS.md exists. */
  exists: z.boolean(),
  compass: CompassSchema,
  problems: z.array(CompassProblemSchema),
  /** The file's revision, so a save cannot silently overwrite an edit made in Obsidian meanwhile. */
  revision: z.string().optional(),
});
export type CompassRead = z.infer<typeof CompassReadSchema>;

export const CompassSaveSchema = z.object({ compass: CompassSchema, revision: z.string().optional() }).strict();

export const DEFAULT_AREAS = ["Business", "Career", "Money", "Health", "Relationships", "Learning"] as const;

// ─── The first-time interview ───────────────────────────────────────────────

export const InterviewQuestionsSchema = z.object({
  /** What Hermes already understood from your files, in a few lines. */
  understood: z.array(z.string()).default([]),
  questions: z.array(z.string().min(1)).min(1).max(12),
});
export type InterviewQuestions = z.infer<typeof InterviewQuestionsSchema>;

export const InterviewAnswersSchema = z
  .object({
    answers: z
      .array(z.object({ question: z.string().max(400), answer: z.string().max(2000) }).strict())
      .max(12),
  })
  .strict();
export type InterviewAnswers = z.infer<typeof InterviewAnswersSchema>;
