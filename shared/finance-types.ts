import { z } from "zod";

/**
 * Finance's contract, shared by the server and the page.
 *
 * Sign convention: an `amount` is money in (positive) or money out (negative),
 * in the account's currency, to the cent. Everything Finance shows is derived
 * from transactions by `server/finance/engine.ts`; nothing here is a balance
 * somebody typed in.
 *
 * What is deliberately absent: account numbers, logins and API secrets. An
 * account carries at most the last four digits of its number, so nothing in
 * this file can put a full account number in front of a model.
 */

export const FinancialAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(["investec", "sample"]),
  name: z.string(),
  type: z.enum(["current", "savings", "credit", "investment"]),
  currency: z.string(),
  balance: z.number(),
  /** Last four digits only, for telling two accounts apart on screen. */
  mask: z.string().optional(),
});

export const TransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  /** `YYYY-MM-DD`. */
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  merchant: z.string().optional(),
  category: z.string().optional(),
  recurring: z.boolean().optional(),
});

export const GOAL_TYPES = ["travel", "emergency", "purchase", "investment", "other"] as const;

export const FinancialGoalSchema = z.object({
  id: z.string(),
  name: z.string(),
  targetAmount: z.number(),
  currentAmount: z.number(),
  /** `YYYY-MM-DD`. */
  targetDate: z.string().optional(),
  type: z.enum(GOAL_TYPES),
});

export type FinancialAccount = z.infer<typeof FinancialAccountSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type FinancialGoal = z.infer<typeof FinancialGoalSchema>;
export type GoalType = (typeof GOAL_TYPES)[number];

/**
 * The spending categories. `Transfer` is money moving between a person's own
 * accounts and `Income` is money arriving: neither is spending, so the engine
 * counts them separately.
 */
export const CATEGORIES = [
  "Income",
  "Transfer",
  "Housing",
  "Groceries",
  "Dining",
  "Transport",
  "Subscriptions",
  "Health",
  "Shopping",
  "Travel",
  "Business",
  "Insurance",
  "Fees",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CategorySchema = z.enum(CATEGORIES);

export const SUBSCRIPTION_KINDS = ["software", "entertainment", "business", "fitness", "finance", "other"] as const;
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];

// ---------------------------------------------------------------- writes

/** Move a merchant into a category. Remembered, and applied to every past and future payment. */
export const CategoryCorrectionSchema = z.object({
  merchant: z.string().min(1).max(120),
  category: CategorySchema,
  /** `Personal` or `Business`, when the person said. */
  scope: z.enum(["personal", "business"]).optional(),
});
export type CategoryCorrection = z.infer<typeof CategoryCorrectionSchema>;

/** What the person decided about a subscription. `keep` stops Finance nagging about it. */
export const SubscriptionDecisionSchema = z.object({
  merchant: z.string().min(1).max(120),
  decision: z.enum(["keep", "reviewing", "cancelled"]).nullable(),
  note: z.string().max(200).optional(),
});
export type SubscriptionDecision = z.infer<typeof SubscriptionDecisionSchema>;

export const GoalInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  targetAmount: z.number().positive().max(1_000_000_000),
  currentAmount: z.number().min(0).max(1_000_000_000).default(0),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  type: z.enum(GOAL_TYPES).default("other"),
  /** A sinking fund reserves money for an expense you know is coming, rather than chasing a milestone. */
  kind: z.enum(["goal", "sinking"]).default("goal"),
});
export type GoalInput = z.infer<typeof GoalInputSchema>;

export const GoalPatchSchema = GoalInputSchema.partial();
export type GoalPatch = z.infer<typeof GoalPatchSchema>;

// ----------------------------------------------------------------- reads

export const FinanceSourceSchema = z.object({
  /**
   * `investec`: live from the bank. `sample`: an illustrative set, shown only
   * while Investec is not connected and never written to disk. `none`: nothing
   * to show.
   */
  kind: z.enum(["investec", "sample", "none"]),
  configured: z.boolean(),
  /** Names of the Investec variables that are not set. Names only, never values. */
  missing: z.array(z.string()).default([]),
  lastSyncedAt: z.string().optional(),
  error: z.string().optional(),
});
export type FinanceSource = z.infer<typeof FinanceSourceSchema>;

export const MonthSummarySchema = z.object({
  /** `YYYY-MM`. */
  month: z.string(),
  income: z.number(),
  spent: z.number(),
  saved: z.number(),
  /** 0–1, or undefined when nothing came in and the ratio has no meaning. */
  savingsRate: z.number().optional(),
});
export type MonthSummary = z.infer<typeof MonthSummarySchema>;

export const CategoryTotalSchema = z.object({
  category: CategorySchema,
  amount: z.number(),
  /** The average of the previous three months, when there are that many to compare with. */
  typical: z.number().optional(),
  /** `(amount - typical) / typical`. */
  change: z.number().optional(),
});
export type CategoryTotal = z.infer<typeof CategoryTotalSchema>;

export const JevSubscriptionAssessmentSchema = z.object({
  recurring: z.boolean(),
  kind: z.enum(SUBSCRIPTION_KINDS),
  /** 1–5. */
  essential: z.number(),
  /** 1–5. */
  underused: z.number(),
  duplicate: z.boolean(),
  /** 1–5: how much this deserves a look. */
  priority: z.number(),
  /** Jev's confidence in the priority, 0–1. */
  confidence: z.number(),
  assessedAt: z.string(),
});
export type JevSubscriptionAssessment = z.infer<typeof JevSubscriptionAssessmentSchema>;

export const SubscriptionSchema = z.object({
  merchant: z.string(),
  monthly: z.number(),
  annual: z.number(),
  frequency: z.enum(["monthly", "annual"]),
  lastPaid: z.string(),
  payments: z.number(),
  /** The amount before the latest change, when the price moved. */
  previousAmount: z.number().optional(),
  kind: z.enum(SUBSCRIPTION_KINDS),
  decision: z.enum(["keep", "reviewing", "cancelled"]).optional(),
  decisionNote: z.string().optional(),
  assessment: JevSubscriptionAssessmentSchema.optional(),
  /** Which review tier it falls in: from Jev's priority, never from a guess. */
  tier: z.enum(["high", "medium", "low", "unassessed"]),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const GoalProgressSchema = FinancialGoalSchema.extend({
  kind: z.enum(["goal", "sinking"]),
  remaining: z.number(),
  /** 0–1. */
  progress: z.number(),
  monthsLeft: z.number().optional(),
  /** What has to go in each month to arrive on the date. Undefined without a date. */
  requiredMonthly: z.number().optional(),
  /** Where the current pace lands on the date, from recent free cash flow shared with other goals. */
  projected: z.number().optional(),
  /** `max(0, target - projected)`. */
  shortfall: z.number().optional(),
  /** This goal's share of recent free cash flow, per month. */
  paceMonthly: z.number().optional(),
  /** What would have to be found on top of the pace, per month, to arrive on the date. */
  extraMonthlyNeeded: z.number().optional(),
  status: z.enum(["done", "on-track", "behind", "no-date", "overdue"]),
});
export type GoalProgress = z.infer<typeof GoalProgressSchema>;

export const OpportunitySchema = z.object({
  id: z.string(),
  label: z.string(),
  monthly: z.number(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const AnomalySchema = z.object({
  id: z.string(),
  kind: z.enum(["category", "transaction"]),
  title: z.string(),
  detail: z.string(),
  /** For a transaction: the id, so it can be classified. */
  transactionId: z.string().optional(),
  merchant: z.string().optional(),
  amount: z.number().optional(),
});
export type Anomaly = z.infer<typeof AnomalySchema>;

export const AttentionSchema = z.object({
  id: z.string(),
  tone: z.enum(["warn", "note"]),
  text: z.string(),
  /** Which tab it points at. */
  tab: z.enum(["overview", "cash-flow", "spending", "subscriptions", "goals", "investments", "insights", "settings"]),
});
export type Attention = z.infer<typeof AttentionSchema>;

export const HealthSignalSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  tone: z.enum(["good", "warn", "neutral"]),
});
export type HealthSignal = z.infer<typeof HealthSignalSchema>;

export const MonthlyReviewSchema = z.object({
  month: z.string(),
  income: z.number(),
  spent: z.number(),
  saved: z.number(),
  /** Category movement against the month before, largest first. */
  changes: z.array(z.object({ label: z.string(), change: z.number() })),
  good: z.array(z.string()),
  review: z.array(z.string()),
  focus: z.array(z.string()),
  /** Hermes' prose over the numbers above, once asked for. */
  narrative: z.string().optional(),
  narrativeAt: z.string().optional(),
});
export type MonthlyReview = z.infer<typeof MonthlyReviewSchema>;

export const FinanceTransactionRowSchema = TransactionSchema.extend({
  accountName: z.string(),
  /** `rule` came from a built-in pattern, `you` from a correction, `none` matched nothing. */
  categorySource: z.enum(["rule", "you", "none"]),
  flagged: z.boolean(),
});
export type FinanceTransactionRow = z.infer<typeof FinanceTransactionRowSchema>;

export const FinanceDataSchema = z.object({
  source: FinanceSourceSchema,
  /** `YYYY-MM-DD`. */
  today: z.string(),
  /** `YYYY-MM` — the month the summary describes. */
  month: z.string(),
  accounts: z.array(FinancialAccountSchema),
  /** Current and savings balances, less what is owed on credit. Investments are not cash. */
  netCash: z.number(),
  summary: MonthSummarySchema,
  months: z.array(MonthSummarySchema),
  averageMonthlySpend: z.number().optional(),
  categories: z.array(CategoryTotalSchema),
  transactions: z.array(FinanceTransactionRowSchema),
  subscriptions: z.array(SubscriptionSchema),
  subscriptionMonthly: z.number(),
  subscriptionAnnual: z.number(),
  /** What cancelling every review candidate (high and medium, not marked keep) would save. */
  subscriptionReview: z.object({ count: z.number(), monthly: z.number(), annual: z.number() }),
  goals: z.array(GoalProgressSchema),
  /** Free cash flow: the average of the last three complete months' saved, when there are any. */
  freeCashFlow: z.number().optional(),
  emergencyMonths: z.number().optional(),
  opportunities: z.array(OpportunitySchema),
  anomalies: z.array(AnomalySchema),
  attention: z.array(AttentionSchema),
  health: z.array(HealthSignalSchema),
  review: MonthlyReviewSchema,
  investments: z.object({
    portfolioValue: z.number().optional(),
    monthlyContribution: z.number().optional(),
  }),
  corrections: z.array(z.object({ merchant: z.string(), category: CategorySchema, scope: z.enum(["personal", "business"]).optional() })),
  jev: z.object({ configured: z.boolean(), assessedCount: z.number() }),
});
export type FinanceData = z.infer<typeof FinanceDataSchema>;

export const FINANCE_TABS = ["overview", "cash-flow", "spending", "subscriptions", "goals", "investments", "insights", "settings"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];

/** Whole rand with comma thousands, as Finance writes it: `R 84,320`. Locale-fixed so the server and page agree. */
export function formatRandAmount(value: number, options?: { cents?: boolean; sign?: boolean }): string {
  const cents = options?.cents ?? false;
  const magnitude = Math.abs(value);
  const text = magnitude.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const prefix = value < 0 ? "-" : options?.sign && value > 0 ? "+" : "";
  return `${prefix}R ${text}`;
}
