import { z } from "zod";

/**
 * The usage contract.
 *
 * One question motivates this whole layer: **where are my tokens going, and
 * what is it costing me?** Answering it needs four things kept apart, because
 * conflating them is how a usage screen starts lying:
 *
 * ```text
 * TOKENS         how much context and completion was consumed
 * COST           what that execution actually cost
 * ACTIVITY       which agent, job and project caused it
 * SUBSCRIPTIONS  what recurring services are paid for regardless
 * ```
 *
 * A $20/month Claude plan and $4.82 of Anthropic API spend are not the same
 * money, and a total that added them without saying so would be worse than no
 * total at all.
 *
 * The rule that governs every field below is the one the rest of this codebase
 * already runs on, stated here in its sharpest form: **never turn missing
 * provider data into fake precision.** Providers expose wildly different
 * amounts of usage information, and a record says which kind it is rather than
 * rounding an absence up into a number.
 */

/**
 * How much to trust a figure.
 *
 * `exact` means the provider reported it. `estimated` means AgentOS derived it
 * from something it does know — characters of context, a published rate — and
 * is saying so out loud. `unknown` means nobody can say, and the screen shows
 * an em dash rather than a zero.
 *
 * This never silently upgrades. An estimate does not become exact because it
 * was aggregated with exact figures; a total carries the weakest measurement
 * that went into it.
 */
export const UsageMeasurementSchema = z.enum(["exact", "estimated", "unknown"]);

/** What kind of execution consumed this. */
export const UsageSourceSchema = z.enum([
  "hermes",
  "worker",
  "automation",
  "visual",
  "image-generation",
]);

/**
 * What the execution was *for*.
 *
 * The reason this exists rather than just an agent name: "Hermes used 900k
 * tokens" is not actionable, and "Hermes visual reviews used 240k tokens" is.
 * Every Hermes call site in the server names its operation, so the breakdown
 * is recorded rather than guessed at afterwards.
 */
export const UsageOperationSchema = z.enum([
  "chat",
  "planning",
  "scoping",
  "routing",
  "code-review",
  "visual-review",
  "design-review",
  "image-generation",
  "implementation",
  "automation",
  "other",
]);

/**
 * Tokens, as far as the provider will say.
 *
 * Every field optional, including the total: a provider that reports only
 * output tokens has told us something true, and a `total` synthesised from
 * half the picture would not be. Where a total is derived from the parts, the
 * record's measurement says so.
 */
export const UsageTokensSchema = z.object({
  input: z.number().optional(),
  output: z.number().optional(),
  /** Read from cache rather than processed fresh. Usually much cheaper. */
  cachedInput: z.number().optional(),
  /** Thinking tokens, for models that bill them separately. */
  reasoning: z.number().optional(),
  total: z.number().optional(),
});

/**
 * How much was put in front of the model, and how.
 *
 * Tokens alone do not explain themselves. A job that consumed 94k input tokens
 * is a mystery until you can see it was handed eighteen context files — and
 * then it is a context-builder problem rather than a model problem. This is
 * what turns a number into something worth fixing.
 */
export const UsageContextSchema = z.object({
  files: z.number().optional(),
  characters: z.number().optional(),
  /** Never presented as a token count. Always shown as an estimate. */
  estimatedTokens: z.number().optional(),
});

/**
 * One execution's usage.
 *
 * Attribution is inherited down the chain AgentOS already has — project, task,
 * job, run — so a record can be rolled up any of those ways without a second
 * bookkeeping system. Nothing here holds prompt or response content; see the
 * privacy note on the ledger.
 */
export const UsageRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(),

  source: UsageSourceSchema,
  operation: UsageOperationSchema,

  /** `hermes`, `claude`, `grok` — open, so a new worker needs no migration. */
  agent: z.string(),
  /** Who actually billed it: `anthropic`, `xai`, `openrouter`. */
  provider: z.string().optional(),
  model: z.string().optional(),

  project: z.string().optional(),
  taskId: z.string().optional(),
  jobId: z.string().optional(),
  runId: z.string().optional(),

  tokens: UsageTokensSchema.default({}),
  costUsd: z.number().optional(),

  /** How the tokens were obtained. */
  status: UsageMeasurementSchema,
  /**
   * How the cost was obtained, separately.
   *
   * Kept apart from `status` because the two genuinely differ: Grok reports
   * exact tokens and no price at all, so one run is `exact` tokens and
   * `unknown` cost. A single field would have to round one of those.
   */
  costStatus: UsageMeasurementSchema.default("unknown"),

  durationMs: z.number().optional(),
  context: UsageContextSchema.optional(),
});

/**
 * A rolled-up figure, with its own honesty about coverage.
 *
 * `records` and `measured` are both here for the same reason the validation
 * sprint reports how many tasks a cost total covers: $4.82 across all eleven
 * jobs and $4.82 across three of them are different facts, and a bare total
 * quietly reads as the first.
 */
export const UsageTotalSchema = z.object({
  tokens: z.number().optional(),
  costUsd: z.number().optional(),
  /** How many executions fall in this bucket. */
  records: z.number(),
  /** How many of them actually reported tokens. */
  measured: z.number(),
  /** How many reported a cost. */
  costed: z.number(),
  /** The weakest measurement that went into the figures. */
  status: UsageMeasurementSchema,
});

/** One row of any breakdown — by agent, model, project, or operation. */
export const UsageBreakdownRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  total: UsageTotalSchema,
  /** Share of the parent's tokens, 0–1. Absent when nothing was measured. */
  tokenShare: z.number().optional(),
  /** Share of the parent's cost, 0–1. Absent when nothing was costed. */
  costShare: z.number().optional(),
});

/**
 * One agent's operating record.
 *
 * Deliberately mixes economics with outcomes. "Claude costs more" is not a
 * finding; "Claude costs twice as much and passes review first time 88% of the
 * time against Grok's 69%" is a routing decision. Cost per *successful* job is
 * the figure that makes those comparable — a cheap worker that needs three
 * attempts is not cheap.
 */
export const AgentUsageSchema = z.object({
  agent: z.string(),
  label: z.string(),
  total: UsageTotalSchema,
  /** Worker jobs, or Hermes runs. */
  runs: z.number(),
  completed: z.number(),
  avgCostUsd: z.number().optional(),
  /** Average cost of the jobs that actually reached completion. */
  avgSuccessfulCostUsd: z.number().optional(),
  firstPassReviewRate: z.number().optional(),
  avgRevisions: z.number().optional(),
  /** The operations it spends the most on, worst first. */
  topOperations: z.array(UsageBreakdownRowSchema).default([]),
});

/** What one worker job cost, beside how well it went. */
export const JobUsageSchema = z.object({
  jobId: z.string(),
  objective: z.string(),
  project: z.string().optional(),
  agent: z.string().optional(),
  taskId: z.string().optional(),
  total: UsageTotalSchema,
  durationMs: z.number().optional(),
  revisions: z.number().optional(),
  reviewVerdict: z.string().optional(),
  status: z.string(),
  startedAt: z.string().optional(),
});

/** Every step that went into one task, and what the task cost end to end. */
export const TaskUsageSchema = z.object({
  taskId: z.string(),
  project: z.string().optional(),
  total: UsageTotalSchema,
  steps: z.array(UsageBreakdownRowSchema).default([]),
});

/**
 * A recurring or prepaid AI service.
 *
 * Entered by hand, on purpose. Building billing integrations for six providers
 * to learn a number the operator already knows is the wrong trade, and a
 * wrong-but-automatic figure is harder to notice than a stale manual one.
 * Nothing here is inferred from usage — AgentOS never assumes a subscription
 * exists because it saw traffic.
 */
export const SubscriptionTypeSchema = z.enum([
  "subscription",
  "prepaid",
  "pay-as-you-go",
]);

export const SubscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string().optional(),
  type: SubscriptionTypeSchema,
  price: z.number().optional(),
  currency: z.string().default("USD"),
  billingCycle: z.enum(["monthly", "annual"]).optional(),
  renewalDate: z.string().optional(),
  /** What is left on a prepaid account, when the operator has recorded it. */
  balanceUsd: z.number().optional(),
  balanceCheckedAt: z.string().optional(),
  active: z.boolean().default(true),
  notes: z.string().optional(),
});

/**
 * A spending ceiling.
 *
 * Advisory only. Crossing one produces a warning and then an attention item,
 * and never kills a running job: a worker terminated halfway through an
 * implementation because a counter crossed $50.01 costs more than the dollar
 * it saved. Claude's existing per-job budget is the hard limit, and it is
 * scoped to one run where that is a sensible thing to do.
 */
export const UsageBudgetSchema = z.object({
  scope: z.enum(["global", "project", "agent"]),
  scopeId: z.string().optional(),
  monthlyUsd: z.number(),
  warningPercent: z.number().default(80),
});

export const BudgetStateSchema = z.object({
  budget: UsageBudgetSchema,
  spentUsd: z.number(),
  /** 0–1, and allowed to exceed 1. */
  fraction: z.number(),
  state: z.enum(["ok", "warning", "exceeded"]),
});

/**
 * An unusual run, found by arithmetic rather than by a model.
 *
 * Deterministic on purpose: comparing a run against this system's own rolling
 * average for the same operation needs no intelligence, costs nothing, and
 * cannot hallucinate. Thresholds come from AgentOS' own history rather than
 * from any global notion of what a run "should" cost.
 */
export const UsageAnomalySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  operation: UsageOperationSchema,
  agent: z.string(),
  label: z.string(),
  tokens: z.number(),
  /** The rolling average this run is being judged against. */
  typicalTokens: z.number(),
  /** How many runs the average is built from. Small samples say so. */
  sampleSize: z.number(),
  project: z.string().optional(),
  jobId: z.string().optional(),
});

/** Recurring cost and usage-based cost, added only where that is honest. */
export const CostSummarySchema = z.object({
  /** Subscriptions due this month, from what the operator recorded. */
  recurringUsd: z.number(),
  recurring: z.array(UsageBreakdownRowSchema).default([]),
  /** Metered spend the ledger actually measured. */
  usageUsd: z.number().optional(),
  usage: z.array(UsageBreakdownRowSchema).default([]),
  totalUsd: z.number().optional(),
  /** True when some metered spend could not be measured. */
  incomplete: z.boolean(),
});

/** Something running right now, and what it has spent so far. */
export const LiveAgentSchema = z.object({
  agent: z.string(),
  label: z.string(),
  state: z.enum(["running", "ready", "offline"]),
  detail: z.string().optional(),
  model: z.string().optional(),
  project: z.string().optional(),
  jobId: z.string().optional(),
  startedAt: z.string().optional(),
  /**
   * Live tokens, when the provider streams them.
   *
   * Absent for a provider that only reports at the end — and the screen says
   * "available when the run completes" rather than animating a guess.
   */
  tokens: z.number().optional(),
  costUsd: z.number().optional(),
});

/** The window a page is reporting on. */
export const UsageWindowSchema = z.object({
  label: z.string(),
  from: z.string(),
  to: z.string(),
});

/** Everything the Operations screen shows, in one read. */
export const OperationsDataSchema = z.object({
  generatedAt: z.string(),
  window: UsageWindowSchema,
  month: UsageTotalSchema,
  today: UsageTotalSchema,
  jobsThisMonth: z.number(),
  successRate: z.number().optional(),
  agents: z.array(AgentUsageSchema).default([]),
  models: z.array(UsageBreakdownRowSchema).default([]),
  projects: z.array(UsageBreakdownRowSchema).default([]),
  operations: z.array(UsageBreakdownRowSchema).default([]),
  /** What is using the tokens, ranked. The answer to the actual question. */
  tokenSources: z.array(UsageBreakdownRowSchema).default([]),
  recentJobs: z.array(JobUsageSchema).default([]),
  live: z.array(LiveAgentSchema).default([]),
  subscriptions: z.array(SubscriptionSchema).default([]),
  cost: CostSummarySchema,
  budgets: z.array(BudgetStateSchema).default([]),
  anomalies: z.array(UsageAnomalySchema).default([]),
  /** True when the ledger could not be read at all. */
  degraded: z.boolean().default(false),
});

/**
 * One agent, in full.
 *
 * The page that turns a worker list into worker management: what it is, how it
 * is configured, what it has cost this month, how well it does, and the jobs
 * that prove it. `configuration` is free-form label/value pairs because the
 * interesting facts differ per agent — Grok has a binary and a sandbox, Claude
 * has a model and a per-job budget, Hermes has a base URL and cron jobs — and
 * a schema covering all three would fit none of them.
 */
export const AgentDetailSchema = z.object({
  agent: z.string(),
  label: z.string(),
  role: z.string().optional(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  configuration: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .default([]),
  window: UsageWindowSchema,
  usage: AgentUsageSchema,
  jobsToday: z.number(),
  operations: z.array(UsageBreakdownRowSchema).default([]),
  models: z.array(UsageBreakdownRowSchema).default([]),
  recentJobs: z.array(JobUsageSchema).default([]),
});

export const AgentDetailResponseSchema = z.object({ agent: AgentDetailSchema });

export const TaskUsageResponseSchema = z.object({ task: TaskUsageSchema });

/** The compact summary Mission Control shows. Never the whole screen. */
export const UsageSummarySchema = z.object({
  today: UsageTotalSchema,
  month: UsageTotalSchema,
  /** The agent that spent the most today, when anything was spent. */
  topAgent: z
    .object({
      agent: z.string(),
      label: z.string(),
      costUsd: z.number().optional(),
    })
    .optional(),
  budget: BudgetStateSchema.optional(),
});

export const SubscriptionsResponseSchema = z.object({
  subscriptions: z.array(SubscriptionSchema),
});

export const BudgetsResponseSchema = z.object({
  budgets: z.array(UsageBudgetSchema),
});

export type UsageMeasurement = z.infer<typeof UsageMeasurementSchema>;
export type UsageSource = z.infer<typeof UsageSourceSchema>;
export type UsageOperation = z.infer<typeof UsageOperationSchema>;
export type UsageTokens = z.infer<typeof UsageTokensSchema>;
export type UsageContext = z.infer<typeof UsageContextSchema>;
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
export type UsageTotal = z.infer<typeof UsageTotalSchema>;
export type UsageBreakdownRow = z.infer<typeof UsageBreakdownRowSchema>;
export type AgentUsage = z.infer<typeof AgentUsageSchema>;
export type JobUsage = z.infer<typeof JobUsageSchema>;
export type TaskUsage = z.infer<typeof TaskUsageSchema>;
export type SubscriptionType = z.infer<typeof SubscriptionTypeSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type UsageBudget = z.infer<typeof UsageBudgetSchema>;
export type BudgetState = z.infer<typeof BudgetStateSchema>;
export type UsageAnomaly = z.infer<typeof UsageAnomalySchema>;
export type CostSummary = z.infer<typeof CostSummarySchema>;
export type LiveAgent = z.infer<typeof LiveAgentSchema>;
export type UsageWindow = z.infer<typeof UsageWindowSchema>;
export type OperationsData = z.infer<typeof OperationsDataSchema>;
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
export type AgentDetail = z.infer<typeof AgentDetailSchema>;
export type AgentDetailResponse = z.infer<typeof AgentDetailResponseSchema>;
export type TaskUsageResponse = z.infer<typeof TaskUsageResponseSchema>;
export type SubscriptionsResponse = z.infer<typeof SubscriptionsResponseSchema>;
export type BudgetsResponse = z.infer<typeof BudgetsResponseSchema>;
