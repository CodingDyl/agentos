/**
 * OpenRouter's balance, where it is cheap to ask for.
 *
 * The one billing integration worth building right now, because it is a single
 * authenticated GET and it answers something the operator genuinely cannot see
 * from the ledger: how much prepaid credit is left. Everything else about
 * subscriptions is entered by hand, and deliberately so — writing six billing
 * integrations to learn numbers already known is the wrong trade.
 *
 * It fails closed. No key, no network, an unreadable reply — all produce "not
 * available", never a zero balance. A screen that showed `$0.00 remaining`
 * because a request timed out would be actively misleading about whether work
 * can proceed.
 */

const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const REQUEST_TIMEOUT_MS = 8_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface OpenRouterBalance {
  /** What is left, in USD. */
  remainingUsd: number;
  totalUsd?: number;
  usedUsd?: number;
  checkedAt: string;
}

/**
 * Reads the credits payload.
 *
 * Exported so the arithmetic can be tested without a network: OpenRouter
 * reports granted and used totals rather than a remainder, so the remainder is
 * this function's own subtraction and is worth checking.
 */
export function readBalance(payload: unknown): OpenRouterBalance | undefined {
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload);
  if (!data) return undefined;

  const totalUsd =
    asNumber(data.total_credits) ?? asNumber(data.limit) ?? undefined;
  const usedUsd =
    asNumber(data.total_usage) ?? asNumber(data.usage) ?? undefined;

  // A remainder is only meaningful when both halves are known. An account with
  // no credit limit reports usage and no total, and "unlimited minus $8.92" is
  // not a balance.
  if (totalUsd === undefined || usedUsd === undefined) return undefined;

  return {
    remainingUsd: totalUsd - usedUsd,
    totalUsd,
    usedUsd,
    checkedAt: new Date().toISOString(),
  };
}

/** Asks OpenRouter what is left. `undefined` whenever it cannot be known. */
export async function getOpenRouterBalance(): Promise<
  OpenRouterBalance | undefined
> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return undefined;

  try {
    const response = await fetch(CREDITS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return undefined;

    return readBalance(await response.json());
  } catch {
    return undefined;
  }
}
