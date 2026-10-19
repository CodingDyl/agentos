import {
  DEFAULT_MODEL_ROUTING,
  MODEL_ROUTE_TASK_TYPES,
  type ModelRouteDecision,
  type ModelRouteEffort,
  type ModelRouteTaskType,
  type ModelRoutingTable,
} from "../../shared/model-routing-types";
import { classifyTaskType } from "./classify";
import { modelRoutingTable } from "./settings";

export interface ResolveModelRouteInput {
  objective: string;
  taggedType?: ModelRouteTaskType;
  modelOverride?: string;
  effort?: ModelRouteEffort;
  /** Overlay on the AI Stack table, used by a specialist's own routes. */
  table?: Partial<ModelRoutingTable>;
}

/**
 * The model and effort this launch should use.
 *
 * A caller-supplied model or effort is kept (the Motion wizard's override,
 * a chat picker, an env default the operator set). The type is still recorded
 * so the job can show what kind of work this was.
 */
export async function resolveModelRoute(input: ResolveModelRouteInput): Promise<ModelRouteDecision> {
  const classified = await classifyTaskType({
    objective: input.objective,
    taggedType: input.taggedType,
  });
  const table = { ...modelRoutingTable() };
  if (input.table) {
    for (const type of MODEL_ROUTE_TASK_TYPES) {
      const overlay = input.table[type];
      if (overlay) table[type] = overlay;
    }
  }
  const assignment = table[classified.taskType] ?? DEFAULT_MODEL_ROUTING[classified.taskType];
  const model = input.modelOverride?.trim() || assignment.model;
  const effort = input.effort ?? assignment.effort;
  const overridden = Boolean(input.modelOverride?.trim()) || input.effort !== undefined;

  return {
    taskType: classified.taskType,
    model,
    effort,
    source: overridden && !input.taggedType ? "override" : classified.source,
    reason: overridden
      ? `${classified.reason} Model or effort was set on the job.`
      : `${classified.reason} Routed to ${model} at ${effort} effort.`,
  };
}

/** The assignment for one type, from the current table. */
export function routeFor(type: ModelRouteTaskType): { model: string; effort: ModelRouteEffort } {
  return modelRoutingTable()[type] ?? DEFAULT_MODEL_ROUTING[type];
}

/**
 * Map a routed model id onto one the agent actually offers.
 *
 * Chat lists aliases (`opus`, `sonnet`, `haiku`); workers accept those and
 * the full `claude-opus-5-5` ids. Prefer an exact match, then the same family.
 */
export function pickOfferedModel(
  offered: readonly { id: string }[],
  preferred: string,
  fallback: string,
): string {
  const ids = offered.map((entry) => entry.id);
  if (ids.includes(preferred)) return preferred;

  const family = modelFamily(preferred);
  if (family) {
    const match = ids.find((id) => id !== "default" && modelFamily(id) === family);
    if (match) return match;
  }

  return fallback;
}

export function modelFamily(id: string): "opus" | "sonnet" | "haiku" | "fable" | undefined {
  const match = /(?:claude[\s-]*)?(opus|sonnet|haiku|fable)/i.exec(id);
  const name = match?.[1]?.toLowerCase();
  if (name === "opus" || name === "sonnet" || name === "haiku" || name === "fable") return name;
  return undefined;
}
