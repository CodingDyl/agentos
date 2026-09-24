import type { AiEvidence, AiStackEntry, AiStatus } from "@shared/ai-stack-types";
import type { Subscription } from "@shared/usage-types";

/**
 * Vocabulary for the AI Stack tab: how a status reads, which subscription
 * belongs to which AI, and the counts the summary shows.
 */

export const STATUS_LABELS: Record<AiStatus, string> = {
  live: "Live",
  off: "Off",
  unavailable: "Unavailable",
  "not-integrated": "Not connected",
};

export const STATUS_DOT: Record<AiStatus, string> = {
  live: "bg-os-success",
  off: "bg-os-subtle",
  unavailable: "bg-os-warning",
  "not-integrated": "bg-os-border-strong",
};

export const EVIDENCE_LABELS: Record<AiEvidence["kind"], string> = {
  cli: "CLI",
  app: "App",
  config: "Config",
  "env-key": "Key",
  server: "Server",
};

/** What a subscription costs per month, annual plans spread across twelve. */
export function monthlyPrice(subscription: Subscription): number | undefined {
  if (typeof subscription.price !== "number") return undefined;
  return subscription.billingCycle === "annual" ? subscription.price / 12 : subscription.price;
}

/**
 * The active subscriptions that belong to an AI.
 *
 * Matched on the provider the operator recorded, falling back to the AI's
 * name or vendor appearing in the plan's name — "Claude Pro Max" belongs to
 * Claude whether or not anyone filled in the provider field.
 */
export function subscriptionsFor(entry: AiStackEntry, subscriptions: readonly Subscription[]): Subscription[] {
  const names = [entry.name, entry.vendor].map((value) => value.toLowerCase().split(" ")[0]);

  return subscriptions.filter((subscription) => {
    if (!subscription.active) return false;

    const provider = subscription.provider?.toLowerCase();
    if (provider && entry.provider && provider === entry.provider) return true;

    const name = subscription.name.toLowerCase();
    return names.some((word) => word.length > 2 && name.includes(word));
  });
}

export function summarise(entries: readonly AiStackEntry[]): {
  live: number;
  off: number;
  unavailable: number;
  notConnected: number;
  detected: number;
} {
  return {
    live: entries.filter((entry) => entry.status === "live").length,
    off: entries.filter((entry) => entry.status === "off").length,
    unavailable: entries.filter((entry) => entry.status === "unavailable").length,
    notConnected: entries.filter((entry) => entry.status === "not-integrated").length,
    detected: entries.filter((entry) => entry.detected).length,
  };
}
