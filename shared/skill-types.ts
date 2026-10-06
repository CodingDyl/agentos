import { z } from "zod";

/**
 * AgentOS skills: instructions for a kind of work, kept as folders with a
 * `SKILL.md`. A skill never carries credentials or grants access; the
 * connectors it lists under `requires` provide that, and are shown with
 * their own status.
 */

export const SkillRequirementSchema = z.object({
  /** A connector id, e.g. `github`. */
  connector: z.string(),
  name: z.string(),
  connected: z.boolean(),
  /** Known to AgentOS at all. An unknown requirement is an error on the skill. */
  known: z.boolean(),
});

export const SkillSummarySchema = z.object({
  /** The folder name; also the id used to enable or disable it. */
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  /**
   * `bundled` ships with AgentOS; `local` comes from AGENTOS_SKILLS_DIR and
   * starts disabled; `added` was written or uploaded on the Connectors page
   * and is the only kind that can be edited or deleted there.
   */
  source: z.enum(["bundled", "local", "added"]),
  enabled: z.boolean(),
  requirements: z.array(SkillRequirementSchema),
  /** Why the skill cannot be used. A skill with errors can't be enabled. */
  errors: z.array(z.string()),
  /** The instructions, for the View panel. */
  instructions: z.string(),
  /** Website rebuild runs currently using this skill. */
  activeRuns: z.number().int().nonnegative(),
});

/** The most a SKILL.md may hold, matching what the registry will read. */
export const SKILL_MAX_BYTES = 256 * 1024;
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A skill as written on the page, or read back from an uploaded SKILL.md for review. */
export const SkillDraftSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(SKILL_NAME_PATTERN, "Name: lowercase letters, digits and hyphens, starting with a letter or digit (e.g. seo-audit)."),
  description: z.string().trim().min(1, "Add a description: it says when to use the skill.").max(1000),
  /** Absent on a new skill (1.0.0) or an edit (the patch number goes up). */
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/, "Version must look like 1.2.3.")
    .optional(),
  requires: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  instructions: z.string().trim().min(1, "Write the instructions.").max(SKILL_MAX_BYTES),
});

export const SkillParseInputSchema = z.object({ markdown: z.string().max(SKILL_MAX_BYTES, "SKILL.md is larger than 256 KB.") }).strict();

/** An uploaded SKILL.md, read into the form. `errors` lists what must be fixed before it can be saved. */
export const SkillParseResultSchema = z.object({
  draft: z.object({
    name: z.string(),
    description: z.string(),
    version: z.string().optional(),
    requires: z.array(z.string()),
    instructions: z.string(),
  }),
  errors: z.array(z.string()),
});

/** The instructions a worker job was given, fixed when the job was created. */
export const JobSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  instructions: z.string(),
});

export const SkillsResponseSchema = z.object({ skills: z.array(SkillSummarySchema) });
export const SkillEnabledInputSchema = z.object({ enabled: z.boolean() }).strict();

export type SkillRequirement = z.infer<typeof SkillRequirementSchema>;
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
export type SkillsResponse = z.infer<typeof SkillsResponseSchema>;
export type SkillDraft = z.infer<typeof SkillDraftSchema>;
export type SkillDraftInput = z.input<typeof SkillDraftSchema>;
export type SkillParseResult = z.infer<typeof SkillParseResultSchema>;
export type JobSkill = z.infer<typeof JobSkillSchema>;
