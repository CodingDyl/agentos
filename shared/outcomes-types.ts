import { z } from "zod";

/**
 * Outcomes: did agent work earn money, and what did it cost in the owner's hours?
 *
 * Rand amounts are integer minor units (cents). AI cost stays in USD: there is
 * no exchange-rate source, so the two are never converted or added together.
 * Absent is not zero: an unknown rate or cost is `null`, shown as a dash.
 */

export const OWNER_HOURS_KINDS = ["delivery", "review", "sales", "admin", "learning"] as const;
export const OwnerHoursKindSchema = z.enum(OWNER_HOURS_KINDS);
export type OwnerHoursKind = z.infer<typeof OwnerHoursKindSchema>;

export const OwnerHoursEntrySchema = z.object({
  id: z.string(),
  on: z.iso.date(),
  minutes: z.number().int().min(1).max(1440),
  clientId: z.string().min(1).max(256).optional(),
  workspace: z.string().min(1).max(120).optional(),
  kind: OwnerHoursKindSchema,
  note: z.string().max(300).optional(),
  createdAt: z.string(),
});
export type OwnerHoursEntry = z.infer<typeof OwnerHoursEntrySchema>;

export const LogOwnerHoursRequestSchema = OwnerHoursEntrySchema.omit({ id: true, createdAt: true });
export type LogOwnerHoursRequest = z.infer<typeof LogOwnerHoursRequestSchema>;

export interface ClientOutcome {
  clientId: string;
  name: string;
  workspace: string | null;
  /** Paid this month. */
  paidMinor: number;
  paidTrailing90Minor: number;
  landedJobs: number;
  sendBacks: number;
  /** USD. Null when no run reported a cost. */
  aiCostUsd: number | null;
  ownerMinutes: number;
  /** Null with no logged hours, never zero. */
  randPerHourMinor: number | null;
}

export interface OutcomesResponse {
  /** YYYY-MM in Africa/Johannesburg. */
  month: string;
  target: { goalId: string; minor: number } | null;
  paidMinor: number;
  /** Null when there is no target. */
  gapMinor: number | null;
  /** Last 3 full months. Null with no payments ever. */
  trailingAverageMinor: number | null;
  /** Highest paid first. */
  clients: ClientOutcome[];
  unattributed: { paidMinor: number; landedJobs: number; ownerMinutes: number };
  agentWork: { landedJobs: number; onPayingClients: number; firstPassRate: number | null };
  ownerHours: {
    monthMinutes: number;
    weekMinutes: number;
    byKind: Record<string, number>;
    entries: OwnerHoursEntry[];
  };
  /** Every business client, for the hours form: a client with nothing logged yet still has to be pickable. */
  choices: { clients: Array<{ id: string; name: string; workspace: string | null }> };
  warnings: string[];
}
