import type { UsageMeasurement, UsageTokens } from "../../../shared/usage-types";
import type { WorkerProviderMetrics } from "../../../shared/worker-types";

/**
 * Claude's usage, as the Agent SDK reports it.
 *
 * The SDK is the best-instrumented runner AgentOS has: its closing result
 * carries a priced `total_cost_usd` alongside a full token breakdown including
 * cache reads and writes. Both are `exact` — this is the provider's own
 * accounting, not a reconstruction.
 *
 * Cache creation and cache read are summed into one `cachedInput` figure. They
 * are priced differently by Anthropic, but AgentOS does not price anything
 * itself — it reads the cost the SDK already computed — so keeping them apart
 * downstream would add a distinction nothing consumes.
 */

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Adds only the parts that are actually there. */
function sum(parts: (number | undefined)[]): number | undefined {
  const known = parts.filter((part): part is number => part !== undefined);

  return known.length > 0 ? known.reduce((a, b) => a + b, 0) : undefined;
}

/** Reads the `usage` block off the SDK's final result message. */
export function readClaudeUsage(value: unknown): {
  tokens: UsageTokens;
  status: UsageMeasurement;
} {
  const usage = asRecord(value);

  if (!usage) return { tokens: {}, status: "unknown" };

  const cachedInput = sum([
    asNumber(usage.cache_read_input_tokens),
    asNumber(usage.cache_creation_input_tokens),
  ]);

  const tokens: UsageTokens = {
    input: asNumber(usage.input_tokens),
    output: asNumber(usage.output_tokens),
    cachedInput,
    reasoning: asNumber(usage.reasoning_output_tokens),
  };

  const measured =
    tokens.input !== undefined ||
    tokens.output !== undefined ||
    cachedInput !== undefined;

  return { tokens, status: measured ? "exact" : "unknown" };
}

/** The worker's recorded metrics, in the ledger's vocabulary. */
export function claudeUsageFromMetrics(metrics: WorkerProviderMetrics): {
  tokens: UsageTokens;
  status: UsageMeasurement;
  costStatus: UsageMeasurement;
} {
  const tokens: UsageTokens = {
    input: metrics.inputTokens,
    output: metrics.outputTokens,
    cachedInput: metrics.cachedTokens,
    reasoning: metrics.reasoningTokens,
    total: metrics.totalTokens,
  };

  return {
    tokens,
    status: metrics.measurement ?? "unknown",
    costStatus: metrics.costUsd === undefined ? "unknown" : "exact",
  };
}
