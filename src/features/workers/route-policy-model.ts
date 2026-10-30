import type {
  ExecutionAttempt,
  ProbeRecord,
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
  return !job.worktreePath && (Boolean(job.routing?.policy) || Boolean(job.bridge)) && Boolean(job.result);
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

export type ProbeTone = "good" | "bad" | "neutral";

/**
 * What to say about a model's last suitability test, given its current limits.
 * A verdict is only as good as the build and limits it was measured with, so
 * a changed digest or edited limits downgrade it to "test again", not "still
 * fine".
 */
export function probeBadge(
  record: ProbeRecord | undefined,
  config: Pick<OllamaModelConfig, "maxInputTokens" | "maxOutputTokens" | "timeoutMs">,
): { label: string; tone: ProbeTone } {
  if (!record) return { label: "Not tested", tone: "neutral" };
  if (record.stale) return { label: "Tested on an older build: test again", tone: "neutral" };

  const changed =
    record.limits.maxInputTokens !== config.maxInputTokens ||
    record.limits.maxOutputTokens !== config.maxOutputTokens ||
    record.limits.timeoutMs !== config.timeoutMs;
  if (changed) return { label: "Limits changed since the last test: test again", tone: "neutral" };

  return record.verdict === "suitable"
    ? { label: "Passed suitability test", tone: "good" }
    : { label: "Failed suitability test", tone: "bad" };
}

/** A warning for enabling a model that has been shown unsuitable, or nothing. */
export function enableWarning(
  record: ProbeRecord | undefined,
  config: Pick<OllamaModelConfig, "enabled" | "maxInputTokens" | "maxOutputTokens" | "timeoutMs">,
): string | undefined {
  if (!config.enabled) return undefined;
  const badge = probeBadge(record, config);
  if (badge.tone === "bad") {
    return "This model failed its suitability test, so automatic routing skips it. Fix its limits or choose another model, then test it again.";
  }
  return undefined;
}

export interface BlockExplanation {
  /** One plain sentence: what stopped the task. */
  headline: string;
  /** Why, in order of importance. */
  causes: string[];
  /** What the person can do about it, most useful first. */
  fixes: string[];
}

const CAPABILITY_WORDS: Record<string, string> = {
  vision: "look at images",
  repository: "work in a repository",
  tools: "use tools",
  file_writes: "write files",
  web: "browse the web",
  structured_output: "return structured output",
  text: "handle text",
};

const capabilityWords = (capability: string): string => CAPABILITY_WORDS[capability] ?? capability;

/**
 * Turns a blocked route into something a person can act on.
 *
 * The router's own finding is accurate but terse ("No execution option
 * satisfies this task's requirements"). This reads the ruled-out list and says
 * which requirement did the blocking and what, concretely, would unblock it.
 * Never invents a cause: a rejection it cannot classify is passed through in
 * the router's words.
 */
export function explainBlock(record: RoutePolicyRecord): BlockExplanation {
  const reason = record.blockedReason ?? record.reason;

  if (reason.startsWith("Override rejected")) {
    return {
      headline: "The worker you picked can't take this task.",
      causes: [reason.replace(/^Override rejected:\s*/, "")],
      fixes: ["Pick a different worker, or switch routing back to automatic."],
    };
  }

  if (reason.startsWith("Task is local-only")) {
    return {
      headline: "This task may only run on this machine, and no local model can take it.",
      causes: [reason],
      fixes: record.retryable
        ? ["Start Ollama (and mount the SSD if the model lives there), then check the route again."]
        : [
            "Enable a local model for this kind of task in Operations → AI Stack.",
            "Or allow this task to use a cloud worker.",
          ],
    };
  }

  // Count what each ruled-out option lacked, so the shared blocker stands out.
  const lacking = new Map<string, number>();
  const switchedOff: string[] = [];
  const notEnabled: string[] = [];
  const other: string[] = [];
  for (const entry of record.rejected) {
    const missing = /^Lacks required capability: (.+?)\.?$/.exec(entry.reason);
    if (missing) {
      for (const capability of missing[1].split(/,\s*/)) {
        lacking.set(capability, (lacking.get(capability) ?? 0) + 1);
      }
    } else if (/switched off/i.test(entry.reason)) {
      switchedOff.push(entry.optionId);
    } else if (/not enabled/i.test(entry.reason)) {
      notEnabled.push(entry.optionId);
    } else {
      other.push(`${entry.optionId}: ${entry.reason}`);
    }
  }

  const causes: string[] = [];
  const fixes: string[] = [];
  const total = record.rejected.length;

  // A requirement nearly every option lacks is the real blocker.
  const shared = [...lacking.entries()]
    .filter(([, count]) => count >= Math.max(2, Math.ceil(total / 2)))
    .sort((a, b) => b[1] - a[1]);
  for (const [capability, count] of shared) {
    causes.push(
      `The task needs a worker that can ${capabilityWords(capability)}, and ${count} of ${total} options can't.`,
    );
    if (capability === "vision") {
      fixes.push(
        "If the task doesn't need a worker to look at pictures, reword it without photo, image or screenshot wherever it only means the files being handled.",
      );
    } else {
      fixes.push(`Reword the task so it doesn't need a worker that can ${capabilityWords(capability)}.`);
    }
  }

  if (switchedOff.length > 0) {
    causes.push(`Switched off in Operations → AI Stack: ${switchedOff.join(", ")}.`);
    fixes.push(`Switch on ${switchedOff.join(" or ")} in Operations → AI Stack if you want it considered.`);
  }
  if (notEnabled.length > 0) {
    causes.push(`Installed but not enabled for routing: ${notEnabled.join(", ")}.`);
    fixes.push(`Enable and configure ${notEnabled.join(" or ")} in Operations → AI Stack → Local models.`);
  }
  causes.push(...other);

  if (causes.length === 0) causes.push(reason);

  return {
    headline: "No worker can take this task as it is written.",
    causes,
    fixes: fixes.length > 0 ? fixes : ["Edit the task's wording or requirements, then check the route again."],
  };
}
