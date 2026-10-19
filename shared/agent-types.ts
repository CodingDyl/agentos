import { z } from "zod";
import {
  ModelRouteEffortSchema,
  ModelRoutingTableSchema,
} from "./model-routing-types";

/**
 * Specialists: the operator's team.
 *
 * Distinct from workers (Claude, Grok, Ollama) and from Operations' runtime
 * ledger rows (`hermes`, `claude`). A specialist owns a mission, a model
 * route, a ceiling and the jobs routed to them. Workers still execute.
 */

export const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

export const AgentIdSchema = z
  .string()
  .trim()
  .regex(AGENT_ID_PATTERN, "Agent id: lowercase letters, digits and hyphens.");

export const AgentScheduleSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  /** Human cadence, e.g. `weekdays at 7:30`. Never a cron expression. */
  cadence: z.string().trim().min(1).max(120),
  /** Hermes automation id, when this row is a link rather than a note. */
  automationId: z.string().trim().min(1).max(80).optional(),
});
export type AgentSchedule = z.infer<typeof AgentScheduleSchema>;

export const AgentModelRoutesSchema = ModelRoutingTableSchema.partial();
export type AgentModelRoutes = z.infer<typeof AgentModelRoutesSchema>;

export const AgentRecordSchema = z.object({
  id: AgentIdSchema,
  name: z.string().trim().min(1).max(80),
  /** Emoji or a short glyph. Shown next to the name. */
  avatar: z.string().trim().min(1).max(16),
  role: z.string().trim().min(1).max(160),
  mission: z.string().trim().min(1).max(500),
  standingInstructions: z.string().trim().max(8_000).default(""),
  /** Overlay on the AI Stack table, by task type. Missing types use the global table. */
  modelRoutes: AgentModelRoutesSchema.default({}),
  /** Models a job or flow may pick instead of the agent's default. Empty = unlimited. */
  allowedModelOverrides: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  effort: ModelRouteEffortSchema.optional(),
  /** Extra `--allowedTools` grants. Empty = none from the agent; request extras still apply. */
  allowedTools: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  /** Connector ids this agent may rely on. Empty = unlimited. */
  allowedConnectors: z.array(z.string().trim().min(1).max(64)).max(40).default([]),
  /** Skill ids this agent may run. Empty = unlimited. */
  allowedSkills: z.array(z.string().trim().min(1).max(64)).max(40).default([]),
  /** Monthly USD ceiling. Displayed against ledger spend; not a new approval gate. */
  creditCeilingUsd: z.number().nonnegative().max(100_000).default(0),
  linkedWorkspaces: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  schedules: z.array(AgentScheduleSchema).max(20).default([]),
  memoryNotes: z.string().trim().max(8_000).default(""),
  /** Words the free-form heuristic scores against. */
  keywords: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;

export const AgentPatchSchema = AgentRecordSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();
export type AgentPatch = z.infer<typeof AgentPatchSchema>;

export const AgentRouteSourceSchema = z.enum(["tagged", "jev", "heuristic"]);
export type AgentRouteSource = z.infer<typeof AgentRouteSourceSchema>;

export const AgentRouteDecisionSchema = z.object({
  agentId: AgentIdSchema,
  source: AgentRouteSourceSchema,
  reason: z.string(),
});
export type AgentRouteDecision = z.infer<typeof AgentRouteDecisionSchema>;

export const AgentSpendSchema = z.object({
  usd: z.number().nonnegative(),
  ceilingUsd: z.number().nonnegative(),
  windowLabel: z.string(),
  from: z.string(),
  to: z.string(),
  jobs: z.number().int().nonnegative(),
});
export type AgentSpend = z.infer<typeof AgentSpendSchema>;

export const AgentJobSummarySchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: z.string(),
  project: z.string(),
  worker: z.string(),
  createdAt: z.string(),
  href: z.string(),
});
export type AgentJobSummary = z.infer<typeof AgentJobSummarySchema>;

export const AgentSummarySchema = AgentRecordSchema.extend({
  openJobs: z.number().int().nonnegative(),
  spend: AgentSpendSchema,
  currentJob: AgentJobSummarySchema.optional(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const AgentsResponseSchema = z.object({
  agents: z.array(AgentSummarySchema),
});
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;

export const AgentDetailResponseSchema = z.object({
  agent: AgentRecordSchema,
  spend: AgentSpendSchema,
  jobs: z.array(AgentJobSummarySchema),
});
export type AgentDetailResponse = z.infer<typeof AgentDetailResponseSchema>;

export const AgentResponseSchema = z.object({
  agent: AgentRecordSchema,
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
