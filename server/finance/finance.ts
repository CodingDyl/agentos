import { FinanceDataSchema, type FinanceData } from "../../shared/finance-types";
import { computeFinance } from "./engine";
import { InvestecError, isInvestecConfigured, missingInvestecVariables, readInvestec } from "./investec";
import { isJevConfigured } from "../mail/jev-client";
import { readAnalysisNarrative } from "./analyser";
import { readNarrative } from "./review";
import { sampleAccounts, sampleBills, sampleGoals, sampleTransactions } from "./sample";
import {
  correctionMap,
  countTransactions,
  readAccounts,
  readAssessments,
  readBillMarks,
  readBills,
  readBudgets,
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
      // A partial read is saved, and says which account it could not read.
      writeMeta("lastSyncError", snapshot.skipped.length > 0 ? `Could not read: ${snapshot.skipped.join(", ")}.` : "");
      console.log(`[agentos] finance: synced ${snapshot.accounts.length} accounts, ${snapshot.transactions.length} transactions${snapshot.skipped.length > 0 ? `, skipped ${snapshot.skipped.length}` : ""}`);
    } catch (error) {
      const message = error instanceof InvestecError ? error.message : "Investec could not be read.";
      writeMeta("lastSyncError", message);
      // The log names the step and the bank's stated reason. Secrets are blanked before this point.
      console.error(`[agentos] finance: sync failed: ${message}`);
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

  // Real data is anything saved: Investec's, or an account you added and imported.
  const stored = countTransactions() > 0 || readAccounts().length > 0;
  const useSample = !configured && !stored;

  const accounts = useSample ? sampleAccounts() : readAccounts();
  const transactions = useSample ? sampleTransactions(today) : readTransactions();

  const goalsStored: StoredGoal[] = readGoals();
  const goals: StoredGoal[] = useSample && goalsStored.length === 0 ? sampleGoals(today) : goalsStored;

  const billsStored = readBills();
  const assessments = new Map([...readAssessments()].map(([key, value]) => [key, value.assessment]));

  const result = computeFinance({
    accounts,
    transactions,
    corrections: correctionMap(),
    decisions: readDecisions(),
    assessments,
    goals,
    budgets: readBudgets(),
    bills: useSample && billsStored.length === 0 ? sampleBills() : billsStored,
    billMarks: readBillMarks(),
    today,
  });

  const narrative = readNarrative(result.month);
  const analysisNarrative = readAnalysisNarrative(result.month);
  const lastSyncAt = readMeta("lastSyncAt");
  const lastSyncError = readMeta("lastSyncError");

  return FinanceDataSchema.parse({
    source: {
      kind: useSample ? "sample" : accounts.some((a) => a.provider === "investec") ? "investec" : accounts.length > 0 ? "manual" : "none",
      configured,
      missing: missingInvestecVariables(),
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
    split: result.split,
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
    debts: result.debts,
    bills: result.bills,
    analysis: { findings: result.findings, focus: result.focus, narrative: analysisNarrative?.text, narrativeAt: analysisNarrative?.at },
  });
}
