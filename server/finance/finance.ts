import { FinanceDataSchema, type FinanceData } from "../../shared/finance-types";
import { addMonths, computeFinance, monthName } from "./engine";
import { InvestecError, isInvestecConfigured, missingInvestecVariables, readInvestec, readInvestecBalances } from "./investec";
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
  readPartner,
  readSettlements,
  readSplitRules,
  readCorrections,
  readDecisions,
  readDismissals,
  isDismissed,
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

/** The shortest gap between two balance reads. Several open tabs must not become several reads a minute. */
const BALANCE_MIN_GAP_MS = 15_000;

let refreshingBalances: Promise<boolean> | undefined;

/**
 * Reads Investec's balances now and saves them, so what the page shows is what
 * is in the account rather than what it was at the last sync. Returns whether
 * it actually read (false when a read a moment ago is still fresh).
 *
 * Only balances: transactions wait for the regular sync. Reads only.
 */
export function refreshBalances(): Promise<boolean> {
  if (refreshingBalances) return refreshingBalances;
  if (syncing) return syncing.then(() => true);

  const last = readMeta("balancesAt");
  if (last && Date.now() - Date.parse(last) < BALANCE_MIN_GAP_MS) return Promise.resolve(false);

  refreshingBalances = (async () => {
    try {
      const { accounts, skipped } = await readInvestecBalances();
      saveSnapshot(accounts, []);
      writeMeta("balancesAt", new Date().toISOString());
      if (skipped.length > 0) console.warn(`[agentos] finance: balances skipped for ${skipped.length} account(s)`);
      return true;
    } catch (error) {
      console.error(`[agentos] finance: balance refresh failed: ${error instanceof InvestecError ? error.message : "unknown error"}`);
      throw error;
    } finally {
      refreshingBalances = undefined;
    }
  })();

  return refreshingBalances;
}

function refreshInBackground(): void {
  const last = readMeta("lastSyncAt");
  if (syncing || (last && Date.now() - Date.parse(last) < STALE_AFTER_MS)) return;
  // The page reads the cache; the refresh lands on the next poll. Failure is recorded, not thrown.
  syncFinance().catch(() => undefined);
}

/** True when there is real data to work from: Investec configured, or something saved. Sample data is not. */
export function hasRealData(): boolean {
  return isInvestecConfigured() || countTransactions() > 0 || readAccounts().length > 0;
}

const lastDayOf = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Finance as it stood on the last day of `month`: what a monthly review is written from. */
export function getFinanceForMonth(month: string): FinanceData {
  return buildFinance(lastDayOf(month), false);
}

export const getFinance = (): FinanceData => buildFinance(localToday(), true);

/**
 * `live` is the page you are looking at right now, which may kick off a sync
 * and carries last month's review. A look back at a past month is neither: it
 * must not trigger network calls or recurse.
 */
function buildFinance(today: string, live: boolean): FinanceData {
  const configured = isInvestecConfigured();
  if (configured && live) refreshInBackground();

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
    partner: readPartner(),
    splitRules: readSplitRules(),
    settlements: readSettlements(),
    today,
  });

  const narrative = readNarrative(result.month);
  const analysisNarrative = readAnalysisNarrative(result.month);
  const lastSyncAt = readMeta("lastSyncAt");
  const lastSyncError = readMeta("lastSyncError");

  // Last month's review, once there is one to show. Not on sample data, which is not anyone's month.
  let previousReview: FinanceData["previousReview"];
  if (live && !useSample) {
    const previousMonth = addMonths(result.month, -1);
    const { review } = buildFinance(lastDayOf(previousMonth), false);
    if (review.income > 0 || review.spent > 0) {
      previousReview = { review, seen: readMeta(`review-seen:${previousMonth}`) === "1", error: readMeta(`review-error:${previousMonth}`) || undefined };
    }
  }
  const all = [...result.attention];
  if (previousReview && !previousReview.seen && previousReview.review.narrative) {
    all.push({ id: "review", tone: "note", source: "Monthly review", text: `${monthName(previousReview.review.month)} review is ready`, detail: "Hermes has written last month's review.", dismissible: false, tab: "insights" });
  }

  // Dismissals hide an alert here, on the server, so Overview, Insights, Today and
  // the sidebar badge can never disagree about what is showing.
  const dismissals = readDismissals();
  const hidden = (id: string) => isDismissed(dismissals, id, today.slice(0, 7));
  const attention = all.filter((item) => !item.dismissible || !hidden(item.id));
  const dismissedAlerts = all.filter((item) => item.dismissible && hidden(item.id)).map((item) => ({ id: item.id, text: item.text, source: item.source, scope: dismissals.find((e) => e.id === item.id)?.scope ?? "month" }));
  const anomalies = result.anomalies.filter((anomaly) => !hidden(anomaly.id));

  return FinanceDataSchema.parse({
    source: {
      kind: useSample ? "sample" : accounts.some((a) => a.provider === "investec") ? "investec" : accounts.length > 0 ? "manual" : "none",
      configured,
      missing: missingInvestecVariables(),
      balancesUpdatedAt: readMeta("balancesAt") || undefined,
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
    anomalies,
    attention,
    dismissedAlerts,
    health: result.health,
    review: { ...result.review, narrative: narrative?.text, narrativeAt: narrative?.at },
    previousReview,
    investments: result.investments,
    corrections: readCorrections(),
    jev: { configured: isJevConfigured(), assessedCount: assessments.size },
    debts: result.debts,
    bills: result.bills,
    shared: result.shared,
    savings: result.savings,
    analysis: { findings: result.findings, focus: result.focus, narrative: analysisNarrative?.text, narrativeAt: analysisNarrative?.at },
  });
}
