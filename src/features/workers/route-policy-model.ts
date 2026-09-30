import type {
  ExecutionAttempt,
  ExecutionOption,
  OllamaModelConfig,
  RoutePolicyRecord,
  TaskCategory,
} from "@shared/route-policy-types";
import type { WorkerJob } from "@shared/worker-types";

/**
 * View model for routing: what the screens say about where work ran and why.
 *
 * Kept free of React so the wording that matters (what a local run cost, why
 * something failed) is tested rather than trusted. Two rules run through it:
 * unknown stays unknown, and local execution is described as a $0 *provider
 * API charge*, never as free.
 */

export const TASK_CATEGORIES: readonly TaskCategory[] = [
  "summarisation",
  "extraction",
  "rewriting",
  "classification",
  "explanation",
  "coding",
  "research",
  "other",
];

/** "Ollama · qwen3:4b" for a model, the worker's own name otherwise. */
export function optionLabel(
  option: Pick<ExecutionOption, "workerId" | "modelId">,
  workerName?: (id: ExecutionOption["workerId"]) => string,
): string {
  const worker = workerName?.(option.workerId) ?? option.workerId;
  return option.modelId ? `${worker} · ${option.modelId}` : worker;
}

/** A policy-routed job that produced text rather than a checkout. */
export function isTextResultJob(job: WorkerJob): boolean {
  return !job.worktreePath && Boolean(job.routing?.policy) && Boolean(job.result);
}

const FAILURE_LABELS: Record<string, string> = {
  offline: "Ollama was not reachable",
  model_missing: "Model not installed (is the SSD mounted?)",
  load_failed: "Model failed to load",
  timeout: "Timed out",
  cancelled: "Cancelled",
  invalid_output: "Output failed validation",
  empty_output: "Empty output",
  input_too_large: "Input too large for the model",
  output_truncated: "Output was cut off at the token limit",
  not_configured: "Not configured for this task",
  http_error: "Ollama returned an error",
  worker_error: "Worker error",
};

export function failureLabel(kind: string | undefined): string {
  if (!kind) return "Failed";
  return FAILURE_LABELS[kind] ?? kind.replace(/_/g, " ");
}

/** `1.2s`, `840ms`, or nothing when the provider did not report it. */
export function formatMs(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * What the run cost, in words that do not overclaim.
 *
 * A local run has no provider API charge. That says nothing about electricity
 * or hardware wear, so the label says exactly what is known and no more.
 */
export function providerChargeLabel(
  metrics: { location?: "local" | "cloud"; costUsd?: number } | undefined,
): string {
  if (!metrics) return "Cost unknown";
  if (metrics.location === "local") return "$0 provider API charge (local run)";
  return typeof metrics.costUsd === "number" ? `$${metrics.costUsd.toFixed(2)}` : "Cost unknown";
}

export const LOCAL_COST_CAVEAT = "Electricity and hardware use are not included.";

/** One line per attempt: where it ran, how it ended, what it used. */
export function describeAttempt(attempt: ExecutionAttempt): string {
  const parts: string[] = [];

  parts.push(
    attempt.outcome === "succeeded"
      ? "Succeeded"
      : attempt.outcome === "cancelled"
        ? "Cancelled"
        : attempt.outcome === "running"
          ? "Running"
          : failureLabel(attempt.failureKind),
  );

  if (attempt.inputTokens !== undefined || attempt.outputTokens !== undefined) {
    parts.push(`${attempt.inputTokens ?? "?"} in / ${attempt.outputTokens ?? "?"} out tokens`);
  }

  const timings = [
    attempt.queueMs ? `queued ${formatMs(attempt.queueMs)}` : undefined,
    attempt.loadMs ? `model load ${formatMs(attempt.loadMs)}` : undefined,
    attempt.totalMs ? `total ${formatMs(attempt.totalMs)}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (timings.length > 0) parts.push(timings.join(", "));

  return parts.join(" · ");
}

/** A fallback happened when more than one attempt was made. */
export function fellBack(job: Pick<WorkerJob, "attempts">): boolean {
  return (job.attempts?.length ?? 0) > 1;
}

/** The blocked or selected headline for the task screen. */
export function routeHeadline(record: RoutePolicyRecord): string {
  if (record.status === "blocked") return record.blockedReason ?? record.reason;
  return record.reason;
}

/** Why a model's configuration cannot be saved, or nothing. */
export function modelConfigProblem(config: OllamaModelConfig): string | undefined {
  if (!Number.isInteger(config.maxInputTokens) || config.maxInputTokens <= 0) {
    return "Input limit must be a positive whole number of tokens.";
  }
  if (!Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens <= 0) {
    return "Output limit must be a positive whole number of tokens.";
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000) {
    return "Timeout must be at least 1 second.";
  }
  if (config.enabled && config.categories.length === 0) {
    return "Pick at least one task category before enabling a model.";
  }
  return undefined;
}

export function toggleCategory(categories: TaskCategory[], category: TaskCategory): TaskCategory[] {
  return categories.includes(category)
    ? categories.filter((entry) => entry !== category)
    : [...categories, category];
}

/** Parses the optional JSON Schema box: empty is fine, malformed is a message. */
export function parseSchemaInput(text: string): { schema?: Record<string, unknown>; error?: string } {
  if (text.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: "The schema must be a JSON object." };
    }
    return { schema: parsed as Record<string, unknown> };
  } catch {
    return { error: "The schema is not valid JSON." };
  }
}

export function shortDigest(digest: string | undefined): string | undefined {
  if (!digest) return undefined;
  return digest.replace(/^sha256:/, "").slice(0, 12);
}
