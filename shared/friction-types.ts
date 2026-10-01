import { z } from "zod";

/**
 * Friction: the small annoyances of using AgentOS, written down the moment
 * they happen so they can be fixed in order of how much they cost.
 */

export const FRICTION_FREQUENCIES = ["once", "sometimes", "often"] as const;
export const FRICTION_SEVERITIES = ["low", "medium", "high"] as const;
export const FRICTION_STATUSES = ["open", "fixed", "ignored"] as const;

export const FrictionFrequencySchema = z.enum(FRICTION_FREQUENCIES);
export const FrictionSeveritySchema = z.enum(FRICTION_SEVERITIES);
export const FrictionStatusSchema = z.enum(FRICTION_STATUSES);

export type FrictionFrequency = z.infer<typeof FrictionFrequencySchema>;
export type FrictionSeverity = z.infer<typeof FrictionSeveritySchema>;
export type FrictionStatus = z.infer<typeof FrictionStatusSchema>;

export const FrictionItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  route: z.string().optional(),
  frequency: FrictionFrequencySchema,
  severity: FrictionSeveritySchema,
  status: FrictionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type FrictionItem = z.infer<typeof FrictionItemSchema>;

export const ReportFrictionRequestSchema = z.object({
  description: z.string().trim().min(3).max(1000),
  route: z.string().trim().max(300).optional(),
  frequency: FrictionFrequencySchema,
  severity: FrictionSeveritySchema,
});

export type ReportFrictionRequest = z.infer<typeof ReportFrictionRequestSchema>;

export const UpdateFrictionRequestSchema = z.object({
  status: FrictionStatusSchema,
});

export const FRICTION_FREQUENCY_WEIGHT: Record<FrictionFrequency, number> = { once: 1, sometimes: 2, often: 3 };
export const FRICTION_SEVERITY_WEIGHT: Record<FrictionSeverity, number> = { low: 1, medium: 2, high: 3 };

export type FrictionTier = "high" | "medium" | "low";

export interface RankedFrictionItem extends FrictionItem {
  /** frequency × severity, 1–9. */
  priority: number;
  tier: FrictionTier;
}

export interface FrictionResponse {
  /** Open items, highest priority first. */
  open: RankedFrictionItem[];
  /** Fixed and ignored items, most recently changed first. */
  closed: RankedFrictionItem[];
}

/** Turns a route into a page name a person recognises: `/memory?note=x` → `Memory`. */
export function pageNameForRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const first = route.split(/[?#]/)[0].split("/").filter(Boolean)[0];
  if (!first) return "Today";
  const names: Record<string, string> = {
    workspaces: "Workspaces",
    memory: "Memory",
    knowledge: "Knowledge",
    designs: "Creative",
    operations: "Operations",
    automations: "Automations",
    connectors: "Connectors",
    activity: "Activity",
    workers: "Agents",
    agent: "Hermes console",
    inbox: "Inbox",
    finance: "Finance",
    databases: "Databases",
  };
  return names[first] ?? first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, " ");
}
