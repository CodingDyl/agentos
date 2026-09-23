import { randomUUID } from "node:crypto";
import type {
  UsageMeasurement,
  UsageOperation,
  UsageRecord,
  UsageSource,
} from "../../shared/usage-types";
import { usageDatabase } from "./db";

/**
 * The usage ledger.
 *
 * One table, one writer, one vocabulary. Everything that spends tokens in
 * AgentOS lands here in the same shape, whether it was a Hermes review, a Grok
 * implementation, or an image generation — so the question "where are my
 * tokens going?" is a query rather than an investigation.
 *
 * Two rules, both learned from the stores that came before it:
 *
 * **Recording never throws into the path it observes.** A code review that
 * Hermes completed must not be reported as failed because a ledger insert hit
 * a locked database. Failures are logged and swallowed.
 *
 * **Absent stays absent.** A provider that reports no tokens writes NULLs, not
 * zeros. `SUM` over NULLs is what makes "measured" and "total" different
 * numbers downstream, and that difference is the whole honesty of the screen.
 */

/** What a caller has to supply. The id and timestamp are the ledger's. */
export interface RecordUsageInput {
  source: UsageSource;
  operation: UsageOperation;
  agent: string;
  provider?: string;
  model?: string;
  project?: string;
  taskId?: string;
  jobId?: string;
  runId?: string;
  tokens?: {
    input?: number;
    output?: number;
    cachedInput?: number;
    reasoning?: number;
    total?: number;
  };
  costUsd?: number;
  status: UsageMeasurement;
  costStatus?: UsageMeasurement;
  durationMs?: number;
  context?: { files?: number; characters?: number; estimatedTokens?: number };
  timestamp?: string;
}

/** SQLite takes numbers or null; `undefined` is not a bindable value. */
function bind(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bindText(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A total, only where one can honestly be given.
 *
 * Derived from the parts when the provider did not supply one, and only when
 * at least one part is known — summing `undefined + undefined` into `0` would
 * claim a run consumed nothing, which is the exact failure this layer exists
 * to avoid. Cached input counts towards the total because it was still context
 * the model received; it is kept separately as well so it can be priced apart.
 */
export function deriveTotal(
  tokens: RecordUsageInput["tokens"],
): number | undefined {
  if (!tokens) return undefined;
  if (typeof tokens.total === "number") return tokens.total;

  const parts = [
    tokens.input,
    tokens.output,
    tokens.cachedInput,
    tokens.reasoning,
  ].filter((part): part is number => typeof part === "number");

  return parts.length > 0
    ? parts.reduce((sum, part) => sum + part, 0)
    : undefined;
}

const INSERT = `
  INSERT INTO usage_events (
    id, timestamp, source, operation, agent, provider, model,
    project, task_id, job_id, run_id,
    input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
    cost_usd, status, cost_status, duration_ms,
    context_files, context_characters, context_estimated_tokens
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?
  )
`;

/**
 * Records one execution's usage.
 *
 * Returns the record it wrote, or `undefined` when it could not write. Callers
 * are expected to ignore the return value — it exists for tests and for the
 * few places that want to echo what was measured.
 */
export function recordUsage(input: RecordUsageInput): UsageRecord | undefined {
  const total = deriveTotal(input.tokens);

  const record: UsageRecord = {
    id: `use-${randomUUID()}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    source: input.source,
    operation: input.operation,
    agent: input.agent,
    provider: input.provider,
    model: input.model,
    project: input.project,
    taskId: input.taskId,
    jobId: input.jobId,
    runId: input.runId,
    tokens: { ...input.tokens, total },
    costUsd: input.costUsd,
    status: input.status,
    // Cost is measured separately from tokens: Grok reports exact tokens and
    // no price, so one run is honestly `exact` and `unknown` at once.
    costStatus:
      input.costStatus ??
      (typeof input.costUsd === "number" ? "exact" : "unknown"),
    durationMs: input.durationMs,
    context: input.context,
  };

  try {
    usageDatabase()
      .prepare(INSERT)
      .run(
        record.id,
        record.timestamp,
        record.source,
        record.operation,
        record.agent,
        bindText(record.provider),
        bindText(record.model),
        bindText(record.project),
        bindText(record.taskId),
        bindText(record.jobId),
        bindText(record.runId),
        bind(record.tokens.input),
        bind(record.tokens.output),
        bind(record.tokens.cachedInput),
        bind(record.tokens.reasoning),
        bind(record.tokens.total),
        bind(record.costUsd),
        record.status,
        record.costStatus,
        bind(record.durationMs),
        bind(record.context?.files),
        bind(record.context?.characters),
        bind(record.context?.estimatedTokens),
      );

    return record;
  } catch (error) {
    console.error("[agentos] could not record usage:", error);
    return undefined;
  }
}

/** One row as SQLite hands it back. */
interface UsageRow {
  id: string;
  timestamp: string;
  source: string;
  operation: string;
  agent: string;
  provider: string | null;
  model: string | null;
  project: string | null;
  task_id: string | null;
  job_id: string | null;
  run_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  status: string;
  cost_status: string;
  duration_ms: number | null;
  context_files: number | null;
  context_characters: number | null;
  context_estimated_tokens: number | null;
}

function text(value: string | null): string | undefined {
  return value ?? undefined;
}

function num(value: number | null): number | undefined {
  return value === null ? undefined : value;
}

/** A stored row, back in the shared shape. */
export function toRecord(row: UsageRow): UsageRecord {
  const context =
    row.context_files === null &&
    row.context_characters === null &&
    row.context_estimated_tokens === null
      ? undefined
      : {
          files: num(row.context_files),
          characters: num(row.context_characters),
          estimatedTokens: num(row.context_estimated_tokens),
        };

  return {
    id: row.id,
    timestamp: row.timestamp,
    source: row.source as UsageSource,
    operation: row.operation as UsageOperation,
    agent: row.agent,
    provider: text(row.provider),
    model: text(row.model),
    project: text(row.project),
    taskId: text(row.task_id),
    jobId: text(row.job_id),
    runId: text(row.run_id),
    tokens: {
      input: num(row.input_tokens),
      output: num(row.output_tokens),
      cachedInput: num(row.cached_tokens),
      reasoning: num(row.reasoning_tokens),
      total: num(row.total_tokens),
    },
    costUsd: num(row.cost_usd),
    status: row.status as UsageMeasurement,
    costStatus: row.cost_status as UsageMeasurement,
    durationMs: num(row.duration_ms),
    context,
  };
}

export interface UsageQuery {
  /** Inclusive ISO lower bound. */
  from?: string;
  /** Exclusive ISO upper bound. */
  to?: string;
  project?: string;
  agent?: string;
  jobId?: string;
  taskId?: string;
  limit?: number;
}

/**
 * Reads records, newest first.
 *
 * Filters are composed into the WHERE clause as bound parameters — never
 * interpolated — so a project slug out of the vault cannot reach the query
 * planner as SQL.
 */
export function readUsage(query: UsageQuery = {}): UsageRecord[] {
  const clauses: string[] = [];
  const values: (string | number)[] = [];

  if (query.from) {
    clauses.push("timestamp >= ?");
    values.push(query.from);
  }
  if (query.to) {
    clauses.push("timestamp < ?");
    values.push(query.to);
  }
  if (query.project) {
    clauses.push("project = ?");
    values.push(query.project);
  }
  if (query.agent) {
    clauses.push("agent = ?");
    values.push(query.agent);
  }
  if (query.jobId) {
    clauses.push("job_id = ?");
    values.push(query.jobId);
  }
  if (query.taskId) {
    clauses.push("task_id = ?");
    values.push(query.taskId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(query.limit ?? 5_000, 1), 50_000);

  try {
    const rows = usageDatabase()
      .prepare(
        `SELECT * FROM usage_events ${where} ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(...values, limit) as unknown as UsageRow[];

    return rows.map(toRecord);
  } catch (error) {
    console.error("[agentos] could not read usage:", error);
    return [];
  }
}
