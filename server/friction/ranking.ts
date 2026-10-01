import {
  FRICTION_FREQUENCY_WEIGHT,
  FRICTION_SEVERITY_WEIGHT,
  type FrictionItem,
  type FrictionResponse,
  type FrictionTier,
  type RankedFrictionItem,
} from "../../shared/friction-types";

/**
 * Which friction to fix first. No model: `frequency × severity`, then the
 * newer report, then the id — the same list always sorts the same way.
 */

export function frictionPriority(item: Pick<FrictionItem, "frequency" | "severity">): number {
  return FRICTION_FREQUENCY_WEIGHT[item.frequency] * FRICTION_SEVERITY_WEIGHT[item.severity];
}

/** 6 and 9 are high value (often × medium and up); 3–4 are worth fixing; 1–2 are low. */
export function frictionTier(priority: number): FrictionTier {
  if (priority >= 6) return "high";
  if (priority >= 3) return "medium";
  return "low";
}

export function rankFriction(items: readonly FrictionItem[]): FrictionResponse {
  const ranked: RankedFrictionItem[] = items.map((item) => {
    const priority = frictionPriority(item);
    return { ...item, priority, tier: frictionTier(priority) };
  });

  const open = ranked
    .filter((item) => item.status === "open")
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        FRICTION_SEVERITY_WEIGHT[b.severity] - FRICTION_SEVERITY_WEIGHT[a.severity] ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );

  const closed = ranked
    .filter((item) => item.status !== "open")
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) || a.id.localeCompare(b.id));

  return { open, closed };
}
