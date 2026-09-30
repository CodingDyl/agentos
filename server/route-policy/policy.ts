import {
  ROUTE_POLICY_VERSION,
  type ExecutionOption,
  type OptionRef,
  type RejectedOption,
  type RoutePolicyRecord,
  type RoutingMode,
  type TaskProfile,
} from "../../shared/route-policy-types";

/**
 * Choosing an execution option for a profiled task.
 *
 * A pure function of (profile, options, mode, load). Requirements and
 * permissions are hard filters applied first; speed and cost only order what
 * survives them. Nothing is truncated to make a task fit: an option whose
 * limits the task exceeds is ineligible, and its rejection says by how much.
 */

export interface RoutePolicyInput {
  profile: TaskProfile;
  options: ExecutionOption[];
  mode: RoutingMode;
  /** With `manual`, the option the operator picked. */
  manualOptionId?: string;
  /** Jobs currently running per option id, for the concurrency note. */
  activeCounts?: Record<string, number>;
  /** How many fallbacks may be planned. One by default: no chains, no loops. */
  maxFallbacks?: number;
  now?: () => Date;
}

const ref = (option: ExecutionOption): OptionRef => ({
  optionId: option.id,
  workerId: option.workerId,
  modelId: option.modelId,
  location: option.location,
});

/** Why this option cannot take this task, or undefined when it can. */
export function ineligibleReason(
  option: ExecutionOption,
  profile: TaskProfile,
  effectiveLocality: "local_only" | "cloud_allowed",
): string | undefined {
  if (option.embeddingOnly) {
    return "Embedding-only model; it cannot generate chat or completion output.";
  }
  if (!option.enabled) {
    return option.location === "local"
      ? "Installed but not enabled for routing. Enable it and configure its capabilities first."
      : "Not enabled.";
  }
  if (!option.available) return option.unavailableReason ?? "Not available.";

  // A model shown to be unable to do bounded tasks is not offered them, however
  // convenient it is (for instance, already loaded in memory). Changing its
  // limits or re-pulling it makes the verdict stale, which lifts this until it
  // is tested again.
  if (option.probeVerdict === "unsuitable") {
    return "Failed its suitability test, so it is not used automatically. Fix its limits or choose another model, then test it again.";
  }

  if (effectiveLocality === "local_only" && option.location !== "local") {
    return "Task is local-only; cloud providers are not permitted.";
  }

  const missing = profile.requiredCapabilities.filter(
    (capability) => !option.capabilities.includes(capability),
  );
  if (missing.length > 0) {
    return `Lacks required capability: ${missing.join(", ")}.`;
  }

  if (option.categories.length > 0 && !option.categories.includes(profile.category)) {
    return `Not configured for ${profile.category} tasks.`;
  }

  if (
    option.maxInputTokens !== undefined &&
    profile.estimatedInputTokens > option.maxInputTokens
  ) {
    return `Input (~${profile.estimatedInputTokens} tokens, estimated) exceeds the ${option.maxInputTokens}-token limit; it will not be truncated.`;
  }
  if (
    option.maxOutputTokens !== undefined &&
    profile.outputBudgetTokens > option.maxOutputTokens
  ) {
    return `Output budget (${profile.outputBudgetTokens} tokens) exceeds the ${option.maxOutputTokens}-token limit.`;
  }

  const { deadlineMs, budgetUsd } = profile.constraints;
  if (deadlineMs !== undefined && option.timeoutMs !== undefined && option.timeoutMs > deadlineMs) {
    return `Timeout (${option.timeoutMs} ms) exceeds the task deadline (${deadlineMs} ms).`;
  }
  if (budgetUsd !== undefined && option.location === "cloud") {
    if (option.costUsdPerJob === undefined) {
      return "Task has a budget but this option's cost is unknown.";
    }
    if (option.costUsdPerJob > budgetUsd) {
      return `Configured cost $${option.costUsdPerJob.toFixed(2)} exceeds the $${budgetUsd.toFixed(2)} budget.`;
    }
  }

  return undefined;
}

/** Lower sorts first. Deterministic: ties fall through to the option id. */
function preferenceKey(option: ExecutionOption, preferLocal: boolean): [number, number, number, number, string] {
  const locality = (option.location === "local") === preferLocal ? 0 : 1;
  // Shown to work beats not yet tested; being loaded only breaks the tie after
  // that, so convenience never outranks evidence.
  const tested = option.probeVerdict === "suitable" ? 0 : 1;
  const loaded = option.loaded ? 0 : 1;
  const cost = option.costUsdPerJob ?? Number.POSITIVE_INFINITY;
  return [locality, tested, loaded, cost, option.id];
}

function compareKeys(a: ReturnType<typeof preferenceKey>, b: ReturnType<typeof preferenceKey>): number {
  for (let i = 0; i < 4; i += 1) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return Number.isNaN(diff) ? 0 : diff;
  }
  return a[4].localeCompare(b[4]);
}

export function decideRoute(input: RoutePolicyInput): RoutePolicyRecord {
  const { profile, options, mode } = input;
  const decidedAt = (input.now?.() ?? new Date()).toISOString();
  const maxFallbacks = input.maxFallbacks ?? 1;

  // "Local only" mode tightens the task; it can never loosen it.
  const locality =
    mode === "local_only" || profile.constraints.locality === "local_only"
      ? "local_only"
      : "cloud_allowed";

  const rejected: RejectedOption[] = [];
  const eligible: ExecutionOption[] = [];

  for (const option of options) {
    const reason = ineligibleReason(option, profile, locality);
    if (reason) rejected.push({ optionId: option.id, reason });
    else eligible.push(option);
  }

  const base = {
    policyVersion: ROUTE_POLICY_VERSION,
    mode,
    profile,
    rejected,
    decidedAt,
  };

  const blocked = (blockedReason: string, retryable: boolean): RoutePolicyRecord => ({
    ...base,
    status: "blocked",
    reason: blockedReason,
    blockedReason,
    retryable,
    fallbackPlan: [],
    overriddenByOperator: mode === "manual",
  });

  if (mode === "manual") {
    const chosen = options.find((option) => option.id === input.manualOptionId);
    if (!chosen) {
      return blocked(`Override rejected: "${input.manualOptionId ?? ""}" is not a known execution option.`, false);
    }
    const why = rejected.find((entry) => entry.optionId === chosen.id)?.reason;
    if (why) return blocked(`Override rejected: ${why}`, false);

    return finish(base, chosen, eligible, `Operator selected ${chosen.id}.`, input, maxFallbacks, true);
  }

  if (eligible.length === 0) {
    // Retryable only when the sole obstacle is something that can clear: a
    // local option exists but is unavailable. Nothing configured is not retryable.
    const localWaiting = options.some(
      (option) =>
        option.location === "local" &&
        option.enabled &&
        !option.embeddingOnly &&
        !option.available,
    );
    const localOnly = locality === "local_only";

    return blocked(
      localOnly && localWaiting
        ? "Task is local-only and no local model is available right now. It was not sent to the cloud."
        : localOnly
          ? "Task is local-only and no enabled local model can take it. It was not sent to the cloud."
          : "No execution option satisfies this task's requirements.",
      localOnly && localWaiting,
    );
  }

  // Hard requirements decide *who can*; only then does preference decide *who*.
  // Complex, uncertain, or tool-needing work goes to a capable existing worker
  // when one is eligible; small bounded work prefers local.
  const preferLocal = profile.complexity !== "complex" && !profile.routingUncertain;
  const ordered = [...eligible].sort((a, b) =>
    compareKeys(preferenceKey(a, preferLocal), preferenceKey(b, preferLocal)),
  );
  const winner = ordered[0];

  return finish(base, winner, ordered, explain(winner, profile, preferLocal, locality), input, maxFallbacks, false);
}

function explain(
  option: ExecutionOption,
  profile: TaskProfile,
  preferLocal: boolean,
  locality: "local_only" | "cloud_allowed",
): string {
  const target = option.modelId ? `${option.workerId} (${option.modelId})` : option.workerId;
  const size = `${profile.category}, ${profile.complexity}`;

  if (locality === "local_only") {
    return `${target}: task is local-only (${size}); this is an eligible local option.`;
  }
  if (option.location === "local") {
    return `${target}: small bounded ${size} task within local limits${option.probeVerdict === "suitable" ? "; passed its suitability test" : ""}${option.loaded ? "; model already loaded" : ""}.`;
  }
  if (!preferLocal) {
    return `${target}: ${profile.complexityReason} Routed to a capable existing worker.`;
  }
  return `${target}: no eligible local option; ${size} task routed to an existing worker.`;
}

function finish(
  base: Pick<RoutePolicyRecord, "policyVersion" | "mode" | "profile" | "rejected" | "decidedAt">,
  selected: ExecutionOption,
  pool: ExecutionOption[],
  reason: string,
  input: RoutePolicyInput,
  maxFallbacks: number,
  overridden: boolean,
): RoutePolicyRecord {
  const active = input.activeCounts?.[selected.id] ?? 0;
  const atCapacity =
    selected.concurrencyLimit !== undefined && active >= selected.concurrencyLimit;

  return {
    ...base,
    status: "selected",
    selected: ref(selected),
    reason,
    queued: atCapacity || undefined,
    // Every entry in `pool` already passed the task's locality, capability and
    // budget filters, so a fallback can never widen what the task permits.
    fallbackPlan: pool
      .filter((option) => option.id !== selected.id)
      .slice(0, maxFallbacks)
      .map(ref),
    overriddenByOperator: overridden,
  };
}
