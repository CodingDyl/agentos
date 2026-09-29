import { z } from "zod";
import { RISK_PROFILES } from "./finance-profiler";

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
  /** `manual`: an account you added yourself, kept up to date by statement import. */
  provider: z.enum(["investec", "sample", "manual"]),
  name: z.string(),
  type: z.enum(["current", "savings", "credit", "investment"]),
  currency: z.string(),
  balance: z.number(),
  /** Last four digits only, for telling two accounts apart on screen. */
  mask: z.string().optional(),
  /** Annual interest rate as a fraction (0.22 is 22%), entered by you. Never guessed. */
  interestRate: z.number().optional(),
  /** A card's limit, for how much of it is in use. */
  creditLimit: z.number().optional(),
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
  "Reimbursement",
  "Housing",
  "Utilities",
  "Groceries",
  "Dining",
  "Transport",
  "Debt",
  "Health",
  "Insurance",
  "Education",
  "Subscriptions",
  "Entertainment",
  "Shopping",
  "Personal care",
  "Travel",
  "Giving",
  "Business",
  "Fees",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CategorySchema = z.enum(CATEGORIES);

/**
 * Where a category sits when you ask "needs or wants?". A judgement, and a
 * rough one: groceries are a need and a tasting menu is not, but both are
 * "Dining" or "Groceries" here. `unsorted` is honest about `Other`.
 */
export const CATEGORY_GROUPS = ["needs", "wants", "business", "unsorted"] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export const CATEGORY_GROUP: Record<Exclude<Category, "Income" | "Transfer" | "Reimbursement">, CategoryGroup> = {
  Housing: "needs",
  Utilities: "needs",
  Groceries: "needs",
  Transport: "needs",
  Debt: "needs",
  Health: "needs",
  Insurance: "needs",
  Education: "needs",
  Fees: "needs",
  Dining: "wants",
  Subscriptions: "wants",
  Entertainment: "wants",
  Shopping: "wants",
  "Personal care": "wants",
  Travel: "wants",
  Giving: "wants",
  Business: "business",
  Other: "unsorted",
};

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
  /** How the goal's money is held. Unset means no growth is assumed, which is the cautious reading. */
  riskProfile: z.enum(RISK_PROFILES).optional(),
  /** Overrides the profile's assumed annual return (a fraction, so 0.09 is 9%). */
  annualReturn: z.number().min(0).max(0.3).optional(),
});
export type GoalInput = z.infer<typeof GoalInputSchema>;

/** A patch may also clear the profile (`null`). */
export const GoalPatchSchema = GoalInputSchema.partial().extend({
  riskProfile: z.enum(RISK_PROFILES).nullable().optional(),
  annualReturn: z.number().min(0).max(0.3).nullable().optional(),
});
export type GoalPatch = z.infer<typeof GoalPatchSchema>;

// ----------------------------------------------------------------- reads

export const FinanceSourceSchema = z.object({
  /**
   * `investec`: live from the bank. `sample`: an illustrative set, shown only
   * while Investec is not connected and never written to disk. `none`: nothing
   * to show.
   */
  kind: z.enum(["investec", "manual", "sample", "none"]),
  configured: z.boolean(),
  /** When Investec's balances were last read, which is more often than a full sync. */
  balancesUpdatedAt: z.string().optional(),
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
  /** What you set as the monthly limit for this category. */
  budget: z.number().optional(),
  /** Where it went: the largest merchants this month. */
  merchants: z.array(z.object({ merchant: z.string(), amount: z.number(), payments: z.number() })).default([]),
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
  riskProfile: z.enum(RISK_PROFILES).optional(),
  annualReturn: z.number().optional(),
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
  /** The return the projection assumes, as a fraction. Zero when the goal has no profile. */
  assumedReturn: z.number().optional(),
  /** What the monthly contribution would be with no growth at all, for comparison. */
  requiredMonthlyNoGrowth: z.number().optional(),
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
  tab: z.enum(["overview", "cash-flow", "spending", "subscriptions", "bills", "shared", "goals", "savings", "investments", "insights", "analyser", "settings"]),
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

/**
 * A fixed monthly commitment you pay: rent, water and electricity, wifi. You
 * say what it is and roughly what it costs; Finance looks for the payment each
 * month. `match` is the word to look for in the payment (it defaults to the
 * name), matched as a whole word so "rent" does not find "current account".
 */
export const BillInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(100_000_000),
  dueDay: z.number().int().min(1).max(31),
  category: CategorySchema.default("Other"),
  match: z.string().trim().max(60).optional(),
});
export type BillInput = z.infer<typeof BillInputSchema>;

export const BillPatchSchema = BillInputSchema.partial().extend({ match: z.string().trim().max(60).nullable().optional() });
export type BillPatch = z.infer<typeof BillPatchSchema>;

/** Marking a bill paid by hand, for one paid in cash or from an account Finance cannot see. */
export const BillMarkSchema = z.object({ amount: z.number().positive().max(100_000_000).optional() });

export const BillStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number(),
  dueDay: z.number(),
  category: CategorySchema,
  match: z.string().optional(),
  /** `paid`; `due-soon` (due within three days, or just past); `upcoming`; `missing` (past its date and not seen). */
  status: z.enum(["paid", "due-soon", "upcoming", "missing"]),
  /** This month's due date, `YYYY-MM-DD`. */
  dueDate: z.string(),
  /** Days until it is due. Negative once the date has passed. */
  daysUntil: z.number(),
  paidAmount: z.number().optional(),
  paidOn: z.string().optional(),
  /** True when you marked it paid yourself rather than Finance finding the payment. */
  marked: z.boolean(),
  /** What was paid less what was expected. Positive means it cost more. */
  variance: z.number().optional(),
  /** The last few months, oldest first. A month with nothing found has no amount. */
  history: z.array(z.object({ month: z.string(), amount: z.number().optional() })),
  /** The average of the months that have an amount. */
  average: z.number().optional(),
});
export type BillStatus = z.infer<typeof BillStatusSchema>;

export const BillSuggestionSchema = z.object({ merchant: z.string(), amount: z.number(), dueDay: z.number(), category: CategorySchema });
export type BillSuggestion = z.infer<typeof BillSuggestionSchema>;

/**
 * Shared costs with a partner. You pay for rent and groceries; your partner
 * sends her half back. A payment from her is not income (it is your own money
 * coming back), so Finance files it as a reimbursement, which lowers what you
 * spent instead of raising what you earned.
 *
 * `match` is the word to find in her payments (her name, as it shows on your
 * statement).
 */
export const PartnerInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  match: z.string().trim().min(2).max(60),
  /** `YYYY-MM`: the first month to count, so old months are not swept in. */
  sinceMonth: z.string().regex(/^\d{4}-\d{2}$/),
});
export type PartnerInput = z.infer<typeof PartnerInputSchema>;

/** A cost she shares: everything in a category, or every payment with a word in it. `share` is HER fraction. */
export const SplitRuleInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  kind: z.enum(["category", "merchant"]),
  value: z.string().trim().min(1).max(60),
  share: z.number().min(0.01).max(1),
});
export type SplitRuleInput = z.infer<typeof SplitRuleInputSchema>;

export const SettlementInputSchema = z.object({
  amount: z.number().positive().max(100_000_000),
  note: z.string().trim().max(120).optional(),
});
export type SettlementInput = z.infer<typeof SettlementInputSchema>;

export const SharedSchema = z.object({
  partner: z.object({ name: z.string(), match: z.string(), sinceMonth: z.string() }).optional(),
  rules: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(["category", "merchant"]), value: z.string(), share: z.number() })),
  /** Oldest first, from `sinceMonth` to this month. */
  months: z.array(
    z.object({
      month: z.string(),
      /** What you paid, and her part of it, for each rule. */
      rows: z.array(z.object({ ruleId: z.string(), label: z.string(), paid: z.number(), herShare: z.number() })),
      herShare: z.number(),
      /** What arrived from her, and what you recorded by hand. */
      received: z.number(),
      /** Her share less what she has sent, for this month alone. */
      balance: z.number(),
    }),
  ),
  /** What she owes you across every month since `sinceMonth`. Negative means she has paid ahead. */
  owedBack: z.number(),
  /** Her recent payments, so you can see what was counted. */
  payments: z.array(z.object({ date: z.string(), description: z.string(), amount: z.number() })),
  settlements: z.array(z.object({ id: z.string(), month: z.string(), amount: z.number(), note: z.string().optional() })),
});
export type Shared = z.infer<typeof SharedSchema>;

export const SavingsStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  principle: z.string(),
  /** What this step asks each month. */
  needed: z.number(),
  /** How much of it your spare money covers, in priority order. */
  funded: z.number(),
  note: z.string(),
});

export const SavingsPlanSchema = z.object({
  /** False when there is not enough history to say anything honest. */
  ready: z.boolean(),
  income: z.number(),
  spending: z.number(),
  /** What is left after spending, on average: what there is to save. */
  capacity: z.number(),
  /** 20% of income, the usual aim, for reference. */
  idealRate: z.number(),
  steps: z.array(SavingsStepSchema),
  totalNeeded: z.number(),
  /** What to aim to save each month: what the plan asks, or what you have, whichever is less. */
  recommended: z.number(),
  /** How far short the plan is of what it asks. Zero when everything is covered. */
  gap: z.number(),
  liquidSavings: z.number(),
  bufferMonths: z.number().optional(),
  bufferTargetMonths: z.number(),
  movedToSavingsThisMonth: z.number(),
  savingsAccounts: z.array(z.object({ name: z.string(), balance: z.number() })),
});
export type SavingsPlan = z.infer<typeof SavingsPlanSchema>;

export const DebtSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  owed: z.number(),
  interestRate: z.number().optional(),
  creditLimit: z.number().optional(),
  /** 0–1: how much of the limit is in use. */
  utilisation: z.number().optional(),
  /** What a month of interest adds, at the rate you entered. */
  monthlyInterest: z.number().optional(),
  /** Months to clear at your recent free cash flow, if that is enough to make headway. */
  monthsAtFreeCashFlow: z.number().optional(),
  options: z.array(z.object({ months: z.number(), monthly: z.number(), interest: z.number() })),
});
export type Debt = z.infer<typeof DebtSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  /** The named idea the check applies. */
  principle: z.string(),
  title: z.string(),
  status: z.enum(["good", "watch", "act"]),
  /** What the numbers say, in one sentence. */
  summary: z.string(),
  evidence: z.array(z.string()),
  /** What to do about it, when there is something to do. Never a product. */
  action: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const AnalysisSchema = z.object({
  findings: z.array(FindingSchema),
  /** The ids of the findings to look at first: act before watch, worst first. */
  focus: z.array(z.string()),
  narrative: z.string().optional(),
  narrativeAt: z.string().optional(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

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
  /** Where each rand of this month's income went. */
  split: z.object({
    income: z.number(),
    needs: z.number(),
    wants: z.number(),
    business: z.number(),
    unsorted: z.number(),
    /** Income less all spending: kept, moved to savings, or invested. */
    saved: z.number(),
    /** Paid back to you this month by a partner. Already taken off what you spent. */
    reimbursed: z.number(),
  }),
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
  debts: z.array(DebtSchema),
  analysis: AnalysisSchema,
  shared: SharedSchema,
  savings: SavingsPlanSchema,
  bills: z.object({
    items: z.array(BillStatusSchema),
    /** What every tracked bill adds up to in a month. */
    committedMonthly: z.number(),
    paidThisMonth: z.number(),
    /** Expected amounts of the bills not yet seen this month. */
    remaining: z.number(),
    /** Committed bills as a share of this month's income, when there is income. */
    incomeShare: z.number().optional(),
    /** Recurring payments Finance found that you are not tracking yet. */
    suggestions: z.array(BillSuggestionSchema),
  }),
});
export type FinanceData = z.infer<typeof FinanceDataSchema>;

/**
 * An account you add yourself: Discovery, or anything Investec cannot see. For a
 * card or loan, `balance` is what you OWE, entered as a positive number.
 */
export const AccountInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(["current", "savings", "credit", "investment"]),
  balance: z.number().min(0).max(1_000_000_000),
  interestRate: z.number().min(0).max(1).optional(),
  creditLimit: z.number().min(0).max(1_000_000_000).optional(),
});
export type AccountInput = z.infer<typeof AccountInputSchema>;

export const AccountPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  balance: z.number().min(0).max(1_000_000_000).optional(),
  interestRate: z.number().min(0).max(1).nullable().optional(),
  creditLimit: z.number().min(0).max(1_000_000_000).nullable().optional(),
});
export type AccountPatch = z.infer<typeof AccountPatchSchema>;

/** A monthly limit for one category. `null` amount removes it. */
export const BudgetInputSchema = z.object({
  category: CategorySchema,
  amount: z.number().min(0).max(100_000_000).nullable(),
});
export type BudgetInput = z.infer<typeof BudgetInputSchema>;

export const FINANCE_TABS = ["overview", "cash-flow", "spending", "subscriptions", "bills", "shared", "goals", "savings", "investments", "insights", "analyser", "settings"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];

/** Whole rand with comma thousands, as Finance writes it: `R 84,320`. Locale-fixed so the server and page agree. */
export function formatRandAmount(value: number, options?: { cents?: boolean; sign?: boolean }): string {
  const cents = options?.cents ?? false;
  const magnitude = Math.abs(value);
  const text = magnitude.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const prefix = value < 0 ? "-" : options?.sign && value > 0 ? "+" : "";
  return `${prefix}R ${text}`;
}

/**
 * What is in the accounts Investec reports: current and savings, live. Cards
 * and investments are not "in" an account, so they are left out. Undefined when
 * there are no Investec accounts, so a page with none does not show a zero
 * that would read as "you have nothing".
 */
export function investecCashOf(accounts: readonly FinancialAccount[]): number | undefined {
  const held = accounts.filter((account) => account.provider === "investec" && (account.type === "current" || account.type === "savings"));
  if (held.length === 0) return undefined;
  return Math.round(held.reduce((total, account) => total + account.balance, 0) * 100) / 100;
}

/**
 * Net cash, exactly: everything you hold in current and savings accounts, less
 * everything you owe on cards and loans, across every account Finance knows
 * about. Investments are not cash and are counted on their own tab. A card's
 * balance is stored negative, so the sum is the whole calculation.
 */
export function netCashOf(accounts: readonly FinancialAccount[]): number {
  return Math.round(accounts.filter((account) => account.type !== "investment").reduce((total, account) => total + account.balance, 0) * 100) / 100;
}
