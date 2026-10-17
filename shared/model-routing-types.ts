import { z } from "zod";

/**
 * Usage-saving model routing.
 *
 * Every AgentOS launch (worker job, chat turn, Motion Design, film, rebuild)
 * is classified as one of four task types, then given the model and effort
 * configured for that type. The table is editable in Operations → AI Stack.
 * A job that already names a model or effort keeps it.
 */

export const MODEL_ROUTE_TASK_TYPES = ["plan", "execute", "motion", "normal"] as const;
export const ModelRouteTaskTypeSchema = z.enum(MODEL_ROUTE_TASK_TYPES);
export type ModelRouteTaskType = z.infer<typeof ModelRouteTaskTypeSchema>;

export const MODEL_ROUTE_TASK_LABEL: Record<ModelRouteTaskType, string> = {
  plan: "Plan",
  execute: "Execute",
  motion: "Motion / video",
  normal: "Normal request",
};

export const MODEL_ROUTE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const ModelRouteEffortSchema = z.enum(MODEL_ROUTE_EFFORTS);
export type ModelRouteEffort = z.infer<typeof ModelRouteEffortSchema>;

export const ModelRouteAssignmentSchema = z.object({
  model: z.string().trim().min(1).max(80),
  effort: ModelRouteEffortSchema,
});
export type ModelRouteAssignment = z.infer<typeof ModelRouteAssignmentSchema>;

export const ModelRoutingTableSchema = z.object({
  plan: ModelRouteAssignmentSchema,
  execute: ModelRouteAssignmentSchema,
  motion: ModelRouteAssignmentSchema,
  normal: ModelRouteAssignmentSchema,
});
export type ModelRoutingTable = z.infer<typeof ModelRoutingTableSchema>;

/**
 * Exact ids the app already uses: Motion Design's Opus 5.5 id, the Claude
 * worker's `sonnet` alias, and chat's `haiku` alias.
 */
export const DEFAULT_MODEL_ROUTING: ModelRoutingTable = {
  plan: { model: "claude-opus-5-5", effort: "high" },
  execute: { model: "sonnet", effort: "medium" },
  motion: { model: "claude-opus-5-5", effort: "high" },
  normal: { model: "haiku", effort: "low" },
};

export const MODEL_ROUTE_SOURCES = ["tagged", "jev", "heuristic", "override"] as const;
export const ModelRouteSourceSchema = z.enum(MODEL_ROUTE_SOURCES);
export type ModelRouteSource = z.infer<typeof ModelRouteSourceSchema>;

export const ModelRouteDecisionSchema = z.object({
  taskType: ModelRouteTaskTypeSchema,
  model: z.string(),
  effort: ModelRouteEffortSchema,
  /** How the type was chosen. `override` means the caller named the model. */
  source: ModelRouteSourceSchema,
  reason: z.string(),
});
export type ModelRouteDecision = z.infer<typeof ModelRouteDecisionSchema>;

export function mergeModelRouting(value: unknown): ModelRoutingTable {
  const parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const next: ModelRoutingTable = { ...DEFAULT_MODEL_ROUTING };

  for (const type of MODEL_ROUTE_TASK_TYPES) {
    const assignment = ModelRouteAssignmentSchema.safeParse(parsed[type]);
    if (assignment.success) next[type] = assignment.data;
  }

  return next;
}

export function modelRouteLabel(decision: Pick<ModelRouteDecision, "taskType" | "model" | "effort">): string {
  return `${MODEL_ROUTE_TASK_LABEL[decision.taskType]} · ${decision.model} · ${decision.effort}`;
}
