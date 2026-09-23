import type {
  AgentUsage,
  JobUsage,
  TaskUsage,
  UsageBreakdownRow,
  UsageMeasurement,
  UsageOperation,
  UsageRecord,
  UsageTotal,
} from "../../shared/usage-types";
import type { WorkerJob } from "../../shared/worker-types";

/**
 * Turning records into answers.
 *
 * Every function here is pure and takes its records as an argument, so the
 * arithmetic can be tested against fixtures rather than against whatever this
 * machine happens to have spent.
 *
 * One rule survives every aggregation, and it is the reason this module is
 * longer than a few `reduce` calls: **a total is never allowed to be more
 * confident than the records it came from.** Summing four exact figures and
 * one estimate produces an estimate. Summing four exact figures and one run
 * that reported nothing produces an exact figure that covers four of five
 * records — and says so, because the alternative is a number that silently
 * understates spend and looks authoritative doing it.
 */

/** Statuses ordered by how much they can be trusted. */
const CONFIDENCE: Record<UsageMeasurement, number> = {
  exact: 2,
  estimated: 1,
  unknown: 0,
};

/** The least confident of two measurements. Never upgrades. */
export function weakest(
  a: UsageMeasurement,
  b: UsageMeasurement,
): UsageMeasurement {
  return CONFIDENCE[a] <= CONFIDENCE[b] ? a : b;
}

const EMPTY: UsageTotal = {
  tokens: undefined,
  costUsd: undefined,
  records: 0,
  measured: 0,
  costed: 0,
  status: "unknown",
};

/**
 * Adds a set of records up.
 *
 * `measured` and `costed` are the honest part. A bucket of eleven runs where
 * three reported tokens has a real token total and a real coverage problem,
 * and reporting only the first would make a partially-instrumented month look
 * like a cheap one.
 */
export function total(records: readonly UsageRecord[]): UsageTotal {
  if (records.length === 0) return { ...EMPTY };

  let tokens: number | undefined;
  let costUsd: number | undefined;
  let measured = 0;
  let costed = 0;
  let status: UsageMeasurement | undefined;

  for (const record of records) {
    const recordTokens = record.tokens.total;

    if (typeof recordTokens === "number") {
      tokens = (tokens ?? 0) + recordTokens;
      measured += 1;
      // Only records that contributed tokens get a say in how trustworthy the
      // token figure is. A run that reported nothing is a coverage gap, not a
      // reason to call the measured runs estimates.
      status = status === undefined ? record.status : weakest(status, record.status);
    }

    if (typeof record.costUsd === "number") {
      costUsd = (costUsd ?? 0) + record.costUsd;
      costed += 1;
    }
  }

  return {
    tokens,
    costUsd,
    records: records.length,
    measured,
    costed,
    status: status ?? "unknown",
  };
}

/** How each agent's name is written. Anything unknown keeps its own id. */
const AGENT_LABELS: Record<string, string> = {
  hermes: "Hermes",
  claude: "Claude",
  grok: "Grok",
  mock: "Mock",
};

export function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

/**
 * How each billing provider's name is written.
 *
 * Separate from the agent map because they are different things: `claude` is
 * an agent AgentOS runs, `anthropic` is the account the money lands on, and
 * the cost breakdown groups by the second. Falling back to the agent map alone
 * left provider ids rendering lowercase beside properly-cased agent names.
 */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic API",
  xai: "xAI API",
  openrouter: "OpenRouter",
  hermes: "Hermes",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? AGENT_LABELS[provider] ?? provider;
}

const OPERATION_LABELS: Record<UsageOperation, string> = {
  chat: "Chat",
  planning: "Planning",
  scoping: "Task scoping",
  routing: "Routing",
  "code-review": "Code review",
  "visual-review": "Visual review",
  "design-review": "Design review",
  "image-generation": "Image generation",
  implementation: "Implementation",
  automation: "Automations",
  other: "Other",
};

export function operationLabel(operation: UsageOperation): string {
  return OPERATION_LABELS[operation] ?? operation;
}

/**
 * Groups records and ranks the groups.
 *
 * Ranked by tokens rather than by cost, because this is what answers "where
 * are my tokens going" — and because cost is the figure most likely to be
 * missing. Ties break by name so two runs of the same report agree.
 */
export function breakdown(
  records: readonly UsageRecord[],
  keyOf: (record: UsageRecord) => string | undefined,
  labelOf: (key: string) => string = (key) => key,
): UsageBreakdownRow[] {
  const groups = new Map<string, UsageRecord[]>();

  for (const record of records) {
    const key = keyOf(record);
    if (key === undefined) continue;

    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }

  const parent = total(records);

  return [...groups.entries()]
    .map(([key, bucket]) => {
      const groupTotal = total(bucket);

      return {
        key,
        label: labelOf(key),
        total: groupTotal,
        // A share of an unknown whole is not a share. Both sides have to be
        // measured before a percentage means anything.
        tokenShare:
          parent.tokens && groupTotal.tokens
            ? groupTotal.tokens / parent.tokens
            : undefined,
        costShare:
          parent.costUsd && groupTotal.costUsd
            ? groupTotal.costUsd / parent.costUsd
            : undefined,
      };
    })
    .sort(
      (a, b) =>
        (b.total.tokens ?? 0) - (a.total.tokens ?? 0) ||
        (b.total.costUsd ?? 0) - (a.total.costUsd ?? 0) ||
        a.label.localeCompare(b.label),
    );
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(hits: number, of: number): number | undefined {
  return of > 0 ? hits / of : undefined;
}

/** Job states that mean the work actually landed. */
const COMPLETED = new Set(["completed"]);

/**
 * One agent's operating record: what it spent, and what that bought.
 *
 * The pairing is the point. "Claude costs more" is not a routing input;
 * "Claude costs $0.91 a job and passes review first time 88% of the time,
 * against Grok at $0.39 and 69%" is. `avgSuccessfulCostUsd` exists because the
 * cheap worker that needs three attempts is not the cheap worker — dividing
 * total spend by *successes* rather than by attempts is what makes the two
 * columns comparable.
 */
export function agentUsage(
  records: readonly UsageRecord[],
  jobs: readonly WorkerJob[],
): AgentUsage[] {
  const agents = new Set<string>();

  for (const record of records) agents.add(record.agent);
  for (const job of jobs) {
    const agent = job.resolvedWorker;
    if (agent) agents.add(agent);
  }

  return [...agents]
    .map((agent) => {
      const mine = records.filter((record) => record.agent === agent);
      const myJobs = jobs.filter((job) => job.resolvedWorker === agent);
      const done = myJobs.filter((job) => COMPLETED.has(job.status));

      const costOf = (job: WorkerJob) =>
        mine
          .filter((record) => record.jobId === job.id)
          .reduce<number | undefined>(
            (sum, record) =>
              typeof record.costUsd === "number"
                ? (sum ?? 0) + record.costUsd
                : sum,
            undefined,
          );

      const jobCosts = myJobs
        .map(costOf)
        .filter((cost): cost is number => cost !== undefined);

      const successCosts = done
        .map(costOf)
        .filter((cost): cost is number => cost !== undefined);

      const reviewed = myJobs.filter((job) => job.review !== undefined);

      return {
        agent,
        label: agentLabel(agent),
        total: total(mine),
        // Hermes has runs rather than jobs; both are "times this agent was
        // asked to do something", which is the number the card wants.
        runs: agent === "hermes" ? mine.length : myJobs.length,
        completed: done.length,
        avgCostUsd: mean(jobCosts),
        avgSuccessfulCostUsd: mean(successCosts),
        firstPassReviewRate: rate(
          reviewed.filter(
            (job) =>
              job.review?.verdict === "pass" &&
              (job.review.revision ?? job.revision ?? 1) === 1,
          ).length,
          reviewed.length,
        ),
        avgRevisions: mean(
          myJobs.flatMap((job) =>
            typeof job.revision === "number" ? [job.revision] : [],
          ),
        ),
        topOperations: breakdown(
          mine,
          (record) => record.operation,
          (key) => operationLabel(key as UsageOperation),
        ).slice(0, 4),
      };
    })
    .sort(
      (a, b) =>
        (b.total.tokens ?? 0) - (a.total.tokens ?? 0) ||
        a.label.localeCompare(b.label),
    );
}

/**
 * What each job cost, beside how well it went.
 *
 * Every record carrying the job's id counts, not only the worker's own run —
 * so a job's cost includes the scoping that set it up, the review that read
 * it, and the visual verification that photographed it. That is the number
 * worth comparing between workers, because a worker whose output needs three
 * reviews is not cheap either.
 */
export function jobUsage(
  records: readonly UsageRecord[],
  jobs: readonly WorkerJob[],
): JobUsage[] {
  return jobs.map((job) => {
    const mine = records.filter((record) => record.jobId === job.id);

    return {
      jobId: job.id,
      objective: job.objective,
      project: job.project,
      agent: job.resolvedWorker,
      taskId: mine.find((record) => record.taskId)?.taskId,
      total: total(mine),
      durationMs:
        job.startedAt && job.completedAt
          ? Math.max(0, Date.parse(job.completedAt) - Date.parse(job.startedAt))
          : undefined,
      revisions: job.revision,
      reviewVerdict: job.review?.verdict,
      status: job.status,
      startedAt: job.startedAt,
    };
  });
}

/**
 * Everything that went into one task, step by step.
 *
 * The view that answers "what does a Pantry Pilot feature actually cost to
 * build with agents?" — scoping, implementation, review, visual review and
 * every revision, each as its own line rather than one opaque total.
 */
export function taskUsage(
  records: readonly UsageRecord[],
  taskId: string,
): TaskUsage {
  const mine = records.filter((record) => record.taskId === taskId);

  return {
    taskId,
    project: mine.find((record) => record.project)?.project,
    total: total(mine),
    steps: breakdown(
      mine,
      (record) => `${record.agent}:${record.operation}`,
      (key) => {
        const [agent, operation] = key.split(":");

        return `${agentLabel(agent)} ${operationLabel(
          operation as UsageOperation,
        ).toLowerCase()}`;
      },
    ),
  };
}

/**
 * What is using the tokens, ranked.
 *
 * Grouped by agent *and* operation, because neither alone is actionable.
 * "Hermes: 712k" tells you nothing you can fix; "Hermes general chat: 312k"
 * sends you somewhere specific. This is the breakdown the whole ledger exists
 * to produce.
 */
export function tokenSources(
  records: readonly UsageRecord[],
): UsageBreakdownRow[] {
  return breakdown(
    records,
    (record) => `${record.agent}:${record.operation}`,
    (key) => {
      const [agent, operation] = key.split(":");

      return `${agentLabel(agent)} ${operationLabel(
        operation as UsageOperation,
      ).toLowerCase()}`;
    },
  );
}

/**
 * How many runs of the same kind are needed before "typical" means anything.
 *
 * Three is low, and chosen deliberately: this is a warning that asks a person
 * to look, not an alert that acts. The sample size travels with the finding so
 * a judgement built on four runs can be read as one.
 */
const MIN_SAMPLE = 3;

/** How far above its own baseline a run has to be before it is worth saying. */
const ANOMALY_MULTIPLE = 2;

/**
 * Unusual runs, found by arithmetic.
 *
 * Deterministic on purpose, and 52.25's instinct is right: comparing a run
 * against this system's own rolling average for the same operation needs no
 * intelligence, costs nothing, runs in a millisecond, and cannot hallucinate a
 * problem that is not there. Asking a model whether a number looks big would
 * be slower, more expensive, and less reliable than dividing.
 *
 * The baseline is AgentOS' own history for that exact agent and operation —
 * never a global notion of what a run "should" cost. A `/project-sync` that
 * normally burns 14k tokens and just burned 41k is the finding; whether 14k is
 * a lot in the abstract is not a question this system can answer or needs to.
 *
 * The run being judged is excluded from its own baseline, which matters at
 * small sample sizes: a runaway included in its own average halves the very
 * spike it is supposed to trigger.
 */
export function findAnomalies(
  records: readonly UsageRecord[],
): import("../../shared/usage-types").UsageAnomaly[] {
  const byKind = new Map<string, UsageRecord[]>();

  for (const record of records) {
    if (typeof record.tokens.total !== "number") continue;

    const key = `${record.agent}:${record.operation}`;
    const bucket = byKind.get(key);

    if (bucket) bucket.push(record);
    else byKind.set(key, [record]);
  }

  const anomalies: import("../../shared/usage-types").UsageAnomaly[] = [];

  for (const [, bucket] of byKind) {
    if (bucket.length <= MIN_SAMPLE) continue;

    for (const record of bucket) {
      const others = bucket.filter((entry) => entry.id !== record.id);
      const typical = mean(
        others.map((entry) => entry.tokens.total as number),
      );

      if (typical === undefined || typical <= 0) continue;

      const tokens = record.tokens.total as number;
      if (tokens < typical * ANOMALY_MULTIPLE) continue;

      anomalies.push({
        id: record.id,
        timestamp: record.timestamp,
        operation: record.operation,
        agent: record.agent,
        label: `${agentLabel(record.agent)} ${operationLabel(
          record.operation,
        ).toLowerCase()}`,
        tokens,
        typicalTokens: Math.round(typical),
        sampleSize: others.length,
        project: record.project,
        jobId: record.jobId,
      });
    }
  }

  return anomalies.sort(
    (a, b) => b.tokens / b.typicalTokens - a.tokens / a.typicalTokens,
  );
}
