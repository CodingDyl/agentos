import type {
  Anomaly,
  Attention,
  Debt,
  Finding,
  Category,
  CategoryTotal,
  FinanceTransactionRow,
  FinancialAccount,
  FinancialGoal,
  GoalProgress,
  HealthSignal,
  JevSubscriptionAssessment,
  MonthSummary,
  MonthlyReview,
  Opportunity,
  Subscription,
  SubscriptionDecision,
  Transaction,
} from "../../shared/finance-types";
import { CATEGORY_GROUP, formatRandAmount } from "../../shared/finance-types";
import { monthsBetween, requiredMonthly as profilerRequiredMonthly, futureValueOfContributions, futureValueOfLump, RISK_PROFILE_INFO, type RiskProfile } from "../../shared/finance-profiler";
import { analyse, buildDebts } from "./analyse";
import { guessSubscriptionKind, isInvestmentTransfer, merchantKey, ruleCategory } from "./categorise";

/**
 * Finance's arithmetic.
 *
 * Deterministic and pure: transactions in, numbers out, no clock, no network,
 * no model. Nothing here asks Jev "how much did I save?" because the answer is
 * a subtraction. Jev's part starts where arithmetic runs out (is this
 * subscription worth a second look?), and Hermes' part starts after these
 * numbers exist (say what they mean).
 *
 * Sign convention: an amount is positive when money arrives, negative when it
 * leaves.
 */

const r2 = (value: number) => Math.round(value * 100) / 100;
const r0 = (value: number) => Math.round(value);
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => (values.length === 0 ? undefined : sum(values) / values.length);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// ------------------------------------------------------------------ dates

export const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

export function monthName(month: string, style: "long" | "short" = "long"): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: style, timeZone: "UTC" });
}

// ---------------------------------------------------------- categorisation

export interface CategorisedTransaction extends Transaction {
  merchant: string;
  category: Category;
  categorySource: "rule" | "you" | "none";
  /** Own-account movement or money into investments: neither income nor spending. */
  isTransfer: boolean;
}

/** A correction wins over a rule; a rule wins over nothing; nothing stays `Other` and says so. */
export function categorise(
  transactions: readonly Transaction[],
  corrections: ReadonlyMap<string, Category>,
): CategorisedTransaction[] {
  return transactions.map((transaction) => {
    const merchant = transaction.merchant ?? transaction.description;
    const corrected = corrections.get(merchantKey(merchant));
    const byRule = ruleCategory(transaction.description, transaction.amount);
    const category: Category = corrected ?? byRule ?? "Other";

    return {
      ...transaction,
      merchant,
      category,
      categorySource: corrected ? "you" : byRule ? "rule" : "none",
      isTransfer: category === "Transfer" || isInvestmentTransfer(transaction.description),
    };
  });
}

const isIncome = (t: CategorisedTransaction) => !t.isTransfer && t.amount > 0 && t.category === "Income";
/** Spending is money out, less refunds back into a spending category. Transfers are neither. */
const isSpending = (t: CategorisedTransaction) => !t.isTransfer && t.category !== "Income";

export function summariseMonth(transactions: readonly CategorisedTransaction[], month: string): MonthSummary {
  const inMonth = transactions.filter((t) => monthOf(t.date) === month);
  const income = sum(inMonth.filter(isIncome).map((t) => t.amount));
  const spent = -sum(inMonth.filter(isSpending).map((t) => t.amount));

  return {
    month,
    income: r2(income),
    spent: r2(spent),
    saved: r2(income - spent),
    savingsRate: income > 0 ? (income - spent) / income : undefined,
  };
}

/** Months with any activity at all, oldest first, so a fresh ledger is not compared with empty history. */
function activeMonths(transactions: readonly CategorisedTransaction[]): string[] {
  return [...new Set(transactions.map((t) => monthOf(t.date)))].sort();
}

// ---------------------------------------------------------- subscriptions

/**
 * A recurring payment is only a "subscription" if it is something you could
 * cancel. A monthly pharmacy run is regular without being a service, so Health
 * only counts when it looks like a membership (a gym).
 */
const CANCELLABLE: ReadonlySet<Category> = new Set<Category>(["Subscriptions", "Business", "Other"]);

const isCancellable = (entry: { category: Category; merchant: string }) =>
  CANCELLABLE.has(entry.category) || (entry.category === "Health" && guessSubscriptionKind(entry.merchant) === "fitness");

export interface RecurringMerchant {
  key: string;
  merchant: string;
  category: Category;
  frequency: "monthly" | "annual";
  amounts: number[];
  lastPaid: string;
  payments: number;
}

/**
 * Which merchants bill on a rhythm.
 *
 * Monthly means payments 24–38 days apart, at most one a month, at a price
 * that has not swung by more than 60%: that excludes the supermarket (many a
 * month), a taxi (uneven), and a one-off. Annual means two payments about a
 * year apart. Fewer than two payments is never recurring, because one payment
 * has no rhythm to detect.
 */
export function detectRecurring(transactions: readonly CategorisedTransaction[], today: string): RecurringMerchant[] {
  const groups = new Map<string, CategorisedTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.isTransfer || transaction.amount >= 0 || transaction.category === "Income") continue;
    const key = merchantKey(transaction.merchant);
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  const found: RecurringMerchant[] = [];

  for (const [key, group] of groups) {
    const payments = [...group].sort((a, b) => a.date.localeCompare(b.date));
    if (payments.length < 2) continue;

    const gaps = payments.slice(1).map((payment, index) => daysBetween(payments[index].date, payment.date));
    const amounts = payments.map((payment) => -payment.amount);
    const typicalGap = median(gaps);
    const swing = Math.max(...amounts) / Math.min(...amounts);
    const months = payments.map((payment) => monthOf(payment.date));
    const oneAMonth = new Set(months).size === months.length;
    const last = payments[payments.length - 1];

    let frequency: "monthly" | "annual" | undefined;
    if (typicalGap >= 24 && typicalGap <= 38 && oneAMonth && swing <= 1.6) frequency = "monthly";
    else if (typicalGap >= 350 && typicalGap <= 380 && swing <= 1.6) frequency = "annual";
    if (!frequency) continue;

    // Still running: a monthly payment missed by more than a fortnight has stopped.
    const sinceLast = daysBetween(last.date, today);
    if (frequency === "monthly" && sinceLast > 52) continue;
    if (frequency === "annual" && sinceLast > 400) continue;

    found.push({ key, merchant: last.merchant, category: last.category, frequency, amounts, lastPaid: last.date, payments: payments.length });
  }

  return found;
}

/** A change in what a subscription charges: the latest price against the last different one. */
function previousPrice(amounts: readonly number[]): number | undefined {
  const latest = amounts[amounts.length - 1];
  for (let index = amounts.length - 2; index >= 0; index -= 1) {
    if (Math.abs(amounts[index] - latest) / latest > 0.01) {
      // Only a recent change is news; last year's rise is just the price.
      return amounts.length - 1 - index <= 2 ? amounts[index] : undefined;
    }
  }
  return undefined;
}

/** Jev's priority sorts a subscription into a tier. With no assessment there is no tier: it says so. */
function tierFor(assessment: JevSubscriptionAssessment | undefined, decision: SubscriptionDecision["decision"] | undefined): Subscription["tier"] {
  if (decision === "keep") return "low";
  if (!assessment) return "unassessed";
  if (assessment.priority >= 4) return "high";
  if (assessment.priority >= 3) return "medium";
  return "low";
}

export function buildSubscriptions(
  recurring: readonly RecurringMerchant[],
  decisions: ReadonlyMap<string, { decision: NonNullable<SubscriptionDecision["decision"]>; note?: string }>,
  assessments: ReadonlyMap<string, JevSubscriptionAssessment>,
): Subscription[] {
  return recurring
    .filter(isCancellable)
    .flatMap((entry): Subscription[] => {
      const decision = decisions.get(entry.key);
      if (decision?.decision === "cancelled") return [];

      const latest = entry.amounts[entry.amounts.length - 1];
      const assessment = assessments.get(entry.key);
      const monthly = entry.frequency === "annual" ? latest / 12 : latest;

      return [
        {
          merchant: entry.merchant,
          monthly: r2(monthly),
          annual: r2(monthly * 12),
          frequency: entry.frequency,
          lastPaid: entry.lastPaid,
          payments: entry.payments,
          previousAmount: previousPrice(entry.amounts),
          kind: assessment?.kind ?? guessSubscriptionKind(entry.merchant),
          decision: decision?.decision,
          decisionNote: decision?.note,
          assessment,
          tier: tierFor(assessment, decision?.decision),
        },
      ];
    })
    .sort((a, b) => b.monthly - a.monthly);
}

const TIER_ORDER = { high: 0, medium: 1, low: 2, unassessed: 3 } as const;

export function sortSubscriptions(subscriptions: readonly Subscription[]): Subscription[] {
  return [...subscriptions].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.monthly - a.monthly);
}

/** What cancelling the review candidates would save. A candidate is Jev-ranked high or medium, and not marked keep. */
export function reviewSavings(subscriptions: readonly Subscription[]) {
  const candidates = subscriptions.filter((s) => (s.tier === "high" || s.tier === "medium") && s.decision !== "keep");
  const monthly = sum(candidates.map((s) => s.monthly));
  return { count: candidates.length, monthly: r2(monthly), annual: r2(monthly * 12) };
}

// ------------------------------------------------------------------ goals

/** A stored goal: the shared fields, its kind, and how its money is held. */
export type EngineGoal = FinancialGoal & { kind: "goal" | "sinking"; riskProfile?: RiskProfile; annualReturn?: number };

export function goalProgress(
  goals: readonly EngineGoal[],
  freeCashFlow: number | undefined,
  today: string,
): GoalProgress[] {
  const dated = goals.filter((goal) => goal.targetDate && goal.targetAmount > goal.currentAmount);
  // One pot of free cash flow, shared evenly. It is an assumption, and the page says so.
  const share = freeCashFlow !== undefined && freeCashFlow > 0 && dated.length > 0 ? freeCashFlow / dated.length : undefined;

  return goals.map((goal) => {
    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    const progress = goal.targetAmount > 0 ? Math.min(1, goal.currentAmount / goal.targetAmount) : 0;
    const base = { ...goal, remaining: r2(remaining), progress };

    if (remaining === 0) return { ...base, status: "done" as const };
    if (!goal.targetDate) return { ...base, status: "no-date" as const };

    const days = daysBetween(today, goal.targetDate);
    if (days <= 0) return { ...base, status: "overdue" as const };

    const monthsLeft = days / 30.4375;
    const months = monthsBetween(today, goal.targetDate);
    // No profile means no growth is assumed: the cautious reading, and the one the page names.
    const assumedReturn = goal.annualReturn ?? (goal.riskProfile ? RISK_PROFILE_INFO[goal.riskProfile].annualReturn : 0);

    const required = profilerRequiredMonthly({ target: goal.targetAmount, saved: goal.currentAmount, annualReturn: assumedReturn, months });
    const requiredNoGrowth = profilerRequiredMonthly({ target: goal.targetAmount, saved: goal.currentAmount, annualReturn: 0, months });
    // Past the target is not a projection anyone needs: it reached it.
    const projected = Math.min(
      goal.targetAmount,
      futureValueOfLump(goal.currentAmount, assumedReturn, months) + (share === undefined ? 0 : futureValueOfContributions(share, assumedReturn, months)),
    );
    const shortfall = Math.max(0, goal.targetAmount - projected);

    return {
      ...base,
      monthsLeft,
      requiredMonthly: r0(required),
      requiredMonthlyNoGrowth: r0(requiredNoGrowth),
      assumedReturn,
      paceMonthly: share === undefined ? undefined : r0(share),
      projected: r0(projected),
      shortfall: r0(shortfall),
      extraMonthlyNeeded: r0(Math.max(0, required - (share ?? 0))),
      status: shortfall <= 0 ? ("on-track" as const) : ("behind" as const),
    };
  });
}

// ------------------------------------------------------------ opportunities

/** Categories where a cut is a choice rather than a bill. */
const DISCRETIONARY: readonly Category[] = ["Shopping", "Entertainment", "Personal care", "Other"];

export function findOpportunities(
  categories: readonly CategoryTotal[],
  review: { monthly: number; count: number },
): Opportunity[] {
  const found: Opportunity[] = [];

  if (review.monthly >= 50) {
    found.push({ id: "subscriptions", label: `Review ${review.count} ${review.count === 1 ? "subscription" : "subscriptions"}`, monthly: r0(review.monthly) });
  }

  const dining = categories.find((c) => c.category === "Dining");
  if (dining) {
    // Twenty percent of what dining usually costs, not of a bad month.
    const base = dining.typical ?? dining.amount;
    if (base * 0.2 >= 50) found.push({ id: "dining", label: "Reduce dining by 20%", monthly: r0(base * 0.2) });
  }

  const discretionary = sum(categories.filter((c) => DISCRETIONARY.includes(c.category)).map((c) => c.amount));
  if (discretionary * 0.15 >= 50) found.push({ id: "discretionary", label: "Reduce shopping, entertainment and other spend by 15%", monthly: r0(discretionary * 0.15) });

  return found;
}

// ------------------------------------------------------------- anomalies

const NOT_UNUSUAL: ReadonlySet<Category> = new Set<Category>(["Housing", "Utilities", "Debt", "Insurance", "Education", "Transfer", "Income", "Travel"]);

export function findAnomalies(
  transactions: readonly CategorisedTransaction[],
  categories: readonly CategoryTotal[],
  month: string,
): Anomaly[] {
  const found: Anomaly[] = [];

  const thisMonth = transactions.filter((t) => monthOf(t.date) === month && t.amount < 0 && !t.isTransfer && !NOT_UNUSUAL.has(t.category));
  const before = transactions.filter((t) => monthOf(t.date) < month && t.amount < 0);
  const flaggedByCategory = new Map<Category, number>();

  for (const transaction of thisMonth) {
    const amount = -transaction.amount;
    if (amount < 1000) continue;

    const key = merchantKey(transaction.merchant);
    const history = before.filter((t) => merchantKey(t.merchant) === key).map((t) => -t.amount);
    const unseen = history.length === 0;
    const outlier = !unseen && amount >= 3 * median(history);

    if (unseen || outlier) {
      flaggedByCategory.set(transaction.category, (flaggedByCategory.get(transaction.category) ?? 0) + amount);
      found.push({
        id: `transaction:${transaction.id}`,
        kind: "transaction",
        title: `${formatRandAmount(amount)} at ${transaction.merchant}`,
        detail: unseen ? "First payment to this merchant, and a large one." : `About ${Math.round(amount / median(history))}x what you usually pay here.`,
        transactionId: transaction.id,
        merchant: transaction.merchant,
        amount,
      });
    }
  }

  // A category is "above usual" for its own reasons. If one flagged payment is
  // the whole excess, that payment already has its own alert, and saying it twice is noise.
  for (const category of categories) {
    if (category.typical === undefined) continue;
    const amount = category.amount - (flaggedByCategory.get(category.category) ?? 0);
    const change = category.typical > 0 ? (amount - category.typical) / category.typical : undefined;
    if (change !== undefined && change >= 0.3 && amount - category.typical >= 300) {
      found.push({
        id: `category:${category.category}`,
        kind: "category",
        title: `${category.category} is ${Math.round(change * 100)}% above usual`,
        detail: `${formatRandAmount(amount)} this month against ${formatRandAmount(category.typical)} typically.`,
      });
    }
  }

  return found.slice(0, 6);
}

// ------------------------------------------------------- categories, health

export function categoryTotals(
  transactions: readonly CategorisedTransaction[],
  month: string,
  budgets: ReadonlyMap<Category, number> = new Map(),
): CategoryTotal[] {
  const history = activeMonths(transactions).filter((m) => m < month).slice(-3);
  const totalFor = (target: string, category: Category) =>
    -sum(transactions.filter((t) => monthOf(t.date) === target && t.category === category && isSpending(t)).map((t) => t.amount));

  const spendingThisMonth = transactions.filter((t) => monthOf(t.date) === month && isSpending(t));
  // A category with a budget is shown even before anything is spent in it.
  const categories = [...new Set([...spendingThisMonth.map((t) => t.category), ...budgets.keys()])];

  return categories
    .map((category) => {
      const amount = totalFor(month, category);
      const typical = history.length > 0 ? mean(history.map((m) => totalFor(m, category))) : undefined;
      const change = typical !== undefined && typical > 0 ? (amount - typical) / typical : undefined;

      // Where it went: the biggest merchants, so "Groceries R4,400" can be opened up.
      const byMerchant = new Map<string, { merchant: string; amount: number; payments: number }>();
      for (const t of spendingThisMonth.filter((entry) => entry.category === category)) {
        const key = merchantKey(t.merchant);
        const entry = byMerchant.get(key) ?? { merchant: t.merchant, amount: 0, payments: 0 };
        entry.amount += -t.amount;
        entry.payments += 1;
        byMerchant.set(key, entry);
      }
      const merchants = [...byMerchant.values()]
        .map((entry) => ({ ...entry, amount: r2(entry.amount) }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6);

      // `+ 0` turns the -0 that negating an empty sum gives into a plain 0.
      return { category, amount: r2(amount) + 0, typical: typical === undefined ? undefined : r2(typical), change, budget: budgets.get(category), merchants };
    })
    .filter((entry) => entry.amount > 0 || entry.budget !== undefined)
    .sort((a, b) => b.amount - a.amount);
}

/** Where each rand of income went: needs, wants, business, unsorted, and what was left. */
export function incomeSplit(categories: readonly CategoryTotal[], summary: MonthSummary) {
  const groupTotal = (group: "needs" | "wants" | "business" | "unsorted") =>
    r2(sum(categories.filter((entry) => entry.category !== "Income" && entry.category !== "Transfer" && CATEGORY_GROUP[entry.category] === group).map((entry) => entry.amount)));

  return {
    income: summary.income,
    needs: groupTotal("needs"),
    wants: groupTotal("wants"),
    business: groupTotal("business"),
    unsorted: groupTotal("unsorted"),
    saved: summary.saved,
  };
}

export function buildReview(input: {
  month: string;
  summaries: readonly MonthSummary[];
  categories: readonly CategoryTotal[];
  previousCategories: readonly CategoryTotal[];
  subscriptions: readonly Subscription[];
  goals: readonly GoalProgress[];
  anomalies: readonly Anomaly[];
}): MonthlyReview {
  const current = input.summaries.find((s) => s.month === input.month) ?? { month: input.month, income: 0, spent: 0, saved: 0 };
  const previous = input.summaries.find((s) => s.month === addMonths(input.month, -1));

  const changes = input.categories
    .flatMap((category) => {
      const before = input.previousCategories.find((c) => c.category === category.category)?.amount ?? 0;
      if (before < 200 || category.amount < 200) return [];
      const change = (category.amount - before) / before;
      return Math.abs(change) >= 0.1 ? [{ label: category.category, change }] : [];
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 4);

  const good: string[] = [];
  const review: string[] = [];
  const focus: string[] = [];

  if (previous?.savingsRate !== undefined && current.savingsRate !== undefined && current.savingsRate > previous.savingsRate + 0.01) good.push("Savings rate increased");
  if (input.anomalies.every((a) => a.kind !== "transaction")) good.push("No unusual large expenses");
  const onTrack = input.goals.filter((g) => g.status === "on-track");
  for (const goal of onTrack) good.push(`${goal.name} remains achievable`);

  const flagged = input.subscriptions.filter((s) => s.tier === "high" && s.decision !== "keep");
  if (flagged.length > 0) review.push(`${flagged.length} recurring ${flagged.length === 1 ? "service appears" : "services appear"} underused`);
  for (const change of changes.filter((c) => c.change >= 0.2)) review.push(`${change.label} is up ${Math.round(change.change * 100)}% on last month`);
  for (const goal of input.goals.filter((g) => g.status === "behind")) review.push(`${goal.name} is behind plan by ${formatRandAmount(goal.shortfall ?? 0)}`);

  for (const goal of input.goals.filter((g) => g.requiredMonthly !== undefined && g.status !== "done")) {
    focus.push(`Put ${formatRandAmount(goal.requiredMonthly ?? 0)} a month towards ${goal.name}.`);
  }
  if (flagged.length > 0) focus.push(`Review the ${flagged.length} flagged ${flagged.length === 1 ? "subscription" : "subscriptions"}.`);

  return { month: input.month, income: current.income, spent: current.spent, saved: current.saved, changes, good, review, focus };
}

// ------------------------------------------------------------------ overall

export interface EngineInput {
  accounts: readonly FinancialAccount[];
  transactions: readonly Transaction[];
  corrections: ReadonlyMap<string, Category>;
  decisions: ReadonlyMap<string, { decision: NonNullable<SubscriptionDecision["decision"]>; note?: string }>;
  assessments: ReadonlyMap<string, JevSubscriptionAssessment>;
  goals: readonly EngineGoal[];
  budgets?: ReadonlyMap<Category, number>;
  /** `YYYY-MM-DD`. */
  today: string;
}

export interface EngineOutput {
  month: string;
  netCash: number;
  summary: MonthSummary;
  months: MonthSummary[];
  averageMonthlySpend?: number;
  categories: CategoryTotal[];
  split: ReturnType<typeof incomeSplit>;
  rows: FinanceTransactionRow[];
  subscriptions: Subscription[];
  subscriptionMonthly: number;
  subscriptionAnnual: number;
  subscriptionReview: { count: number; monthly: number; annual: number };
  goals: GoalProgress[];
  freeCashFlow?: number;
  emergencyMonths?: number;
  opportunities: Opportunity[];
  anomalies: Anomaly[];
  attention: Attention[];
  health: HealthSignal[];
  review: MonthlyReview;
  investments: { portfolioValue?: number; monthlyContribution?: number };
  debts: Debt[];
  findings: Finding[];
  focus: string[];
}

export function computeFinance(input: EngineInput): EngineOutput {
  const month = monthOf(input.today);
  const ledger = categorise(input.transactions, input.corrections);

  const recurring = detectRecurring(ledger, input.today);
  const recurringKeys = new Set(recurring.map((entry) => entry.key));

  const window = Array.from({ length: 6 }, (_, index) => addMonths(month, index - 5));
  const months = window.map((m) => summariseMonth(ledger, m));
  const summary = months[months.length - 1];

  // Complete months only: this month is still being spent.
  const complete = months.filter((m) => m.month < month && ledger.some((t) => monthOf(t.date) === m.month));
  const lastThree = complete.slice(-3);
  const averageMonthlySpend = mean(lastThree.map((m) => m.spent));
  const freeCashFlow = lastThree.length > 0 ? r0(mean(lastThree.map((m) => m.saved)) ?? 0) : undefined;

  const cashAccounts = input.accounts.filter((account) => account.type !== "investment");
  const netCash = r2(sum(cashAccounts.map((account) => account.balance)));

  const categories = categoryTotals(ledger, month, input.budgets);
  const previousCategories = categoryTotals(ledger, addMonths(month, -1));

  const subscriptions = sortSubscriptions(buildSubscriptions(recurring, input.decisions, input.assessments));
  const subscriptionMonthly = r2(sum(subscriptions.map((s) => s.monthly)));
  const subscriptionReview = reviewSavings(subscriptions);

  const goals = goalProgress(input.goals, freeCashFlow, input.today);
  const anomalies = findAnomalies(ledger, categories, month);
  const opportunities = findOpportunities(categories, subscriptionReview);

  const emergency = goals.find((goal) => goal.type === "emergency");
  const emergencyMonths = emergency && averageMonthlySpend && averageMonthlySpend > 0 ? emergency.currentAmount / averageMonthlySpend : undefined;

  const flaggedIds = new Set(anomalies.map((a) => a.transactionId).filter((id): id is string => Boolean(id)));
  const accountNames = new Map(input.accounts.map((account) => [account.id, account.name]));
  const rows: FinanceTransactionRow[] = [...ledger]
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(0, 120)
    .map((t) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: accountNames.get(t.accountId) ?? "Account",
      date: t.date,
      description: t.description,
      amount: t.amount,
      merchant: t.merchant,
      category: t.category,
      recurring: recurringKeys.has(merchantKey(t.merchant)) || undefined,
      categorySource: t.categorySource,
      flagged: flaggedIds.has(t.id),
    }));

  const portfolioValue = input.accounts.filter((a) => a.type === "investment");
  const contribution = -sum(ledger.filter((t) => monthOf(t.date) === month && t.amount < 0 && isInvestmentTransfer(t.description)).map((t) => t.amount));

  const investments = {
    portfolioValue: portfolioValue.length > 0 ? r2(sum(portfolioValue.map((a) => a.balance))) : undefined,
    monthlyContribution: contribution > 0 ? r2(contribution) : undefined,
  };

  const review = buildReview({
    month,
    summaries: months,
    categories,
    previousCategories,
    subscriptions,
    goals,
    anomalies,
  });

  const debts = buildDebts(input.accounts, freeCashFlow);
  const split = incomeSplit(categories, summary);
  const analysis = analyse({
    accounts: input.accounts,
    summary,
    months,
    split,
    categories,
    subscriptions,
    subscriptionMonthly,
    goals,
    debts,
    averageMonthlySpend,
    freeCashFlow,
    month,
  });

  const attention = buildAttention({ today: input.today, subscriptions, categories, goals, anomalies, uncategorised: rows.filter((r) => r.categorySource === "none" && r.amount < 0).length });
  const health = buildHealth({ summary, emergencyMonths, subscriptionMonthly, goals, investments });

  return {
    month,
    netCash,
    summary,
    months,
    averageMonthlySpend: averageMonthlySpend === undefined ? undefined : r2(averageMonthlySpend),
    categories,
    split,
    rows,
    subscriptions,
    subscriptionMonthly,
    subscriptionAnnual: r2(subscriptionMonthly * 12),
    subscriptionReview,
    goals,
    freeCashFlow,
    emergencyMonths,
    opportunities,
    anomalies,
    attention,
    health,
    review,
    investments,
    debts,
    findings: analysis.findings,
    focus: analysis.focus,
  };
}

export function buildAttention(input: {
  today: string;
  subscriptions: readonly Subscription[];
  categories: readonly CategoryTotal[];
  goals: readonly GoalProgress[];
  anomalies: readonly Anomaly[];
  uncategorised: number;
}): Attention[] {
  const attention: Attention[] = [];

  const raised = input.subscriptions.filter((s) => s.previousAmount !== undefined && s.decision !== "keep" && s.monthly > (s.frequency === "annual" ? s.previousAmount / 12 : s.previousAmount));
  if (raised.length === 1) {
    const [only] = raised;
    const rise = only.monthly - (only.frequency === "annual" ? (only.previousAmount ?? 0) / 12 : (only.previousAmount ?? 0));
    attention.push({ id: `price:${only.merchant}`, tone: "warn", text: `${only.merchant} increased ${formatRandAmount(rise)} a month`, tab: "subscriptions" });
  } else if (raised.length > 1) {
    attention.push({ id: "price", tone: "warn", text: `${raised.length} subscriptions increased in price`, tab: "subscriptions" });
  }

  for (const anomaly of input.anomalies) {
    attention.push({ id: anomaly.id, tone: "warn", text: anomaly.kind === "category" ? anomaly.title : `Unusual charge: ${anomaly.title}`, tab: anomaly.kind === "category" ? "spending" : "insights" });
  }

  for (const goal of input.goals.filter((g) => g.status === "behind")) {
    attention.push({ id: `goal:${goal.id}`, tone: "note", text: `${goal.name} goal behind plan by ${formatRandAmount(goal.shortfall ?? 0)}`, tab: "goals" });
  }
  for (const goal of input.goals.filter((g) => g.status === "overdue")) {
    attention.push({ id: `goal:${goal.id}`, tone: "note", text: `${goal.name} passed its date with ${formatRandAmount(goal.remaining)} to go`, tab: "goals" });
  }

  if (input.uncategorised >= 3) {
    attention.push({ id: "uncategorised", tone: "note", text: `${input.uncategorised} payments need a category`, tab: "spending" });
  }

  const day = Number(input.today.slice(8, 10));
  if (day >= 25) attention.push({ id: "review", tone: "note", text: `${monthName(monthOf(input.today))} review is ready`, tab: "insights" });

  return attention;
}

export function buildHealth(input: {
  summary: MonthSummary;
  emergencyMonths: number | undefined;
  subscriptionMonthly: number;
  goals: readonly GoalProgress[];
  investments: { monthlyContribution?: number };
}): HealthSignal[] {
  const { summary } = input;
  const signals: HealthSignal[] = [];

  signals.push({
    id: "cash-flow",
    label: "Cash flow",
    value: summary.income === 0 && summary.spent === 0 ? "No data yet" : summary.saved >= 0 ? "Healthy" : "Spending more than coming in",
    tone: summary.income === 0 && summary.spent === 0 ? "neutral" : summary.saved >= 0 ? "good" : "warn",
  });

  signals.push({
    id: "buffer",
    label: "Emergency buffer",
    value: input.emergencyMonths === undefined ? "Set an emergency goal" : `${input.emergencyMonths.toFixed(1)} months`,
    tone: input.emergencyMonths === undefined ? "neutral" : input.emergencyMonths >= 3 ? "good" : "warn",
  });

  signals.push({
    id: "savings-rate",
    label: "Savings rate",
    value: summary.savingsRate === undefined ? "-" : `${Math.round(summary.savingsRate * 100)}%`,
    tone: summary.savingsRate === undefined ? "neutral" : summary.savingsRate >= 0.2 ? "good" : "warn",
  });

  const heavy = summary.income > 0 && input.subscriptionMonthly / summary.income > 0.08;
  signals.push({
    id: "subscriptions",
    label: "Subscriptions",
    value: `${formatRandAmount(input.subscriptionMonthly)} / month`,
    tone: heavy ? "warn" : "neutral",
  });

  const dated = input.goals.filter((g) => g.status === "on-track" || g.status === "behind" || g.status === "overdue");
  if (dated.length > 0) {
    const worst = dated.some((g) => g.status !== "on-track");
    signals.push({ id: "goals", label: "Goals", value: worst ? "Behind on some" : "On track", tone: worst ? "warn" : "good" });
  }

  signals.push({
    id: "investing",
    label: "Investments",
    value: input.investments.monthlyContribution === undefined ? "No contribution this month" : `${formatRandAmount(input.investments.monthlyContribution)} / month`,
    tone: "neutral",
  });

  return signals;
}
