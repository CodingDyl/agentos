import {
  ROUTE_POLICY_VERSION,
  type ExecutionAttempt,
  type ExecutionOption,
  type OptionRef,
  type RequiredCapability,
  type RoutePolicyRecord,
} from "../../shared/route-policy-types";
import type { WorkerRoutingDecision } from "../../shared/worker-routing-types";
import { WorkerIdSchema } from "../../shared/worker-ids";
import type { WorkerCapability, WorkerJob, WorkerJobRequest } from "../../shared/worker-types";
import { ollamaSettings } from "../ai-stack/settings";
import { discoverOllama } from "../workers/providers/ollama-client";
import { listWorkers } from "../workers/registry";
import { routeJob } from "../workers/router";
import { buildOllamaOptions, DEFAULT_OLLAMA_BASE_URL } from "./ollama-config";
import { decideRoute, ineligibleReason } from "./policy";
import { profileTask } from "./profile";

/**
 * Connecting the route policy to real workers and to job dispatch.
 *
 * `policy.ts` decides; this file gathers what it decides *from* (live health,
 * Ollama discovery, configuration) and applies the result to a job. Planning
 * happens once, before dispatch. A running job is never re-profiled: the only
 * later decision is whether a failed local attempt may fall back, and that is
 * bounded by the plan made up front.
 */

/** What a worker can supply, in the policy's vocabulary. */
function capabilitiesOf(worker: { capabilities: WorkerCapability[] }): RequiredCapability[] {
  const provided = new Set<RequiredCapability>(["text", "structured_output"]);
  for (const capability of worker.capabilities) {
    if (capability === "code") {
      provided.add("tools");
      provided.add("repository");
      provided.add("file_writes");
    }
    if (capability === "web") provided.add("web");
    if (capability === "images") provided.add("vision");
  }
  return [...provided];
}

/**
 * Every place a task could run right now: the registered workers plus each
 * configured Ollama model. Rehearsal workers are excluded, as in legacy routing.
 */
export async function collectExecutionOptions(): Promise<ExecutionOption[]> {
  const options: ExecutionOption[] = [];

  for (const worker of listWorkers()) {
    if (worker.simulated) continue;

    if (worker.id === "ollama") continue; // one option per model, below

    const health = await worker.healthCheck().catch(() => ({
      available: false,
      reason: "The worker could not report its health.",
    }));

    options.push({
      id: worker.id,
      workerId: worker.id,
      // Every registered non-Ollama worker calls out to a hosted service, so
      // it is cloud for locality purposes. If one is ever truly local, it
      // must say so explicitly; the default is the conservative one.
      location: "cloud",
      enabled: true,
      available: health.available,
      unavailableReason: health.available ? undefined : health.reason,
      capabilities: capabilitiesOf(worker),
      categories: [],
      toolAccess: worker.capabilities.includes("code"),
      // Cost is not configured for these workers, so it stays unknown.
    });
  }

  const settings = ollamaSettings();
  const state = await discoverOllama(settings?.baseUrl || DEFAULT_OLLAMA_BASE_URL);
  options.push(...buildOllamaOptions(settings, state));

  return options;
}

export interface PlannedRoute {
  record: RoutePolicyRecord;
  /** The decision in the shape the rest of AgentOS already stores. */
  decision?: WorkerRoutingDecision;
}

export function profileFromRequest(request: WorkerJobRequest) {
  return profileTask({
    objective: request.objective,
    context: request.inputText,
    contextFiles: request.contextFiles,
    repoPath: request.repoPath,
    validationCommands: request.validationCommands,
    metadata: {
      ...request.routingHints,
      deliverable:
        request.routingHints?.deliverable ??
        (request.expectedOutput?.format === "json" ? "json" : undefined),
    },
  });
}

/** A policy record expressed as the persisted routing decision. */
export function toRoutingDecision(record: RoutePolicyRecord, decidedBy: "agentos" | "hermes" = "agentos"): WorkerRoutingDecision | undefined {
  if (!record.selected) return undefined;
  return {
    selectedWorker: record.selected.workerId,
    confidence: record.profile.routingUncertain ? "low" : "high",
    reasons: [record.reason],
    alternatives: record.rejected.flatMap((entry) => {
      // Option ids are `worker` or `worker:model`; the worker is the prefix.
      const worker = WorkerIdSchema.safeParse(entry.optionId.split(":")[0]);
      return worker.success && worker.data !== record.selected?.workerId
        ? [{ worker: worker.data, reason: `${entry.optionId}: ${entry.reason}` }]
        : [];
    }).slice(0, 6),
    decidedBy,
    decidedAt: record.decidedAt,
    policy: record,
  };
}

/**
 * Plans a route for a new job, or returns undefined to mean "use the legacy
 * path". Legacy is used only when nothing would be gained from the policy: no
 * local model is enabled and the task permits the cloud. A local-only task is
 * always planned, because "no local model" must block it, not release it.
 */
export async function planRoute(request: WorkerJobRequest): Promise<PlannedRoute | undefined> {
  const mode = request.routingMode ?? "auto";
  const profile = profileFromRequest(request);
  const options = await collectExecutionOptions();

  const localOnly = mode === "local_only" || profile.constraints.locality === "local_only";
  const hasEnabledLocal = options.some((o) => o.location === "local" && o.enabled && !o.embeddingOnly);

  if (mode !== "manual" && !localOnly && !hasEnabledLocal) return undefined;

  let record = decideRoute({
    profile,
    options,
    mode,
    manualOptionId: request.manualOptionId,
  });

  record = applyFallbackSetting(record);
  let decidedBy: "agentos" | "hermes" = "agentos";

  // Several eligible cloud workers: Hermes keeps its job of choosing among
  // them. Its answer counts only if it names a worker the policy already
  // found eligible; otherwise the deterministic pick stands.
  if (record.status === "selected" && record.selected?.location === "cloud" && mode !== "manual") {
    const eligibleCloud = options.filter(
      (o) => o.location === "cloud" && ineligibleReason(o, profile, localOnly ? "local_only" : "cloud_allowed") === undefined,
    );
    if (eligibleCloud.length > 1) {
      const hermes = await routeJob({ objective: request.objective, project: request.project }).catch(() => undefined);
      const picked = hermes?.decision && eligibleCloud.find((o) => o.id === hermes.decision?.selectedWorker);
      if (picked && picked.id !== record.selected.optionId) {
        const ref: OptionRef = { optionId: picked.id, workerId: picked.workerId, location: "cloud" };
        record = {
          ...record,
          selected: ref,
          reason: `${picked.id}: ${hermes?.decision?.reasons[0] ?? "chosen by Hermes among eligible workers"}`,
          fallbackPlan: [],
        };
        decidedBy = "hermes";
      } else if (picked) {
        decidedBy = "hermes";
      }
    }
  }

  return { record, decision: toRoutingDecision(record, decidedBy) };
}

/** A local failure only falls back to the cloud if the operator allowed it. */
function applyFallbackSetting(record: RoutePolicyRecord): RoutePolicyRecord {
  if (record.selected?.location !== "local") return record;
  const allowCloud = ollamaSettings()?.fallback === "cloud";
  if (allowCloud) return record;
  return { ...record, fallbackPlan: record.fallbackPlan.filter((entry) => entry.location === "local") };
}

/* ------------------------------------------------------------------ */
/* Fallback                                                            */
/* ------------------------------------------------------------------ */

export interface FailureInfo {
  kind: string;
  fallbackEligible: boolean;
  message: string;
}

/** Reads a thrown value without depending on any one worker's error class. */
export function failureInfo(error: unknown): FailureInfo {
  const message = error instanceof Error ? error.message : "The job failed for an unknown reason.";
  const kind = (error as { kind?: unknown })?.kind;
  const eligible = (error as { fallbackEligible?: unknown })?.fallbackEligible;
  return {
    kind: typeof kind === "string" ? kind : "worker_error",
    fallbackEligible: typeof eligible === "boolean" ? eligible : true,
    message,
  };
}

/**
 * The one permitted fallback for a failed attempt, or undefined.
 *
 * Every rule that prevents a loop or a leak is here, in one place:
 * - never after cancellation;
 * - only from a local attempt, so a failed cloud worker is never silently
 *   replaced by another;
 * - only entries of the plan made before dispatch, each used at most once;
 * - the target is re-checked against *current* health and the task's own
 *   constraints, so a local-only task can never be handed to the cloud.
 */
export async function nextFallback(
  job: WorkerJob,
  failure: FailureInfo,
  cancelled: boolean,
): Promise<OptionRef | undefined> {
  const policy = job.routing?.policy;
  if (!policy || cancelled || !failure.fallbackEligible) return undefined;

  const attempts = job.attempts ?? [];
  const last = attempts.at(-1);
  if (!last || last.location !== "local") return undefined;

  const tried = new Set(attempts.map((attempt) => attempt.optionId));
  const candidate = policy.fallbackPlan.find((entry) => !tried.has(entry.optionId));
  if (!candidate) return undefined;

  if (candidate.location === "cloud" && ollamaSettings()?.fallback !== "cloud") return undefined;

  const locality =
    policy.mode === "local_only" || policy.profile.constraints.locality === "local_only"
      ? "local_only"
      : "cloud_allowed";

  const current = (await collectExecutionOptions()).find((option) => option.id === candidate.optionId);
  if (!current) return undefined;
  if (ineligibleReason(current, policy.profile, locality) !== undefined) return undefined;

  return candidate;
}

/* ------------------------------------------------------------------ */
/* Attempt bookkeeping                                                 */
/* ------------------------------------------------------------------ */

export function beginAttempt(job: WorkerJob, option: OptionRef, trigger: ExecutionAttempt["trigger"]): WorkerJob {
  if (!job.routing?.policy) return job;
  const attempts = job.attempts ?? [];
  return {
    ...job,
    attempts: [
      ...attempts,
      {
        attempt: attempts.length + 1,
        optionId: option.optionId,
        workerId: option.workerId,
        modelId: option.modelId,
        location: option.location,
        startedAt: new Date().toISOString(),
        outcome: "running",
        trigger,
      },
    ],
  };
}

export function finishAttempt(
  job: WorkerJob,
  patch: Partial<ExecutionAttempt> & Pick<ExecutionAttempt, "outcome">,
): WorkerJob {
  const attempts = job.attempts;
  if (!attempts?.length) return job;
  const last = attempts.length - 1;
  return {
    ...job,
    attempts: attempts.map((attempt, index) =>
      index === last ? { ...attempt, ...patch, endedAt: new Date().toISOString() } : attempt,
    ),
  };
}

/** The option a job's first attempt should run. */
export function initialOption(job: WorkerJob): OptionRef | undefined {
  return job.routing?.policy?.selected;
}

export { ROUTE_POLICY_VERSION };
