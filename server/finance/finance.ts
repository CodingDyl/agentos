import { FinanceDataSchema, type FinanceData, type FinancialGoal } from "../../shared/finance-types";
import { computeFinance } from "./engine";
import { InvestecError, isInvestecConfigured, readInvestec } from "./investec";
import { isJevConfigured } from "../mail/jev-client";
import { readNarrative } from "./review";
import { sampleAccounts, sampleGoals, sampleTransactions } from "./sample";
import {
  correctionMap,
  countTransactions,
  readAccounts,
  readAssessments,
  readCorrections,
  readDecisions,
  readGoals,
  readMeta,
  readTransactions,
  saveSnapshot,
  writeMeta,
  type StoredGoal,
} from "./store";

/**
 * Finance, assembled: the one read the page makes.
 *
 * Reads what the bank last told us (or, before Investec is connected, an
 * illustrative sample that is never saved), and hands it to the engine. Nothing
 * on the way in or out is a model call.
 */

const STALE_AFTER_MS = 30 * 60_000;
/** How far back the first sync reaches. Four months is enough for a typical month, a "usual", and recurring detection. */
const FIRST_SYNC_DAYS = 150;

export const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

let syncing: Promise<void> | undefined;

/** Reads from Investec and saves it. One at a time: two syncs a moment apart would just fetch the same rows twice. */
export function syncFinance(): Promise<void> {
  if (syncing) return syncing;

  syncing = (async () => {
    try {
      const lastSync = readMeta("lastSyncAt");
      // A week of overlap: rows settle late, and a re-sent row is the same row.
      const from = lastSync ? daysAgo(Math.min(FIRST_SYNC_DAYS, Math.ceil((Date.now() - Date.parse(lastSync)) / 86_400_000) + 7)) : daysAgo(FIRST_SYNC_DAYS);
      const snapshot = await readInvestec(from, localToday());
      saveSnapshot(snapshot.accounts, snapshot.transactions);
      writeMeta("lastSyncAt", new Date().toISOString());
      writeMeta("lastSyncError", "");
    } catch (error) {
      writeMeta("lastSyncError", error instanceof InvestecError ? error.message : "Investec could not be read.");
      throw error;
    } finally {
      syncing = undefined;
    }
  })();

  return syncing;
}

function refreshInBackground(): void {
  const last = readMeta("lastSyncAt");
  if (syncing || (last && Date.now() - Date.parse(last) < STALE_AFTER_MS)) return;
  // The page reads the cache; the refresh lands on the next poll. Failure is recorded, not thrown.
  syncFinance().catch(() => undefined);
}

export function getFinance(): FinanceData {
  const today = localToday();
  const configured = isInvestecConfigured();
  if (configured) refreshInBackground();

  const stored = countTransactions() > 0;
  const useSample = !configured && !stored;

  const accounts = useSample ? sampleAccounts() : readAccounts();
  const transactions = useSample ? sampleTransactions(today) : readTransactions();

  const goalsStored: StoredGoal[] = readGoals();
  const goals: (FinancialGoal & { kind: "goal" | "sinking" })[] = useSample && goalsStored.length === 0 ? sampleGoals(today) : goalsStored;

  const assessments = new Map([...readAssessments()].map(([key, value]) => [key, value.assessment]));

  const result = computeFinance({
    accounts,
    transactions,
    corrections: correctionMap(),
    decisions: readDecisions(),
    assessments,
    goals,
    today,
  });

  const narrative = readNarrative(result.month);
  const lastSyncAt = readMeta("lastSyncAt");
  const lastSyncError = readMeta("lastSyncError");

  return FinanceDataSchema.parse({
    source: {
      kind: useSample ? "sample" : accounts.length > 0 ? "investec" : "none",
      configured,
      lastSyncedAt: lastSyncAt || undefined,
      error: lastSyncError || undefined,
    },
    today,
    month: result.month,
    accounts,
    netCash: result.netCash,
    summary: result.summary,
    months: result.months,
    averageMonthlySpend: result.averageMonthlySpend,
    categories: result.categories,
    transactions: result.rows,
    subscriptions: result.subscriptions,
    subscriptionMonthly: result.subscriptionMonthly,
    subscriptionAnnual: result.subscriptionAnnual,
    subscriptionReview: result.subscriptionReview,
    goals: result.goals,
    freeCashFlow: result.freeCashFlow,
    emergencyMonths: result.emergencyMonths,
    opportunities: result.opportunities,
    anomalies: result.anomalies,
    attention: result.attention,
    health: result.health,
    review: { ...result.review, narrative: narrative?.text, narrativeAt: narrative?.at },
    investments: result.investments,
    corrections: readCorrections(),
    jev: { configured: isJevConfigured(), assessedCount: assessments.size },
  });
}
