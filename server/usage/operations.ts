import type {
  CostSummary,
  LiveAgent,
  OperationsData,
  Subscription,
  UsageBreakdownRow,
  UsageRecord,
  UsageBucket,
  UsageRange,
  UsageSummary,
  UsageWindow,
} from "../../shared/usage-types";
import type { WorkerJob } from "../../shared/worker-types";
import { getProjects } from "../agentos/projects";
import { isRunning } from "../workers/job-manager";
import { listJobs } from "../workers/job-store";
import { describeWorkers } from "../workers/registry";
import { evaluateBudgets, listBudgets } from "./budgets";
import { readUsage } from "./ledger";
import {
  agentLabel,
  agentUsage,
  breakdown,
  findAnomalies,
  jobUsage,
  operationLabel,
  providerLabel,
  tokenSources,
  total,
} from "./metrics";
import { getOpenRouterBalance } from "./providers/openrouter";
import { listSubscriptions, monthlyCost } from "./subscriptions";

/**
 * Assembling the Operations screen.
 *
 * The same two rules as Mission Control's builder, for the same reasons. It
 * **owns nothing** — every figure is read from the ledger, the job store, the
 * vault or the subscription table, and nothing is written here. And **one
 * source failing is not the page failing**: the ledger is the only part this
 * screen cannot do without, so everything else degrades its own section.
 *
 * The third rule is this screen's own. **Recurring money and metered money are
 * never silently added.** A $20 plan and $4.82 of API spend are different
 * kinds of commitment, and the summary keeps them in separate rows before it
 * offers a total — and says when the metered half is incomplete.
 */

/** Enough jobs to cover a month of work without reading the archive. */
const JOB_LIMIT = 200;

/** How many jobs the recent list shows. */
const RECENT_JOBS = 12;

/** How many rows a breakdown shows before it stops being a breakdown. */
const BREAKDOWN_LIMIT = 12;

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function startOfDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * The month being reported on.
 *
 * The label is the month's name in a fixed locale rather than the reader's:
 * this is the one string the adapter has to word itself, because it names the
 * window a query was run over rather than describing a moment to a person.
 */
export function monthWindow(now = new Date()): UsageWindow {
  const from = startOfMonth(now);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));

  return {
    label: from.toLocaleString("en-GB", { month: "long", timeZone: "UTC" }),
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * The window a range reports on.
 *
 * `7d` is the last seven calendar days including today, so its first bar is a
 * whole day rather than whatever fraction of one was 168 hours ago.
 */
export function rangeWindow(range: UsageRange, now = new Date()): UsageWindow {
  if (range === "month") return monthWindow(now);

  const today = startOfDay(now);
  const to = new Date(today.getTime() + DAY_MS).toISOString();

  if (range === "today") {
    return { label: "Today", from: today.toISOString(), to };
  }

  return {
    label: "Last 7 days",
    from: new Date(today.getTime() - 6 * DAY_MS).toISOString(),
    to,
  };
}

/**
 * The spend line: hourly for today, daily otherwise, and never past now.
 *
 * A bucket nothing priced keeps its cost absent rather than zero, so the line
 * can show a gap instead of a confident dip to nothing.
 */
export function usageSeries(
  records: readonly UsageRecord[],
  window: UsageWindow,
  range: UsageRange,
  now = new Date(),
): UsageBucket[] {
  const step = range === "today" ? HOUR_MS : DAY_MS;
  const from = Date.parse(window.from);
  const until = Math.min(Date.parse(window.to), now.getTime());

  const buckets: UsageBucket[] = [];
  for (let start = from; start < until; start += step) {
    buckets.push({ from: new Date(start).toISOString(), tokens: 0 });
  }

  for (const record of records) {
    const index = Math.floor((Date.parse(record.timestamp) - from) / step);
    const bucket = buckets[index];
    if (!bucket) continue;

    bucket.tokens += record.tokens.total ?? 0;
    if (typeof record.costUsd === "number") {
      bucket.costUsd = (bucket.costUsd ?? 0) + record.costUsd;
    }
  }

  return buckets;
}

/**
 * Recurring and metered cost, kept apart and then added.
 *
 * `incomplete` is the honest part: when some runs reported no price, the total
 * is a floor rather than a figure, and the screen has to be able to say so.
 * A number presented as "your AI cost this month" that quietly omits every
 * Grok run would be the single most misleading thing on this page.
 */
export function summariseCost(
  subscriptions: readonly Subscription[],
  records: readonly UsageRecord[],
): CostSummary {
  const recurring: UsageBreakdownRow[] = subscriptions.flatMap(
    (subscription) => {
      const cost = monthlyCost(subscription);
      if (cost === undefined) return [];

      return [
        {
          key: subscription.id,
          label: subscription.name,
          total: {
            tokens: undefined,
            costUsd: cost,
            records: 1,
            measured: 0,
            costed: 1,
            // A price the operator typed in is exact — they are the authority
            // on what they pay, and this is not a guess by AgentOS.
            status: "exact" as const,
          },
        },
      ];
    },
  );

  const recurringUsd = recurring.reduce(
    (sum, row) => sum + (row.total.costUsd ?? 0),
    0,
  );

  const metered = total(records);
  const usageUsd = metered.costUsd;

  const usage = breakdown(
    records,
    (record) => record.provider ?? record.agent,
    (key) => providerLabel(key),
  ).filter((row) => row.total.costUsd !== undefined);

  return {
    recurringUsd,
    recurring,
    usageUsd,
    usage,
    totalUsd:
      usageUsd === undefined ? recurringUsd || undefined : recurringUsd + usageUsd,
    // True whenever any execution this month went unpriced.
    incomplete: metered.records > metered.costed,
  };
}

/**
 * What is running right now, and what it has spent so far.
 *
 * A worker that does not stream usage shows no token figure at all. The
 * browser writes "available when the run completes" over that absence rather
 * than animating a rising estimate — a number that moves is read as a
 * measurement, and inventing one to make the panel feel alive would be the
 * cheapest possible way to make this whole screen untrustworthy.
 */
export function buildLive(
  workers: Awaited<ReturnType<typeof describeWorkers>>,
  jobs: readonly WorkerJob[],
  records: readonly UsageRecord[],
): LiveAgent[] {
  return workers.map((worker) => {
    const running = jobs.find(
      (job) => job.resolvedWorker === worker.id && isRunning(job.id),
    );

    if (!worker.available) {
      return {
        agent: worker.id,
        label: worker.name,
        state: "offline" as const,
        detail: worker.unavailableReason,
      };
    }

    if (!running) {
      return { agent: worker.id, label: worker.name, state: "ready" as const };
    }

    // Only what has actually been written down. A job in flight has usually
    // recorded nothing yet, and that is reported as nothing.
    const spent = total(records.filter((record) => record.jobId === running.id));

    return {
      agent: worker.id,
      label: worker.name,
      state: "running" as const,
      detail: running.objective,
      project: running.project,
      jobId: running.id,
      startedAt: running.startedAt,
      tokens: spent.tokens,
      costUsd: spent.costUsd,
    };
  });
}

interface Settled<T> {
  value?: T;
  error?: string;
}

async function settle<T>(read: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { value: await read() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "That source failed.",
    };
  }
}

/** Everything the Operations screen shows, read once. */
export async function getOperationsData(
  now = new Date(),
  range: UsageRange = "month",
): Promise<OperationsData> {
  const calendarMonth = monthWindow(now);
  const window = rangeWindow(range, now);
  const dayStart = startOfDay(now).toISOString();

  const [jobs, workers, projects, balance] = await Promise.all([
    settle(() => listJobs(JOB_LIMIT)),
    settle(() => describeWorkers()),
    settle(() => getProjects()),
    settle(() => getOpenRouterBalance()),
  ]);

  const month = readUsage({ from: calendarMonth.from, to: calendarMonth.to });
  const today = month.filter((record) => record.timestamp >= dayStart);
  // A 7-day window can reach back into last month, so it is read on its own
  // rather than filtered out of the calendar month.
  const inRange =
    range === "month"
      ? month
      : range === "today"
        ? today
        : readUsage({ from: window.from, to: window.to });

  const allJobs = jobs.value ?? [];

  // Project slugs become names here rather than in the browser, because only
  // the adapter has read the vault and knows what `pantry-pilot` is called.
  const projectNames = new Map<string, string>(
    (projects.value ?? []).map((project) => [project.slug, project.name]),
  );

  const rangeJobs = allJobs.filter(
    (job) => job.createdAt >= window.from && job.createdAt < window.to,
  );

  const completed = rangeJobs.filter((job) => job.status === "completed").length;
  const settledJobs = rangeJobs.filter((job) =>
    ["completed", "rejected", "failed"].includes(job.status),
  ).length;

  const subscriptions = listSubscriptions().map((subscription) =>
    // A live balance beats a recorded one, and only where one was actually
    // fetched — a failed lookup leaves whatever the operator last wrote down.
    subscription.provider === "openrouter" && balance.value
      ? {
          ...subscription,
          balanceUsd: balance.value.remainingUsd,
          balanceCheckedAt: balance.value.checkedAt,
        }
      : subscription,
  );

  return {
    generatedAt: now.toISOString(),
    range,
    window,
    period: total(inRange),
    series: usageSeries(inRange, window, range, now),
    month: total(month),
    today: total(today),
    jobs: rangeJobs.length,
    // Only over jobs that actually reached an ending. Counting a running job
    // as a failure would make every busy afternoon look like a bad month.
    successRate: settledJobs > 0 ? completed / settledJobs : undefined,

    agents: agentUsage(inRange, rangeJobs),

    models: breakdown(inRange, (record) => record.model).slice(0, BREAKDOWN_LIMIT),

    projects: breakdown(
      inRange,
      (record) => record.project,
      (slug) => projectNames.get(slug) ?? slug,
    ).slice(0, BREAKDOWN_LIMIT),

    operations: breakdown(
      inRange,
      (record) => record.operation,
      (key) => operationLabel(key as UsageRecord["operation"]),
    ),

    tokenSources: tokenSources(inRange).slice(0, BREAKDOWN_LIMIT),

    recentJobs: jobUsage(inRange, rangeJobs).slice(0, RECENT_JOBS),

    // Live state is about right now, so it reads the calendar month whatever the range.
    live: buildLive(workers.value ?? [], allJobs, month),

    subscriptions,
    cost: summariseCost(subscriptions, month),
    budgets: evaluateBudgets(listBudgets(), month),
    anomalies: findAnomalies(month).slice(0, 6),

    degraded: false,
  };
}

/**
 * The compact summary Mission Control shows.
 *
 * Deliberately not the same read as the screen above. Mission Control asks a
 * much smaller question — *is anything unusual happening to my spend today?* —
 * and answering it by building the whole Operations payload would make the
 * morning's first page load pay for a report nobody asked for.
 */
export async function getUsageSummary(now = new Date()): Promise<UsageSummary> {
  const window = monthWindow(now);
  const dayStart = startOfDay(now).toISOString();

  const month = readUsage({ from: window.from, to: window.to });
  const today = month.filter((record) => record.timestamp >= dayStart);

  const byAgent = breakdown(today, (record) => record.agent, agentLabel);

  // Ranked by cost rather than tokens, because this line is about money — the
  // agent that spent the most is not always the one that used the most.
  const topAgent = [...byAgent]
    .filter((row) => row.total.costUsd !== undefined)
    .sort((a, b) => (b.total.costUsd ?? 0) - (a.total.costUsd ?? 0))[0];

  const budgets = evaluateBudgets(listBudgets(), month);

  return {
    today: total(today),
    month: total(month),
    topAgent: topAgent
      ? {
          agent: topAgent.key,
          label: topAgent.label,
          costUsd: topAgent.total.costUsd,
        }
      : undefined,
    budget: budgets.find((state) => state.budget.scope === "global"),
  };
}

/**
 * One agent, in full.
 *
 * This is what turns a worker list into worker management. A roster tells you
 * a worker exists; this tells you what it is configured as, what it has cost
 * this month, how often its work stands up to review, and which jobs those
 * numbers came from — enough to decide whether to keep routing to it.
 *
 * Hermes is included even though it is not a worker, because it is the agent
 * spending the most and the one whose costs are least visible anywhere else.
 */
export async function getAgentDetail(
  agent: string,
  now = new Date(),
): Promise<import("../../shared/usage-types").AgentDetail | undefined> {
  const window = monthWindow(now);
  const dayStart = startOfDay(now).toISOString();

  const month = readUsage({ from: window.from, to: window.to, agent });

  const [jobs, workers] = await Promise.all([
    settle(() => listJobs(JOB_LIMIT)),
    settle(() => describeWorkers()),
  ]);

  const worker = (workers.value ?? []).find((entry) => entry.id === agent);
  const isHermes = agent === "hermes";

  // An agent nobody has heard of and that has spent nothing does not exist.
  if (!worker && !isHermes && month.length === 0) return undefined;

  const myJobs = (jobs.value ?? []).filter(
    (job) =>
      job.resolvedWorker === agent &&
      job.createdAt >= window.from &&
      job.createdAt < window.to,
  );

  const [usage] = agentUsage(month, myJobs);

  return {
    agent,
    label: worker?.name ?? agentLabel(agent),
    role: worker?.role,
    // Hermes' reachability is its own screen's business; here it is simply
    // present, because it has clearly been running if it has spent anything.
    available: worker?.available ?? true,
    unavailableReason: worker?.unavailableReason,
    configuration: describeConfiguration(agent, worker),
    window,
    usage: usage ?? {
      agent,
      label: agentLabel(agent),
      total: total([]),
      runs: 0,
      completed: 0,
      topOperations: [],
    },
    // Counted the same way `runs` is, which differs by agent: a worker's day
    // is its jobs, and Hermes' day is its calls. Counting jobs for both left
    // Hermes reporting 34 runs this month and none today, on a day when every
    // one of the 34 had happened.
    jobsToday: isHermes
      ? month.filter((record) => record.timestamp >= dayStart).length
      : myJobs.filter((job) => job.createdAt >= dayStart).length,
    operations: breakdown(
      month,
      (record) => record.operation,
      (key) => operationLabel(key as UsageRecord["operation"]),
    ),
    models: breakdown(month, (record) => record.model),
    recentJobs: jobUsage(month, myJobs).slice(0, RECENT_JOBS),
  };
}

/**
 * What this agent is set up as.
 *
 * Read from the environment the adapter already has, and deliberately never
 * from a secret: a base URL and a model name are configuration, an API key is
 * not, and nothing here reports whether a key's value is anything but present.
 */
function describeConfiguration(
  agent: string,
  worker: Awaited<ReturnType<typeof describeWorkers>>[number] | undefined,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];

  if (agent === "hermes") {
    rows.push({
      label: "Base URL",
      value: process.env.HERMES_BASE_URL ?? "http://127.0.0.1:8642/v1",
    });
    rows.push({ label: "Model", value: process.env.HERMES_MODEL ?? "hermes" });
    rows.push({
      label: "API key",
      value: process.env.HERMES_API_KEY?.trim() ? "Configured" : "Not set",
    });
  }

  if (agent === "claude") {
    rows.push({
      label: "Model",
      value: process.env.CLAUDE_WORKER_MODEL?.trim() || "sonnet",
    });
    rows.push({
      label: "Per-job budget",
      value: process.env.CLAUDE_WORKER_BUDGET_USD?.trim()
        ? `$${process.env.CLAUDE_WORKER_BUDGET_USD.trim()}`
        : "Default",
    });
  }

  if (agent === "grok") {
    rows.push({
      label: "Binary",
      value: process.env.AGENTOS_GROK_BIN?.trim() || "grok",
    });
  }

  if (worker) {
    rows.push({
      label: "Capabilities",
      value: worker.capabilities.join(", ") || "-",
    });
  }

  return rows;
}
