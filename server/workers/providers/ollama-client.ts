import {
  isEmbeddingOnly,
  type DiscoveredOllamaModel,
  type OllamaState,
} from "../../route-policy/ollama-config";

/**
 * A thin client for the local Ollama HTTP API.
 *
 * Runs from the AgentOS backend against a configurable loopback URL. It only
 * reads and generates: AgentOS never pulls, copies or deletes models, which
 * stay under Ollama's own management.
 */

export type OllamaFailureKind =
  | "offline"
  | "model_missing"
  | "load_failed"
  | "timeout"
  | "cancelled"
  | "invalid_output"
  | "empty_output"
  | "input_too_large"
  | "not_configured"
  | "http_error";

/**
 * A failure with a cause the caller can act on. Fallback, retry and messaging
 * decisions read `kind`; the message is what a person sees.
 */
export class OllamaError extends Error {
  constructor(
    readonly kind: OllamaFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "OllamaError";
  }

  /** Whether trying another execution option could plausibly help. */
  get fallbackEligible(): boolean {
    return this.kind !== "cancelled" && this.kind !== "not_configured";
  }
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  /** A JSON Schema, or "json". Sent only to models configured for it. */
  format?: Record<string, unknown> | "json";
  /** Only ever set to false, and only for models that report thinking. */
  think?: false;
  options: { num_predict: number; num_ctx: number; temperature: number };
}

export interface OllamaChatResponse {
  content: string;
  doneReason?: string;
  promptTokens?: number;
  outputTokens?: number;
  /** Nanosecond figures from Ollama, converted to milliseconds. */
  totalMs?: number;
  loadMs?: number;
  evalMs?: number;
}

const DISCOVERY_TIMEOUT_MS = 2_000;

function describeNetworkError(error: unknown): string {
  const cause = (error as { cause?: { code?: string } })?.cause?.code;
  return cause ?? (error instanceof Error ? error.message : "unknown error");
}

/** Joins the operator's signal with a deadline, reporting which one fired. */
function withDeadline(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function getJson(
  baseUrl: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const guard = withDeadline(init.signal ?? undefined, init.timeoutMs ?? DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, baseUrl), { ...init, signal: guard.signal });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* keep raw text for the error message */
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    guard.done();
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

async function showCapabilities(baseUrl: string, name: string): Promise<string[] | undefined> {
  try {
    const shown = await getJson(baseUrl, "/api/show", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name }),
    });
    if (!shown.ok) return undefined;
    const capabilities = asRecord(shown.body).capabilities;
    return Array.isArray(capabilities)
      ? capabilities.filter((entry): entry is string => typeof entry === "string")
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What is installed and what is loaded. Never throws: an unreachable Ollama
 * is a state (`reachable: false`) so the rest of AgentOS carries on.
 */
export async function discoverOllama(baseUrl: string): Promise<OllamaState> {
  let tags;
  try {
    tags = await getJson(baseUrl, "/api/tags");
  } catch (error) {
    return {
      reachable: false,
      unreachableReason: `Ollama is not reachable at ${baseUrl} (${describeNetworkError(error)}). Is it running?`,
      installed: [],
      loaded: [],
    };
  }

  if (!tags.ok) {
    return {
      reachable: false,
      unreachableReason: `Ollama at ${baseUrl} answered /api/tags with HTTP ${tags.status}.`,
      installed: [],
      loaded: [],
    };
  }

  const models = Array.isArray(asRecord(tags.body).models) ? (asRecord(tags.body).models as unknown[]) : [];

  const installed: DiscoveredOllamaModel[] = await Promise.all(
    models.map(async (entry) => {
      const model = asRecord(entry);
      const name = String(model.name ?? model.model ?? "");
      return {
        name,
        digest: typeof model.digest === "string" ? model.digest : undefined,
        family: typeof asRecord(model.details).family === "string" ? (asRecord(model.details).family as string) : undefined,
        capabilities: await showCapabilities(baseUrl, name),
      };
    }),
  );

  let loaded: string[] = [];
  try {
    const running = await getJson(baseUrl, "/api/ps");
    if (running.ok && Array.isArray(asRecord(running.body).models)) {
      loaded = (asRecord(running.body).models as unknown[])
        .map((entry) => String(asRecord(entry).name ?? asRecord(entry).model ?? ""))
        .filter(Boolean);
    }
  } catch {
    /* Loaded state is a preference signal only; not knowing it is fine. */
  }

  return { reachable: true, installed: installed.filter((m) => m.name), loaded };
}

/** Whether generation with this model can safely be told not to think. */
export function supportsThinkingControl(model: DiscoveredOllamaModel | undefined): boolean {
  return Boolean(model?.capabilities?.includes("thinking"));
}

export { isEmbeddingOnly };

/**
 * One non-streaming chat call. The operator's signal and the deadline both
 * abort the request, which also stops generation on the Ollama side.
 */
export async function ollamaChat(
  baseUrl: string,
  request: OllamaChatRequest,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<OllamaChatResponse> {
  const guard = withDeadline(signal, timeoutMs);

  try {
    const response = await fetch(new URL("/api/chat", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, stream: false }),
      signal: guard.signal,
    });

    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = asRecord(JSON.parse(text));
    } catch {
      /* non-JSON error body */
    }

    if (!response.ok) {
      const detail = typeof body.error === "string" ? body.error : text.slice(0, 200);
      if (response.status === 404 || /not found/i.test(detail)) {
        throw new OllamaError(
          "model_missing",
          `Model ${request.model} is not available in Ollama: ${detail}. Check that the model directory (and its SSD) is mounted.`,
        );
      }
      if (/load|memory|failed to/i.test(detail)) {
        throw new OllamaError("load_failed", `Ollama could not load ${request.model}: ${detail}`);
      }
      throw new OllamaError("http_error", `Ollama returned HTTP ${response.status}: ${detail}`);
    }

    const message = asRecord(body.message);
    const ns = (value: unknown) => (typeof value === "number" ? Math.round(value / 1e6) : undefined);
    const count = (value: unknown) => (typeof value === "number" ? value : undefined);

    return {
      content: typeof message.content === "string" ? message.content : "",
      doneReason: typeof body.done_reason === "string" ? body.done_reason : undefined,
      promptTokens: count(body.prompt_eval_count),
      outputTokens: count(body.eval_count),
      totalMs: ns(body.total_duration),
      loadMs: ns(body.load_duration),
      evalMs: ns(body.eval_duration),
    };
  } catch (error) {
    if (error instanceof OllamaError) throw error;

    if (guard.signal.aborted) {
      if (guard.timedOut()) {
        throw new OllamaError("timeout", `Ollama did not finish within ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new OllamaError("cancelled", "Cancelled.");
    }

    throw new OllamaError(
      "offline",
      `Ollama is not reachable (${describeNetworkError(error)}). Is it running?`,
    );
  } finally {
    guard.done();
  }
}
