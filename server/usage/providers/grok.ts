import type { UsageMeasurement, UsageTokens } from "../../../shared/usage-types";
import type { WorkerProviderMetrics } from "../../../shared/worker-types";

/**
 * Grok's usage, as Grok Build reports it.
 *
 * Grok counts and does not price. Its ACP stream carries token figures on the
 * per-response `usage` events and on the closing `end`, and nothing anywhere
 * says what a run cost in dollars.
 *
 * That produces the case this whole layer was designed around: **exact tokens,
 * unknown cost, in the same record.** Multiplying Grok's tokens by a rate
 * AgentOS would have to hardcode — and then keep current against a provider
 * that changes it — would manufacture a figure indistinguishable on screen
 * from Claude's real one. The screen says `—` instead, and that is the honest
 * answer until xAI exposes a price or the operator records a prepaid balance.
 */
export function grokUsageFromMetrics(metrics: WorkerProviderMetrics): {
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

  const measured =
    tokens.input !== undefined ||
    tokens.output !== undefined ||
    tokens.total !== undefined;

  return {
    tokens,
    status: metrics.measurement ?? (measured ? "exact" : "unknown"),
    // Never anything else, until Grok reports a price of its own.
    costStatus: metrics.costUsd === undefined ? "unknown" : "exact",
  };
}
