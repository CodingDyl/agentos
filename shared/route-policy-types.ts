import { z } from "zod";
import { WorkerIdSchema } from "./worker-ids";

/**
 * Route policy: how a prepared task is matched to an execution option.
 *
 * A *model* generates output; a *worker* supplies the tools, permissions and
 * environment. An `ExecutionOption` is one usable pairing of the two. Workers
 * that own their model (Claude, Grok, the CLIs) have no `modelId`.
 *
 * This file imports only `worker-ids` so that `worker-routing-types` can embed
 * `RoutePolicyRecord` in a routing decision without an import cycle.
 */

export const ROUTE_POLICY_VERSION = "route-policy/1";

export const TaskCategorySchema = z.enum([
  "summarisation",
  "extraction",
  "rewriting",
  "classification",
  "explanation",
  "coding",
  "research",
  "other",
]);

export const TaskComplexitySchema = z.enum(["simple", "moderate", "complex"]);

/**
 * What the task needs from whatever runs it. Capabilities are hard filters:
 * an option lacking one is ineligible, whatever it costs or how fast it is.
 */
export const RequiredCapabilitySchema = z.enum([
  "text",
  "vision",
  "structured_output",
  "tools",
  "web",
  "repository",
  "file_writes",
]);

export const RoutingModeSchema = z.enum(["auto", "local_only", "manual"]);

/**
 * Explicit task metadata. Anything set here beats what the profiler infers.
 * Sent with a job request; never derived from model output.
 */
export const TaskMetadataSchema = z.object({
  category: TaskCategorySchema.optional(),
  complexity: TaskComplexitySchema.optional(),
  capabilities: z.array(RequiredCapabilitySchema).optional(),
  localOnly: z.boolean().optional(),
  deadlineMs: z.number().positive().optional(),
  budgetUsd: z.number().nonnegative().optional(),
  reviewRequired: z.boolean().optional(),
  deliverable: z.enum(["text", "json", "code_change"]).optional(),
  outputBudgetTokens: z.number().int().positive().optional(),
});

export const ExecutionLocationSchema = z.enum(["local", "cloud"]);

export const ExecutionConstraintsSchema = z.object({
  /** `local_only` means no cloud provider may see any part of the task. */
  locality: z.enum(["local_only", "cloud_allowed"]),
  deadlineMs: z.number().positive().optional(),
  /** Maximum spend in USD. Unset means the task set no budget. */
  budgetUsd: z.number().nonnegative().optional(),
  reviewRequired: z.boolean(),
});

export const TaskProfileSchema = z.object({
  category: TaskCategorySchema,
  complexity: TaskComplexitySchema,
  complexityReason: z.string(),
  /** A character-based estimate, not a tokenizer count. Always labelled so. */
  estimatedInputTokens: z.number().int().nonnegative(),
  outputBudgetTokens: z.number().int().positive(),
  requiredCapabilities: z.array(RequiredCapabilitySchema),
  constraints: ExecutionConstraintsSchema,
  /** What the profiler could not find. Non-empty means the task is underspecified. */
  missingInformation: z.array(z.string()),
  /** True when the rules did not settle the category or complexity. */
  routingUncertain: z.boolean(),
  /** Where each part of the profile came from: explicit metadata beats rules. */
  source: z.enum(["metadata", "rules", "mixed"]),
});

/**
 * One place a task could run.
 *
 * Assembled from live state (health, Ollama discovery) plus configuration, so
 * the policy that consumes it stays a pure function.
 */
export const ExecutionOptionSchema = z.object({
  /** Stable id: `worker` for a self-modelled worker, `worker:model` otherwise. */
  id: z.string(),
  workerId: WorkerIdSchema,
  /** Exact model id, e.g. `qwen3:4b`. Absent when the worker owns its model. */
  modelId: z.string().optional(),
  /** Model digest as reported by the provider, when it reports one. */
  modelDigest: z.string().optional(),
  location: ExecutionLocationSchema,
  enabled: z.boolean(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  capabilities: z.array(RequiredCapabilitySchema),
  categories: z.array(TaskCategorySchema),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
  /** Whether the worker can run tools at all. Text-only models cannot. */
  toolAccess: z.boolean(),
  /** Configured cost per job. Undefined is *unknown*, never zero. */
  costUsdPerJob: z.number().nonnegative().optional(),
  /** A local model currently held in memory, so no cold-load penalty. */
  loaded: z.boolean().optional(),
  /** Embedding-only models can never take a generation job. */
  embeddingOnly: z.boolean().optional(),
});

export const RejectedOptionSchema = z.object({
  optionId: z.string(),
  reason: z.string(),
});

export const OptionRefSchema = z.object({
  optionId: z.string(),
  workerId: WorkerIdSchema,
  modelId: z.string().optional(),
  location: ExecutionLocationSchema,
});

/**
 * Everything persisted on a job about how it was routed.
 *
 * Optional wherever it is embedded, so jobs written before this existed still
 * parse.
 */
export const RoutePolicyRecordSchema = z.object({
  policyVersion: z.string(),
  mode: RoutingModeSchema,
  profile: TaskProfileSchema,
  status: z.enum(["selected", "blocked"]),
  selected: OptionRefSchema.optional(),
  /** One line, shown beside the worker on the task screen. */
  reason: z.string(),
  /** Set when `blocked`. `retryable` means waiting could change the answer. */
  blockedReason: z.string().optional(),
  retryable: z.boolean().optional(),
  /** True when the selected option is at its concurrency limit and must queue. */
  queued: z.boolean().optional(),
  rejected: z.array(RejectedOptionSchema),
  /** Ordered fallbacks, all already eligible under the task's constraints. */
  fallbackPlan: z.array(OptionRefSchema),
  overriddenByOperator: z.boolean(),
  decidedAt: z.string(),
});

/**
 * One execution attempt of a job. A job that fell back has several; the list
 * is the whole story of where its work went and why.
 */
export const ExecutionAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  optionId: z.string(),
  workerId: WorkerIdSchema,
  modelId: z.string().optional(),
  modelDigest: z.string().optional(),
  location: ExecutionLocationSchema,
  startedAt: z.string(),
  endedAt: z.string().optional(),
  outcome: z.enum(["running", "succeeded", "failed", "cancelled"]),
  /** Machine-readable cause (e.g. `offline`, `invalid_output`) when it failed. */
  failureKind: z.string().optional(),
  failureReason: z.string().optional(),
  /** Why this attempt happened: the first choice, or which failure led here. */
  trigger: z.enum(["initial", "fallback"]),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  queueMs: z.number().optional(),
  loadMs: z.number().optional(),
  totalMs: z.number().optional(),
  /** Task-specific validation of the output: did it pass, and what it said. */
  validation: z.object({ passed: z.boolean(), detail: z.string().optional() }).optional(),
});

/**
 * Local model configuration. Discovery never enables anything: a model is
 * routable only while it has an entry here with `enabled: true`.
 */
export const OllamaModelConfigSchema = z.object({
  enabled: z.boolean(),
  categories: z.array(TaskCategorySchema),
  capabilities: z.array(RequiredCapabilitySchema),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  /** Only models configured true are sent a structured-output `format`. */
  structuredOutput: z.boolean(),
  /** Off by default: thinking costs latency on tasks that do not need it. */
  allowThinking: z.boolean(),
});

export const OllamaSettingsSchema = z.object({
  baseUrl: z.string(),
  maxConcurrent: z.number().int().positive(),
  /** `cloud` only ever applies to tasks whose constraints permit the cloud. */
  fallback: z.enum(["none", "cloud"]),
  models: z.record(z.string(), OllamaModelConfigSchema),
});

export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
export type ExecutionAttempt = z.infer<typeof ExecutionAttemptSchema>;
export type TaskCategory = z.infer<typeof TaskCategorySchema>;
export type TaskComplexity = z.infer<typeof TaskComplexitySchema>;
export type RequiredCapability = z.infer<typeof RequiredCapabilitySchema>;
export type RoutingMode = z.infer<typeof RoutingModeSchema>;
export type ExecutionConstraints = z.infer<typeof ExecutionConstraintsSchema>;
export type TaskProfile = z.infer<typeof TaskProfileSchema>;
export type ExecutionOption = z.infer<typeof ExecutionOptionSchema>;
export type RejectedOption = z.infer<typeof RejectedOptionSchema>;
export type OptionRef = z.infer<typeof OptionRefSchema>;
export type RoutePolicyRecord = z.infer<typeof RoutePolicyRecordSchema>;
export type OllamaModelConfig = z.infer<typeof OllamaModelConfigSchema>;
export type OllamaSettings = z.infer<typeof OllamaSettingsSchema>;

/* Responses of /api/route-policy, shared so the screen and adapter agree. */

export const OllamaStatusResponseSchema = z.object({
  settings: OllamaSettingsSchema,
  state: z.object({
    reachable: z.boolean(),
    unreachableReason: z.string().optional(),
    installed: z.array(
      z.object({
        name: z.string(),
        digest: z.string().optional(),
        family: z.string().optional(),
        capabilities: z.array(z.string()).optional(),
      }),
    ),
    loaded: z.array(z.string()),
  }),
  options: z.array(ExecutionOptionSchema),
});

export const ExecutionOptionsResponseSchema = z.object({
  options: z.array(ExecutionOptionSchema),
});

/** `legacy` means the policy had nothing to add and the existing router applies. */
export const RoutePreviewResponseSchema = z.union([
  z.object({ legacy: z.literal(true) }),
  z.object({ legacy: z.literal(false), record: RoutePolicyRecordSchema }),
]);

export type OllamaStatusResponse = z.infer<typeof OllamaStatusResponseSchema>;
export type ExecutionOptionsResponse = z.infer<typeof ExecutionOptionsResponseSchema>;
export type RoutePreviewResponse = z.infer<typeof RoutePreviewResponseSchema>;

/**
 * Conservative starting limits for a local model. Starting policies to tune
 * after testing on the actual machine, not measured guarantees.
 */
export const DEFAULT_LOCAL_LIMITS = {
  maxInputTokens: 2_000,
  maxOutputTokens: 512,
  timeoutMs: 30_000,
  maxConcurrent: 1,
} as const;

/** The entry a discovered model starts with. Always disabled: installed is not suitable. */
export function defaultOllamaModelConfig(): OllamaModelConfig {
  return {
    enabled: false,
    categories: ["summarisation", "extraction", "rewriting", "classification", "explanation"],
    capabilities: ["text"],
    maxInputTokens: DEFAULT_LOCAL_LIMITS.maxInputTokens,
    maxOutputTokens: DEFAULT_LOCAL_LIMITS.maxOutputTokens,
    timeoutMs: DEFAULT_LOCAL_LIMITS.timeoutMs,
    structuredOutput: false,
    allowThinking: false,
  };
}
