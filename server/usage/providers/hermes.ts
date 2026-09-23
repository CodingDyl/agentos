import type { UsageMeasurement, UsageTokens } from "../../../shared/usage-types";

/**
 * Reading Hermes' usage off an OpenAI-compatible reply.
 *
 * Hermes speaks the `/v1/chat/completions` shape, which carries a `usage`
 * object when the upstream model reported one — and simply omits it when the
 * model, gateway or proxy did not. Both are normal, and the difference is
 * exactly what `measurement` records.
 *
 * Nothing here estimates. A reply with no usage block produces `unknown`, not
 * a character-count guess dressed up as a token count.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export interface HermesUsage {
  tokens: UsageTokens;
  status: UsageMeasurement;
  model?: string;
  costUsd?: number;
  costStatus: UsageMeasurement;
}

/**
 * Pulls tokens, model and any cost out of one completion payload.
 *
 * Field names are read tolerantly — OpenAI's own `prompt_tokens` and the
 * camelCase variants some gateways emit both appear in the wild — because a
 * naming difference should cost a breakdown row, not the whole reading.
 *
 * Cached tokens live in a nested `prompt_tokens_details` on OpenAI-compatible
 * replies. They are pulled out separately rather than folded into input,
 * because cache reads are the cheapest tokens in the system and a screen that
 * hid them would make a well-cached run look as expensive as a cold one.
 */
export function readHermesUsage(payload: unknown): HermesUsage {
  const body = asRecord(payload);
  const usage = asRecord(body?.usage);
  const model = asString(body?.model);

  if (!usage) {
    return { tokens: {}, status: "unknown", model, costStatus: "unknown" };
  }

  const promptDetails = asRecord(usage.prompt_tokens_details);
  const completionDetails = asRecord(usage.completion_tokens_details);

  const input = asNumber(usage.prompt_tokens) ?? asNumber(usage.input_tokens);
  const output =
    asNumber(usage.completion_tokens) ?? asNumber(usage.output_tokens);

  const tokens: UsageTokens = {
    input,
    output,
    cachedInput:
      asNumber(promptDetails?.cached_tokens) ??
      asNumber(usage.cached_tokens) ??
      asNumber(usage.cache_read_input_tokens),
    reasoning:
      asNumber(completionDetails?.reasoning_tokens) ??
      asNumber(usage.reasoning_tokens),
    total: asNumber(usage.total_tokens),
  };

  // Some gateways (OpenRouter among them) price the call in the reply. When
  // one does, that is a real figure rather than a rate-table guess.
  const costUsd = asNumber(usage.cost) ?? asNumber(usage.total_cost);

  const measured =
    tokens.input !== undefined ||
    tokens.output !== undefined ||
    tokens.total !== undefined;

  return {
    tokens,
    status: measured ? "exact" : "unknown",
    model,
    costUsd,
    costStatus: costUsd === undefined ? "unknown" : "exact",
  };
}
