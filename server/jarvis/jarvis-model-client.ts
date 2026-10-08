import { HermesError, sendToHermes } from "../hermes/client";
import { ollamaChat, OllamaError, type OllamaChatMessage } from "../workers/providers/ollama-client";
import type { JarvisModelRef } from "./jarvis-routing-config";

/**
 * The one seam between Jev and a model. Tests pass a fake; production uses
 * Ollama for local models and the existing Hermes client for `hermes`.
 */

export type JarvisModelFailureKind = "offline" | "model_missing" | "timeout" | "failed";

export class JarvisModelError extends Error {
  constructor(
    readonly kind: JarvisModelFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "JarvisModelError";
  }
}

export interface JarvisChatOptions {
  /** A JSON Schema for Ollama's structured output. Ignored by Hermes. */
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
}

export interface JarvisModelClient {
  chat(ref: JarvisModelRef, messages: OllamaChatMessage[], options: JarvisChatOptions): Promise<string>;
}

/** Whether a model thinks before answering, from `/api/show`. Asked once per model per process. */
const thinkingSupport = new Map<string, boolean>();

async function supportsThinking(baseUrl: string, model: string): Promise<boolean> {
  const known = thinkingSupport.get(model);
  if (known !== undefined) return known;
  try {
    const response = await fetch(new URL("/api/show", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.json().catch(() => ({}))) as { capabilities?: unknown };
    const thinks = Array.isArray(body.capabilities) && body.capabilities.includes("thinking");
    if (response.ok) thinkingSupport.set(model, thinks);
    return thinks;
  } catch {
    return false;
  }
}

function fromOllama(error: unknown): JarvisModelError {
  if (error instanceof OllamaError) {
    const kind: JarvisModelFailureKind =
      error.kind === "offline" ? "offline" : error.kind === "model_missing" ? "model_missing" : error.kind === "timeout" ? "timeout" : "failed";
    return new JarvisModelError(kind, error.message);
  }
  return new JarvisModelError("failed", error instanceof Error ? error.message : "The model failed.");
}

export function ollamaJarvisModelClient(baseUrl: string): JarvisModelClient {
  return {
    async chat(ref, messages, options) {
      if (ref.runtime === "hermes") {
        const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
        const rest = messages
          .filter((message) => message.role !== "system")
          .map((message) => (message.role === "user" ? message.content : `(Your earlier reply) ${message.content}`))
          .join("\n\n");
        try {
          return await sendToHermes(rest, { operation: "other", system, timeoutMs: options.timeoutMs });
        } catch (error) {
          throw new JarvisModelError(error instanceof HermesError && /reach|offline/i.test(error.message) ? "offline" : "failed", error instanceof Error ? error.message : "Hermes failed.");
        }
      }

      // Thinking is latency a router cannot afford; switch it off where the model allows it.
      const think = (await supportsThinking(baseUrl, ref.model)) ? (false as const) : undefined;
      try {
        const response = await ollamaChat(
          baseUrl,
          {
            model: ref.model,
            messages,
            ...(options.jsonSchema ? { format: options.jsonSchema } : {}),
            ...(think === false ? { think } : {}),
            options: { num_predict: options.maxTokens, num_ctx: 8192, temperature: options.temperature ?? 0.2 },
          },
          options.timeoutMs,
        );
        if (!response.content.trim()) throw new JarvisModelError("failed", `${ref.model} returned nothing.`);
        return response.content;
      } catch (error) {
        if (error instanceof JarvisModelError) throw error;
        throw fromOllama(error);
      }
    },
  };
}
