import { z } from "zod";
import type { OllamaModelConfig } from "../../../shared/route-policy-types";
import type { WorkerJob, WorkerJobResult } from "../../../shared/worker-types";
import { ollamaSettings } from "../../ai-stack/settings";
import {
  buildOllamaOptions,
  DEFAULT_OLLAMA_BASE_URL,
} from "../../route-policy/ollama-config";
import { estimateTokens } from "../../route-policy/profile";
import type { Worker, WorkerRunContext } from "../worker";
import {
  discoverOllama,
  OllamaError,
  ollamaChat,
  supportsThinkingControl,
  type OllamaChatMessage,
  type OllamaChatResponse,
} from "./ollama-client";

/**
 * The local Ollama worker.
 *
 * A model with no tools: it reads supplied text and returns text. It has no
 * worktree, no repository and no shell, and never claims otherwise. Results
 * and errors leave through the same `Worker` contract as every other runner,
 * so the job manager's lifecycle, events and cancellation apply unchanged.
 *
 * Which model runs is not decided here. The route policy picks it and records
 * it on the job; this worker refuses to guess one, and re-checks that the
 * model is still enabled, installed and within its configured limits.
 */

/** Room for the chat template around the prompt, so Ollama never truncates it. */
const CONTEXT_MARGIN_TOKENS = 256;

/** A repair is only worth attempting with this much of the budget left. */
const MIN_REPAIR_BUDGET_MS = 2_000;

/* ------------------------------------------------------------------ */
/* Concurrency                                                         */
/* ------------------------------------------------------------------ */

/**
 * FIFO gate for local generation. One at a time by default: a laptop running a
 * 4B model does not get faster by being asked twice at once. Waiting is
 * abortable, so cancelling a queued job frees it immediately.
 */
class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  get running(): number {
    return this.active;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  acquire(limit: number, signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new OllamaError("cancelled", "Cancelled."));
        return;
      }

      const grant = () => {
        this.active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.drain(limit);
        });
      };

      if (this.active < limit) {
        grant();
        return;
      }

      const onAbort = () => {
        const at = this.waiters.indexOf(entry);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(new OllamaError("cancelled", "Cancelled."));
      };
      const entry = () => {
        signal.removeEventListener("abort", onAbort);
        grant();
      };

      this.waiters.push(entry);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private drain(limit: number): void {
    while (this.active < limit && this.waiters.length > 0) {
      this.waiters.shift()?.();
    }
  }
}

export const ollamaGate = new ConcurrencyGate();

/* ------------------------------------------------------------------ */
/* Prompt and validation                                               */
/* ------------------------------------------------------------------ */

export function buildOllamaMessages(job: WorkerJob): OllamaChatMessage[] {
  const wantsJson = job.expectedOutput?.format === "json";

  const system = [
    "You complete one bounded text task using only the material provided.",
    "Do not claim to have run code, read files, or browsed the web.",
    wantsJson
      ? "Reply with a single valid JSON value and nothing else."
      : "Reply with the requested text only.",
  ].join(" ");

  const user = [
    job.objective.trim(),
    job.inputText?.trim() ? `\n---\n${job.inputText.trim()}` : "",
    job.constraints?.length ? `\nConstraints:\n${job.constraints.map((c) => `- ${c}`).join("\n")}` : "",
  ].join("");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

const estimateMessages = (messages: OllamaChatMessage[]) =>
  messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0);

export type OutputCheck = { ok: true; value: string } | { ok: false; reason: string };

function stripFence(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return match ? match[1] : text.trim();
}

/**
 * Task rules for a result: non-empty, and for JSON, parseable and (when a
 * schema was supplied) conforming. Pure, so it is tested without a model.
 */
export function validateOutput(text: string, expected: WorkerJob["expectedOutput"]): OutputCheck {
  if (text.trim().length === 0) return { ok: false, reason: "The model returned no content." };
  if (expected?.format !== "json") return { ok: true, value: text.trim() };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch (error) {
    return { ok: false, reason: `Output is not valid JSON (${error instanceof Error ? error.message : "parse error"}).` };
  }

  if (expected.schema) {
    let schema: z.ZodType;
    try {
      schema = z.fromJSONSchema(expected.schema as Parameters<typeof z.fromJSONSchema>[0]);
    } catch {
      // Fail closed: an unusable schema must not become "accepted unchecked".
      throw new OllamaError("not_configured", "The expected-output schema could not be compiled, so the result cannot be validated.");
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      return { ok: false, reason: `JSON does not match the schema at ${issue.path.join(".") || "(root)"}: ${issue.message}.` };
    }
  }

  return { ok: true, value: JSON.stringify(parsed, null, 2) };
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

function resolveModelId(job: WorkerJob): string {
  // The current attempt wins over the original decision: a fallback may move
  // the job to a different local model.
  const current = job.attempts?.at(-1);
  const modelId =
    current?.workerId === "ollama" && current.outcome === "running"
      ? current.modelId
      : job.routing?.policy?.selected?.modelId;
  if (!modelId) {
    throw new OllamaError(
      "not_configured",
      "No Ollama model was selected for this job. The route policy must choose one; the worker will not guess.",
    );
  }
  return modelId;
}

function configFor(modelId: string): { baseUrl: string; config: OllamaModelConfig } {
  const settings = ollamaSettings();
  const config = settings?.models[modelId];
  if (!config?.enabled) {
    throw new OllamaError("not_configured", `${modelId} is not enabled for routing in the Ollama settings.`);
  }
  return { baseUrl: settings?.baseUrl || DEFAULT_OLLAMA_BASE_URL, config };
}

export const ollamaWorker: Worker = {
  id: "ollama",
  name: "Ollama (local)",
  role: "Runs small, bounded text tasks on a local model. No tools, repository or web access",

  // Deliberately none: the legacy Hermes router matches workers to coding,
  // review and research work by capability, and this worker does none of it.
  // It is reached through the route policy, or chosen by hand.
  capabilities: [],

  async healthCheck() {
    const settings = ollamaSettings();
    const enabled = Object.entries(settings?.models ?? {}).filter(([, c]) => c.enabled);
    if (enabled.length === 0) {
      return { available: false, reason: "No Ollama model is enabled. Enable one in Workers → Ollama." };
    }

    const state = await discoverOllama(settings?.baseUrl || DEFAULT_OLLAMA_BASE_URL);
    if (!state.reachable) return { available: false, reason: state.unreachableReason };

    const usable = buildOllamaOptions(settings, state).filter((o) => o.enabled && o.available);
    return usable.length > 0
      ? { available: true }
      : { available: false, reason: "No enabled Ollama model is installed and available." };
  },

  async start(job: WorkerJob, context: WorkerRunContext): Promise<WorkerJobResult> {
    const { emit, signal } = context;
    const modelId = resolveModelId(job);
    const { baseUrl, config } = configFor(modelId);
    const limit = ollamaSettings()?.maxConcurrent ?? 1;

    const wantsJson = job.expectedOutput?.format === "json";
    if (wantsJson && !config.structuredOutput) {
      throw new OllamaError(
        "not_configured",
        `${modelId} is not configured for structured output, so it cannot take this job.`,
      );
    }

    // Discovery is repeated here, not trusted from routing time: the model may
    // have been removed, or the SSD unmounted, since the decision was made.
    const state = await discoverOllama(baseUrl);
    if (!state.reachable) throw new OllamaError("offline", state.unreachableReason ?? "Ollama is not reachable.");

    const discovered = state.installed.find((model) => model.name === modelId);
    if (!discovered) {
      throw new OllamaError(
        "model_missing",
        `${modelId} is not installed in Ollama. Check that the model directory (and its SSD) is mounted.`,
      );
    }
    const embedding = discovered.capabilities
      ? !discovered.capabilities.includes("completion")
      : false;
    if (embedding) {
      throw new OllamaError("not_configured", `${modelId} is an embedding model and cannot generate text.`);
    }

    const messages = buildOllamaMessages(job);
    const promptTokens = estimateMessages(messages);
    if (promptTokens > config.maxInputTokens) {
      // The task is never shortened to fit. Routing should have caught this;
      // reaching here means a manual choice or a changed limit.
      throw new OllamaError(
        "input_too_large",
        `Input is about ${promptTokens} tokens (estimated), over ${modelId}'s ${config.maxInputTokens}-token limit. It was not truncated.`,
      );
    }

    const numCtx = Math.max(2_048, config.maxInputTokens + config.maxOutputTokens + CONTEXT_MARGIN_TOKENS);

    const queuedAt = Date.now();
    if (ollamaGate.running >= limit) {
      emit("job.progress", "Waiting for the local model", { queued: ollamaGate.waiting + 1, limit });
    }
    const release = await ollamaGate.acquire(limit, signal);
    const queueMs = Date.now() - queuedAt;

    try {
      // The deadline covers the whole generation, load included, and any repair.
      const startedAt = Date.now();
      const remaining = () => config.timeoutMs - (Date.now() - startedAt);

      const outputBudget = Math.min(
        job.routing?.policy?.profile.outputBudgetTokens ?? config.maxOutputTokens,
        config.maxOutputTokens,
      );

      const think = !config.allowThinking && supportsThinkingControl(discovered) ? (false as const) : undefined;
      const format = wantsJson ? (job.expectedOutput?.schema ?? "json") : undefined;

      const generate = (conversation: OllamaChatMessage[]): Promise<OllamaChatResponse> =>
        ollamaChat(
          baseUrl,
          {
            model: modelId,
            messages: conversation,
            format,
            think,
            options: {
              num_predict: outputBudget,
              num_ctx: numCtx,
              temperature: 0,
            },
          },
          Math.max(1, remaining()),
          signal,
        );

      const usage = { input: 0, output: 0, load: 0, total: 0, attempts: 0 };
      const record = (response: OllamaChatResponse) => {
        usage.attempts += 1;
        usage.input += response.promptTokens ?? 0;
        usage.output += response.outputTokens ?? 0;
        usage.load += response.loadMs ?? 0;
        usage.total += response.totalMs ?? 0;
        // Ollama silently drops the oldest prompt tokens past num_ctx. If the
        // prompt plus the output cap no longer fits, treat it as truncation.
        if (response.promptTokens !== undefined && response.promptTokens + config.maxOutputTokens > numCtx) {
          throw new OllamaError(
            "input_too_large",
            `Ollama counted ${response.promptTokens} prompt tokens, which may have been truncated by the context window. The result was discarded.`,
          );
        }
      };

      emit("job.progress", `Generating with ${modelId}`, {
        model: modelId,
        digest: discovered.digest,
        queueMs,
        alreadyLoaded: state.loaded.includes(modelId),
      });

      let response = await generate(messages);
      record(response);
      let check = validateOutput(response.content, job.expectedOutput);

      // One bounded repair for structured output, inside the same deadline and
      // on the same local model. Never a new provider, never a second repair.
      if (!check.ok && wantsJson && response.content.trim().length > 0) {
        const repairMessages: OllamaChatMessage[] = [
          ...messages,
          { role: "assistant", content: response.content },
          {
            role: "user",
            content: `That reply was rejected: ${check.reason} Reply again with only the corrected JSON.`,
          },
        ];

        if (remaining() >= MIN_REPAIR_BUDGET_MS && estimateMessages(repairMessages) <= config.maxInputTokens) {
          emit("job.progress", "Output failed validation; making one repair attempt", { reason: check.reason });
          response = await generate(repairMessages);
          record(response);
          check = validateOutput(response.content, job.expectedOutput);
        }
      }

      if (!check.ok) {
        throw new OllamaError(
          response.content.trim().length === 0 ? "empty_output" : "invalid_output",
          `${check.reason} No result was accepted after ${usage.attempts} attempt${usage.attempts === 1 ? "" : "s"}.`,
        );
      }

      const blockers: string[] = [];
      if (response.doneReason === "length") {
        blockers.push(`Output stopped at the ${config.maxOutputTokens}-token limit and may be incomplete.`);
      }

      const totalMs = Date.now() - startedAt;
      emit("job.progress", `${modelId} finished in ${(totalMs / 1000).toFixed(1)}s`, {
        totalMs,
        loadMs: usage.load,
        queueMs,
        inputTokens: usage.input,
        outputTokens: usage.output,
      });

      return {
        // For a text-only job the deliverable is the text itself.
        summary: check.value,
        changedFiles: [],
        blockers: blockers.length > 0 ? blockers : undefined,
        providerMetrics: {
          provider: "ollama",
          model: modelId,
          modelDigest: discovered.digest,
          location: "local",
          // The provider API charge. Electricity and hardware are not free;
          // this is not a claim that they are.
          costUsd: 0,
          inputTokens: usage.input || undefined,
          outputTokens: usage.output || undefined,
          totalTokens: usage.input + usage.output || undefined,
          measurement: usage.input + usage.output > 0 ? "exact" : "unknown",
          queueMs,
          loadMs: usage.load,
          totalMs,
          attempts: usage.attempts,
        },
      };
    } finally {
      release();
    }
  },
};
