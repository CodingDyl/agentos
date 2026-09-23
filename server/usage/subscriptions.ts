import { randomUUID } from "node:crypto";
import type { Subscription } from "../../shared/usage-types";
import { usageDatabase } from "./db";

/**
 * What is being paid for regardless of usage.
 *
 * Entered by hand, and that is the considered choice rather than a shortcut.
 * Writing billing integrations for Anthropic, OpenAI, xAI, Cursor and GitHub
 * to learn five numbers the operator already knows would take days, break
 * whenever a provider changed a dashboard, and produce figures that are harder
 * to sanity-check than a typed one. Where a balance genuinely is one
 * authenticated GET — OpenRouter — AgentOS asks; everything else is recorded.
 *
 * Nothing here is inferred. AgentOS never decides a subscription exists
 * because it saw traffic from a provider: an API key on a pay-as-you-go
 * account and a $20/month plan look identical from the inside, and guessing
 * would put invented money in a total.
 */

interface SubscriptionRow {
  id: string;
  name: string;
  provider: string | null;
  type: string;
  price: number | null;
  currency: string;
  billing_cycle: string | null;
  renewal_date: string | null;
  balance_usd: number | null;
  balance_checked_at: string | null;
  active: number;
  notes: string | null;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider ?? undefined,
    type: row.type as Subscription["type"],
    price: row.price ?? undefined,
    currency: row.currency,
    billingCycle: (row.billing_cycle as Subscription["billingCycle"]) ?? undefined,
    renewalDate: row.renewal_date ?? undefined,
    balanceUsd: row.balance_usd ?? undefined,
    balanceCheckedAt: row.balance_checked_at ?? undefined,
    active: row.active === 1,
    notes: row.notes ?? undefined,
  };
}

export function listSubscriptions(): Subscription[] {
  try {
    const rows = usageDatabase()
      .prepare("SELECT * FROM subscriptions ORDER BY active DESC, name")
      .all() as unknown as SubscriptionRow[];

    return rows.map(toSubscription);
  } catch (error) {
    console.error("[agentos] could not read subscriptions:", error);
    return [];
  }
}

export type SubscriptionInput = Omit<Subscription, "id"> & { id?: string };

/** Creates or replaces one subscription. */
export function saveSubscription(
  input: SubscriptionInput,
): Subscription | undefined {
  const subscription: Subscription = {
    ...input,
    id: input.id ?? `sub_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
  };

  try {
    usageDatabase()
      .prepare(
        `INSERT INTO subscriptions (
           id, name, provider, type, price, currency, billing_cycle,
           renewal_date, balance_usd, balance_checked_at, active, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name,
           provider = excluded.provider,
           type = excluded.type,
           price = excluded.price,
           currency = excluded.currency,
           billing_cycle = excluded.billing_cycle,
           renewal_date = excluded.renewal_date,
           balance_usd = excluded.balance_usd,
           balance_checked_at = excluded.balance_checked_at,
           active = excluded.active,
           notes = excluded.notes`,
      )
      .run(
        subscription.id,
        subscription.name,
        subscription.provider ?? null,
        subscription.type,
        subscription.price ?? null,
        subscription.currency ?? "USD",
        subscription.billingCycle ?? null,
        subscription.renewalDate ?? null,
        subscription.balanceUsd ?? null,
        subscription.balanceCheckedAt ?? null,
        subscription.active ? 1 : 0,
        subscription.notes ?? null,
      );

    return subscription;
  } catch (error) {
    console.error("[agentos] could not save a subscription:", error);
    return undefined;
  }
}

export function deleteSubscription(id: string): boolean {
  try {
    const result = usageDatabase()
      .prepare("DELETE FROM subscriptions WHERE id = ?")
      .run(id);

    return Number(result.changes) > 0;
  } catch (error) {
    console.error("[agentos] could not delete a subscription:", error);
    return false;
  }
}

/**
 * What a subscription costs in a single month.
 *
 * An annual plan is divided by twelve so it can sit in a monthly total.
 * Prepaid and pay-as-you-go contribute nothing recurring: money already spent
 * on credit is not a monthly charge, and counting it as one would double it
 * against the metered spend the ledger measures separately.
 */
export function monthlyCost(subscription: Subscription): number | undefined {
  if (!subscription.active) return undefined;
  if (subscription.type !== "subscription") return undefined;
  if (typeof subscription.price !== "number") return undefined;

  return subscription.billingCycle === "annual"
    ? subscription.price / 12
    : subscription.price;
}
