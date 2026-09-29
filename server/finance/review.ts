import type { FinanceData, MonthlyReview } from "../../shared/finance-types";
import { formatRandAmount } from "../../shared/finance-types";
import { HermesError, sendToHermes } from "../hermes/client";
import { monthName } from "./engine";
import { readMeta, writeMeta } from "./store";

/**
 * The monthly review, explained.
 *
 * The numbers come from `engine.ts` and are already in `MonthlyReview`. Hermes
 * is given those numbers and asked to say what they mean. It is told not to
 * calculate, not to add figures, and not to recommend any purchase, and it is
 * handed no merchant-level transactions, balances or identifiers: just the
 * month's totals, category movement and the plain findings the engine derived.
 */

const REVIEW_TIMEOUT_MS = 120_000;

const SYSTEM = [
  "You write a short monthly money review for one person, from figures that have already been calculated.",
  "Use only the figures you are given. Do not calculate new figures, round differently, or estimate anything.",
  "Never recommend buying, selling or moving money into any investment, and never tell the person what to cancel: you may say what deserves a look.",
  "Plain text. Four short sections with these exact headings on their own line: What changed, Going well, Worth a look, Next month. A sentence or two each, no bullet symbols.",
].join(" ");

export function buildReviewPacket(review: MonthlyReview, extra: { subscriptionMonthly: number; goalLines: string[] }): string {
  const rate = review.income > 0 ? `${Math.round((review.saved / review.income) * 100)}%` : "unknown";
  return [
    `Review of ${monthName(review.month)}.`,
    `Income ${formatRandAmount(review.income)}. Spent ${formatRandAmount(review.spent)}. Saved ${formatRandAmount(review.saved)}. Savings rate ${rate}.`,
    `Recurring subscriptions total ${formatRandAmount(extra.subscriptionMonthly)} a month.`,
    review.changes.length > 0
      ? `Category changes against last month: ${review.changes.map((change) => `${change.label} ${change.change > 0 ? "+" : ""}${Math.round(change.change * 100)}%`).join(", ")}.`
      : "No category moved by 10% or more.",
    review.good.length > 0 ? `Going well: ${review.good.join("; ")}.` : "",
    review.review.length > 0 ? `Worth a look: ${review.review.join("; ")}.` : "",
    extra.goalLines.length > 0 ? `Goals: ${extra.goalLines.join("; ")}.` : "",
    review.focus.length > 0 ? `Planned focus: ${review.focus.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class ReviewError extends Error {}

export function readNarrative(month: string): { text: string; at: string } | undefined {
  const raw = readMeta(`review:${month}`);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; at?: unknown };
    return typeof parsed.text === "string" && typeof parsed.at === "string" ? { text: parsed.text, at: parsed.at } : undefined;
  } catch {
    return undefined;
  }
}

/** Asks Hermes to explain this month's review, and keeps the answer. Runs only when asked. */
export async function writeNarrative(data: FinanceData): Promise<{ text: string; at: string }> {
  const goalLines = data.goals.map((goal) => `${goal.name} ${Math.round(goal.progress * 100)}% funded, ${goal.status.replace("-", " ")}`);

  let reply: string;
  try {
    reply = await sendToHermes(buildReviewPacket(data.review, { subscriptionMonthly: data.subscriptionMonthly, goalLines }), {
      operation: "other",
      timeoutMs: REVIEW_TIMEOUT_MS,
      system: SYSTEM,
    });
  } catch (error) {
    throw new ReviewError(error instanceof HermesError ? error.message : "Hermes could not be reached.");
  }

  const text = reply.trim();
  if (!text) throw new ReviewError("Hermes answered with nothing to keep.");

  const saved = { text, at: new Date().toISOString() };
  writeMeta(`review:${data.month}`, JSON.stringify(saved));
  return saved;
}
