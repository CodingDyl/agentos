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
  /** `bundled` ships with AgentOS; `local` comes from AGENTOS_SKILLS_DIR and starts disabled. */
  source: z.enum(["bundled", "local"]),
  enabled: z.boolean(),
  requirements: z.array(SkillRequirementSchema),
  /** Why the skill cannot be used. A skill with errors can't be enabled. */
  errors: z.array(z.string()),
  /** The instructions, for the View panel. */
  instructions: z.string(),
  /** Website rebuild runs currently using this skill. */
  activeRuns: z.number().int().nonnegative(),
});

export const SkillsResponseSchema = z.object({ skills: z.array(SkillSummarySchema) });
export const SkillEnabledInputSchema = z.object({ enabled: z.boolean() }).strict();

export type SkillRequirement = z.infer<typeof SkillRequirementSchema>;
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
export type SkillsResponse = z.infer<typeof SkillsResponseSchema>;
