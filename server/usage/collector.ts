import type {
  UsageContext,
  UsageOperation,
  UsageRecord,
} from "../../shared/usage-types";
import type { WorkerJob } from "../../shared/worker-types";
import { recordUsage } from "./ledger";
import { claudeUsageFromMetrics } from "./providers/claude";
import { grokUsageFromMetrics } from "./providers/grok";
import { readHermesUsage } from "./providers/hermes";

/**
 * Where usage is turned into a ledger entry.
 *
 * The collector exists so that instrumenting a call site is one line rather
 * than twenty. A caller says what it was doing and hands over whatever the
 * provider returned; the provider modules normalise it, and the ledger stores
 * it. No call site anywhere in AgentOS knows the ledger's schema.
 *
 * **Attribution is inherited, never re-derived.** AgentOS already carries the
 * chain a person cares about:
 *
 * ```text
 * Project  →  Task  →  Worker Job  →  Provider Run
 * ```
 *
 * Each instrumentation point passes down whichever of those it holds, so a
 * Hermes review recorded against a job is automatically attributable to that
 * job's task and project without a lookup — and "what did Pantry Pilot cost
 * this month" is one query rather than a join across four stores.
 *
 * **Nothing here sees content.** The collector takes usage blocks and ids. A
 * prompt cannot reach it, which is why no prompt can reach the database.
 */

/** Which provider actually billed each agent's work. */
const PROVIDER_BY_AGENT: Record<string, string> = {
  claude: "anthropic",
  grok: "xai",
  "claude-code": "anthropic",
  codex: "openai",
  gemini: "google",
  "hermes-worker": "hermes",
};

export interface HermesUsageInput {
  operation: UsageOperation;
  /** The raw completion payload. Read for `usage` and `model`, nothing else. */
  payload: unknown;
  project?: string;
  taskId?: string;
  jobId?: string;
  runId?: string;
  durationMs?: number;
  context?: UsageContext;
}

/**
 * Records one Hermes call.
 *
 * Every `sendToHermes` caller in the server routes through here with its own
 * operation, which is what turns "Hermes used 900k tokens" into "Hermes visual
 * reviews used 240k tokens" — the difference between a number and a decision.
 */
export function collectHermesUsage(
  input: HermesUsageInput,
): UsageRecord | undefined {
  const usage = readHermesUsage(input.payload);

  return recordUsage({
    source: input.operation === "automation" ? "automation" : "hermes",
    operation: input.operation,
    agent: "hermes",
    provider: "hermes",
    model: usage.model,
    project: input.project,
    taskId: input.taskId,
    jobId: input.jobId,
    runId: input.runId,
    tokens: usage.tokens,
    costUsd: usage.costUsd,
    status: usage.status,
    costStatus: usage.costStatus,
    durationMs: input.durationMs,
    context: input.context,
  });
}

/**
 * Records what a finished worker job consumed.
 *
 * Called once, when the job's result is written — not per revision. A job that
 * went back to the worker twice produces three records, one per run, because
 * each run is a separate execution with its own cost, and collapsing them
 * would make revisions look free.
 */
export function collectWorkerUsage(
  job: WorkerJob,
  context?: UsageContext,
): UsageRecord | undefined {
  const metrics = job.result?.providerMetrics;
  const agent = job.resolvedWorker ?? (job.worker === "auto" ? undefined : job.worker);

  if (!metrics || !agent) return undefined;

  const usage =
    agent === "grok"
      ? grokUsageFromMetrics(metrics)
      : claudeUsageFromMetrics(metrics);

  return recordUsage({
    source: "worker",
    operation: "implementation",
    agent,
    provider: metrics.provider ?? PROVIDER_BY_AGENT[agent],
    model: metrics.model,
    project: job.project,
    taskId: readTaskId(job),
    jobId: job.id,
    tokens: usage.tokens,
    costUsd: metrics.costUsd,
    status: usage.status,
    costStatus: usage.costStatus,
    durationMs: elapsed(job.startedAt, job.completedAt),
    context,
  });
}

/**
 * The task a job came from, when it came from one.
 *
 * Tasks reach a worker as an objective rather than as a field, so the id is
 * recovered from the stable `PP-014`-style prefix Step 46 put on them. A
 * mis-read here costs a row in the task breakdown, never a wrong total, so
 * pattern-matching is the right amount of effort.
 */
export function readTaskId(job: WorkerJob): string | undefined {
  const fromCriteria = job.acceptanceCriteria?.join(" ") ?? "";
  const haystack = `${job.objective} ${fromCriteria}`;

  return /\b([A-Z]{2,5}-\d{1,5})\b/.exec(haystack)?.[1];
}

function elapsed(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;

  const span = Date.parse(to) - Date.parse(from);

  return Number.isFinite(span) && span >= 0 ? span : undefined;
}
