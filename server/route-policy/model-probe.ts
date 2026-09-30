import type {
  OllamaModelConfig,
  ProbeCheck,
  ProbeResult,
  ProbeVariant,
} from "../../shared/route-policy-types";
import type { WorkerJob } from "../../shared/worker-types";
import {
  discoverOllama,
  OllamaError,
  ollamaChat,
  supportsThinkingControl,
  type OllamaChatMessage,
  type OllamaChatResponse,
} from "../workers/providers/ollama-client";
import { buildOllamaMessages, ollamaGate, validateOutput } from "../workers/providers/ollama-worker";

/**
 * "Test model": is this installed model actually suitable for bounded tasks?
 *
 * Installed does not prove suitable, and neither does a `thinking` capability
 * flag that says nothing about whether thinking can be switched off. The only
 * honest test is to run the kind of task AgentOS will send, with the limits
 * the model is configured with, and check what comes back. This is that test.
 *
 * It runs through the same one-at-a-time gate as real jobs, so testing a model
 * never collides with work in progress, and it never changes any setting.
 */

export const PROBE_NOTES =
  "Weekly sync, 29 Sep. Priya will ship the invoice export by Friday 3 October. " +
  "Marcus owns the QA pass and reports on Monday 6 October. Budget for the pilot was approved at R45,000. " +
  "Open risk: the bank feed sandbox is flaky. Decision: postpone the mobile redesign to November.";

const SUMMARY_TASK = { objective: "Summarise these meeting notes into five bullets", inputText: PROBE_NOTES };

const EXTRACT_TASK = {
  objective: "Extract every person, and the date they are due to deliver something, as JSON",
  inputText: PROBE_NOTES,
  expectedOutput: {
    format: "json" as const,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { person: { type: "string" }, date: { type: "string" } }, required: ["person", "date"] },
        },
      },
      required: ["items"],
    },
  },
};

/** Above this share of the deadline, a passing model is still worth a warning. */
const HEADROOM_WARN_RATIO = 0.6;

export function countBullets(text: string): number {
  return text.split("\n").filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)).length;
}

export interface Attempt {
  label: string;
  response?: OllamaChatResponse;
  error?: OllamaError;
  wallMs: number;
}

function variantOf(attempt: Attempt): ProbeVariant {
  const r = attempt.response;
  return {
    label: attempt.label,
    doneReason: r?.doneReason,
    outputTokens: r?.outputTokens,
    thinkingChars: r?.thinkingChars,
    totalMs: r?.totalMs ?? attempt.wallMs,
    loadMs: r?.loadMs,
    startsWith: r ? r.content.slice(0, 140) : undefined,
    error: attempt.error?.message,
  };
}

/**
 * Turns what was observed into a verdict, checks, and advice. Pure, so the
 * reasoning is tested against recorded behaviour rather than a live model.
 */
export function assess(input: {
  primary: Attempt;
  omitted?: Attempt;
  soft?: Attempt;
  json?: { attempt: Attempt; valid: boolean; reason?: string };
  timeoutMs: number;
  maxOutputTokens: number;
  thinkSent: boolean;
}): { verdict: "suitable" | "unsuitable" | "unavailable"; summary: string; checks: ProbeCheck[]; recommendation?: string } {
  const { primary, timeoutMs, maxOutputTokens } = input;
  const checks: ProbeCheck[] = [];

  if (primary.error) {
    const kind = primary.error.kind;
    const unsuitable = kind === "timeout" || kind === "load_failed";
    checks.push({ name: "Runs the task", passed: false, detail: primary.error.message });
    return {
      verdict: unsuitable ? "unsuitable" : "unavailable",
      summary: unsuitable ? `Could not complete a simple task: ${primary.error.message}` : primary.error.message,
      checks,
      recommendation:
        kind === "timeout"
          ? "It did not finish a five-bullet summary in time. Use a smaller or non-thinking model, or raise the timeout."
          : undefined,
    };
  }

  const r = primary.response as OllamaChatResponse;
  const finished = r.doneReason === "stop";
  checks.push({
    name: "Finishes inside the output limit",
    passed: finished,
    detail: finished
      ? `${r.outputTokens ?? "?"} of ${maxOutputTokens} tokens.`
      : `Stopped at the ${maxOutputTokens}-token limit (${r.doneReason ?? "unknown"}). The answer is incomplete.`,
  });

  const bullets = countBullets(r.content);
  checks.push({
    name: "Answers the task (five bullets)",
    passed: bullets === 5,
    detail: bullets === 5 ? "Returned five bullets." : `Returned ${bullets} bullet lines, not five.`,
  });

  const total = r.totalMs ?? primary.wallMs;
  const inTime = total <= timeoutMs;
  const tight = total > timeoutMs * HEADROOM_WARN_RATIO;
  checks.push({
    name: "Meets the deadline",
    passed: inTime,
    detail: `${(total / 1000).toFixed(1)}s of ${(timeoutMs / 1000).toFixed(0)}s${r.loadMs ? ` (model load ${(r.loadMs / 1000).toFixed(1)}s)` : ""}${
      inTime && tight ? ". Little headroom: a busy machine could time out." : "."
    }`,
  });

  if (input.json) {
    checks.push({
      name: "Returns schema-valid JSON",
      passed: input.json.valid,
      detail: input.json.valid ? "Valid and matched the schema." : (input.json.reason ?? "Invalid."),
    });
  }

  const suitable = checks.every((check) => check.passed);
  if (suitable) {
    return {
      verdict: "suitable",
      summary: tight
        ? "Suitable, with little deadline headroom."
        : "Suitable for bounded tasks within the configured limits.",
      checks,
    };
  }

  const failedNames = checks.filter((check) => !check.passed).map((check) => check.name);
  return {
    verdict: "unsuitable",
    summary: `Not suitable. Failed: ${failedNames.join("; ")}.`,
    checks,
    recommendation: recommend(input),
  };
}

function recommend(input: { primary: Attempt; omitted?: Attempt; soft?: Attempt; thinkSent: boolean; maxOutputTokens: number }): string {
  const { primary, omitted } = input;
  const r = primary.response;
  const truncated = r?.doneReason === "length";

  const omittedThinks = (omitted?.response?.thinkingChars ?? 0) > 0;
  const omittedFine = omitted?.response?.doneReason === "stop" && countBullets(omitted.response.content) === 5;

  if (truncated && omittedFine) {
    return "It only answers properly when the thinking flag is left alone. Enable “Allow thinking mode” for this model, and leave room in the timeout for the extra tokens.";
  }
  if (truncated && input.thinkSent && (omittedThinks || (omitted?.response?.doneReason === "length"))) {
    return "This model keeps reasoning even when thinking is switched off, so it cannot be held to a small budget. Use a non-thinking instruct model for bounded tasks.";
  }
  if (truncated) {
    return "The answer did not fit the output limit. Raise the output limit, or use a model that answers more briefly.";
  }
  return "Use a different model, or adjust its limits and test again.";
}

export interface ProbeOptions {
  baseUrl: string;
  model: string;
  config: OllamaModelConfig;
  maxConcurrent: number;
  signal?: AbortSignal;
}

async function attemptChat(
  label: string,
  baseUrl: string,
  model: string,
  messages: OllamaChatMessage[],
  config: OllamaModelConfig,
  extra: { think?: false; format?: Record<string, unknown> },
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<Attempt> {
  const started = Date.now();
  try {
    const response = await ollamaChat(
      baseUrl,
      {
        model,
        messages,
        format: extra.format,
        think: extra.think,
        options: {
          num_predict: config.maxOutputTokens,
          num_ctx: Math.max(2_048, config.maxInputTokens + config.maxOutputTokens + 256),
          temperature: 0,
        },
      },
      deadlineMs,
      signal,
    );
    return { label, response, wallMs: Date.now() - started };
  } catch (error) {
    if (error instanceof OllamaError) {
      if (error.kind === "cancelled") throw error;
      return { label, error, wallMs: Date.now() - started };
    }
    throw error;
  }
}

export async function probeModel(options: ProbeOptions): Promise<ProbeResult> {
  const { baseUrl, model, config, signal } = options;
  const limits = {
    maxInputTokens: config.maxInputTokens,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
  };
  const base = { model, testedAt: new Date().toISOString(), limits, variants: [] as ProbeVariant[] };

  const unavailable = (summary: string, digest?: string): ProbeResult => ({
    ...base,
    digest,
    verdict: "unavailable",
    summary,
    checks: [],
  });

  const state = await discoverOllama(baseUrl);
  if (!state.reachable) return unavailable(state.unreachableReason ?? "Ollama is not reachable.");

  const found = state.installed.find((entry) => entry.name === model);
  if (!found) {
    return unavailable(`${model} is not installed in Ollama. Check that the model directory (and its SSD) is mounted.`);
  }
  if (found.capabilities && !found.capabilities.includes("completion")) {
    return unavailable(`${model} is an embedding model and cannot generate text, so it cannot be tested or enabled.`, found.digest);
  }

  // Bounded above so a hung model cannot hold the local slot indefinitely, but
  // long enough to *measure* how far past the deadline it runs.
  const deadlineMs = Math.min(Math.round(config.timeoutMs * 1.5), 120_000);
  const think = !config.allowThinking && supportsThinkingControl(found) ? (false as const) : undefined;

  const release = await ollamaGate.acquire(options.maxConcurrent, signal ?? new AbortController().signal);
  try {
    const summaryMessages = buildOllamaMessages(SUMMARY_TASK as unknown as WorkerJob);
    const primary = await attemptChat(
      think === false ? "As AgentOS sends it (thinking off)" : "As AgentOS sends it",
      baseUrl,
      model,
      summaryMessages,
      config,
      { think },
      deadlineMs,
      signal,
    );

    let json: Parameters<typeof assess>[0]["json"];
    if (config.structuredOutput && !primary.error) {
      const jsonAttempt = await attemptChat(
        "JSON extraction",
        baseUrl,
        model,
        buildOllamaMessages(EXTRACT_TASK as unknown as WorkerJob),
        config,
        { think, format: EXTRACT_TASK.expectedOutput.schema },
        deadlineMs,
        signal,
      );
      if (jsonAttempt.response && jsonAttempt.response.doneReason === "stop") {
        const check = validateOutput(jsonAttempt.response.content, EXTRACT_TASK.expectedOutput);
        json = { attempt: jsonAttempt, valid: check.ok, reason: check.ok ? undefined : check.reason };
      } else {
        json = {
          attempt: jsonAttempt,
          valid: false,
          reason: jsonAttempt.error?.message ?? "The JSON reply was cut off at the output limit.",
        };
      }
    }

    // Diagnostic variants run only when the model already failed, to explain
    // why. They cost time, so a passing model never pays for them.
    let omitted: Attempt | undefined;
    let soft: Attempt | undefined;
    const primaryFinished = primary.response?.doneReason === "stop";
    if (primary.response && !primaryFinished) {
      omitted = await attemptChat("Thinking flag omitted", baseUrl, model, summaryMessages, config, {}, deadlineMs, signal);
      soft = await attemptChat(
        "“/no_think” appended",
        baseUrl,
        model,
        summaryMessages.map((message, index) =>
          index === summaryMessages.length - 1 ? { ...message, content: `${message.content} /no_think` } : message,
        ),
        config,
        { think },
        deadlineMs,
        signal,
      );
    }

    const assessment = assess({
      primary,
      omitted,
      soft,
      json,
      timeoutMs: config.timeoutMs,
      maxOutputTokens: config.maxOutputTokens,
      thinkSent: think === false,
    });

    return {
      ...base,
      digest: found.digest,
      variants: [primary, ...(json ? [json.attempt] : []), ...(omitted ? [omitted] : []), ...(soft ? [soft] : [])].map(variantOf),
      ...assessment,
    };
  } finally {
    release();
  }
}
