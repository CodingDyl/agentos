import {
  DEFAULT_LOCAL_LIMITS,
  defaultOllamaModelConfig,
  type ExecutionOption,
  type OllamaSettings,
} from "../../shared/route-policy-types";

/**
 * Turning Ollama configuration plus discovery into execution options.
 *
 * Discovery (`/api/tags`, `/api/ps`, `/api/show`) is performed by the adapter
 * in a later step and handed in as plain data, keeping this module pure.
 * Installed never means routable: a model needs an explicit configured entry
 * with `enabled: true`, and an embedding-only model can never be enabled for
 * generation.
 */

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

/** Conservative starting limits, not measured hardware guarantees. */
export const DEFAULT_LIMITS = DEFAULT_LOCAL_LIMITS;

export interface DiscoveredOllamaModel {
  /** Exact tag, e.g. `qwen3:4b`. */
  name: string;
  digest?: string;
  /** Capabilities from `/api/show`, e.g. ["completion", "tools"]. */
  capabilities?: string[];
  family?: string;
}

/** Name patterns for embedding models, used only when `/api/show` says nothing. */
const EMBEDDING_NAME = /(^|[/:-])(embed|embedding|bge|e5|gte|minilm)([:.-]|$)|nomic-embed|mxbai-embed|snowflake-arctic-embed/i;

export function isEmbeddingOnly(model: DiscoveredOllamaModel): boolean {
  if (model.capabilities && model.capabilities.length > 0) {
    // Reported capabilities are authoritative: no completion means no generation.
    return !model.capabilities.includes("completion");
  }
  return EMBEDDING_NAME.test(model.name);
}

export function defaultOllamaSettings(): OllamaSettings {
  return {
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    maxConcurrent: DEFAULT_LIMITS.maxConcurrent,
    fallback: "none",
    models: {},
  };
}

/**
 * The starting entry for a model, always disabled. qwen3:4b is the confirmed
 * first candidate, but it is enabled by the operator like any other.
 */
export const defaultModelConfig = defaultOllamaModelConfig;

export interface OllamaState {
  /** False when `/api/tags` could not be reached. */
  reachable: boolean;
  unreachableReason?: string;
  installed: DiscoveredOllamaModel[];
  /** Names currently loaded in memory (`/api/ps`). */
  loaded: string[];
}

/**
 * One option per configured model. Configured-but-not-installed models are
 * still listed, unavailable with a reason, so the workers screen can explain
 * a missing model or SSD rather than hide it.
 */
export function buildOllamaOptions(
  settings: OllamaSettings | undefined,
  state: OllamaState,
): ExecutionOption[] {
  const config = settings ?? defaultOllamaSettings();
  const installed = new Map(state.installed.map((model) => [model.name, model]));
  const options: ExecutionOption[] = [];

  const names = new Set([...state.installed.map((m) => m.name), ...Object.keys(config.models)]);

  for (const name of [...names].sort()) {
    const discovered = installed.get(name);
    const entry = config.models[name];
    const embeddingOnly = discovered ? isEmbeddingOnly(discovered) : EMBEDDING_NAME.test(name);

    let unavailableReason: string | undefined;
    if (!state.reachable) {
      unavailableReason = state.unreachableReason ?? "Ollama is not reachable.";
    } else if (!discovered) {
      unavailableReason = `${name} is configured but not installed in Ollama. Check that the model directory (and its SSD) is mounted.`;
    }

    const limits = entry ?? defaultModelConfig();
    const capabilities = [...limits.capabilities];
    if (limits.structuredOutput && !capabilities.includes("structured_output")) {
      capabilities.push("structured_output");
    }
    // A structured-output request goes only to a model configured for it.
    if (!limits.structuredOutput) {
      const at = capabilities.indexOf("structured_output");
      if (at >= 0) capabilities.splice(at, 1);
    }

    options.push({
      id: `ollama:${name}`,
      workerId: "ollama",
      modelId: name,
      modelDigest: discovered?.digest,
      location: "local",
      enabled: Boolean(entry?.enabled) && !embeddingOnly,
      available: unavailableReason === undefined,
      unavailableReason,
      capabilities,
      categories: limits.categories,
      maxInputTokens: limits.maxInputTokens,
      maxOutputTokens: limits.maxOutputTokens,
      timeoutMs: limits.timeoutMs,
      concurrencyLimit: config.maxConcurrent,
      // A text model has no tools, whatever the base model could do elsewhere.
      toolAccess: false,
      // Local execution has no provider API charge. Electricity and hardware
      // are not free, so this is a provider charge of zero, not a claim of zero cost.
      costUsdPerJob: 0,
      loaded: state.loaded.includes(name),
      embeddingOnly,
    });
  }

  return options;
}
