import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { z } from "zod";
import { resetAiSettingsCache, setOllamaSettings } from "../../ai-stack/settings";
import { defaultModelConfig } from "../../route-policy/ollama-config";
import type { WorkerJob } from "../../../shared/worker-types";
import { buildOllamaOptions } from "../../route-policy/ollama-config";
import { discoverOllama, OllamaError } from "../providers/ollama-client";
import { ollamaWorker, validateOutput } from "../providers/ollama-worker";

/**
 * The Ollama adapter against a fake Ollama HTTP server.
 *
 * The fake speaks the real wire shapes (/api/tags, /api/ps, /api/show,
 * /api/chat with nanosecond durations). It proves the adapter's behaviour —
 * failure classification, single concurrency, repair, cancellation — not that
 * a real model is any good; the smoke script covers that on real hardware.
 */

/** The parts of a chat request the tests inspect. */
interface ChatBody {
  stream?: boolean;
  think?: boolean;
  format?: unknown;
  options: { num_predict: number; num_ctx: number };
  messages: Array<{ role: string; content: string }>;
}

interface FakeState {
  installed: Array<{ name: string; digest: string; capabilities: string[] }>;
  loaded: string[];
  chatCalls: ChatBody[];
  inFlight: number;
  maxInFlight: number;
  /** Called per /api/chat request; returns the response to send. */
  chat: (call: ChatBody, n: number) => Promise<{ status?: number; body: unknown }>;
}

let state: FakeState;
let server: http.Server;
let baseUrl: string;

const ok = (content: string, extra: Record<string, unknown> = {}) => ({
  body: {
    message: { role: "assistant", content },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 40,
    eval_count: 12,
    total_duration: 1_500_000_000,
    load_duration: 900_000_000,
    eval_duration: 400_000_000,
    ...extra,
  },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ollama-"));

  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : {};
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.url === "/api/tags") {
      return send(200, {
        models: state.installed.map((m) => ({ name: m.name, model: m.name, digest: m.digest, details: { family: "qwen3" } })),
      });
    }
    if (req.url === "/api/ps") return send(200, { models: state.loaded.map((name) => ({ name })) });
    if (req.url === "/api/show") {
      const found = state.installed.find((m) => m.name === body.model);
      return found ? send(200, { capabilities: found.capabilities }) : send(404, { error: "model not found" });
    }
    if (req.url === "/api/chat") {
      state.chatCalls.push(body);
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      // A client that hangs up mid-request must release the slot.
      let closed = false;
      res.on("close", () => {
        if (!closed) state.inFlight -= 1;
        closed = true;
      });
      const reply = await state.chat(body, state.chatCalls.length);
      if (!res.writableEnded && !res.destroyed) send(reply.status ?? 200, reply.body);
      return;
    }
    send(404, {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

const closeServer = () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
afterEach(() => resetAiSettingsCache());

function configure(over: Partial<ReturnType<typeof defaultModelConfig>> = {}, extra: { maxConcurrent?: number; baseUrl?: string } = {}) {
  setOllamaSettings({
    baseUrl: extra.baseUrl ?? baseUrl,
    maxConcurrent: extra.maxConcurrent ?? 1,
    fallback: "none",
    models: { "qwen3:4b": { ...defaultModelConfig(), enabled: true, ...over } },
  });
}

beforeEach(() => {
  state = {
    installed: [{ name: "qwen3:4b", digest: "sha256:abc", capabilities: ["completion", "thinking"] }],
    loaded: [],
    chatCalls: [],
    inFlight: 0,
    maxInFlight: 0,
    chat: async () => ok("- one\n- two"),
  };
  configure();
});

function makeJob(over: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: `job_${Math.random().toString(36).slice(2, 8)}`,
    worker: "ollama",
    project: "agentos",
    objective: "Summarise these notes into five bullets",
    inputText: "We ship Friday. Dana owns QA.",
    status: "queued",
    createdAt: new Date().toISOString(),
    routing: {
      selectedWorker: "ollama",
      confidence: "high",
      reasons: [],
      decidedBy: "agentos",
      decidedAt: new Date().toISOString(),
      policy: {
        policyVersion: "route-policy/1",
        mode: "auto",
        status: "selected",
        selected: { optionId: "ollama:qwen3:4b", workerId: "ollama", modelId: "qwen3:4b", location: "local" },
        reason: "test",
        rejected: [],
        fallbackPlan: [],
        overriddenByOperator: false,
        decidedAt: new Date().toISOString(),
        profile: {
          category: "summarisation", complexity: "simple", complexityReason: "x",
          estimatedInputTokens: 20, outputBudgetTokens: 512, requiredCapabilities: ["text"],
          constraints: { locality: "local_only", reviewRequired: true },
          missingInformation: [], routingUncertain: false, source: "rules",
        },
      },
    },
    ...over,
  } as WorkerJob;
}

function run(job: WorkerJob, signal = new AbortController().signal) {
  const events: Array<{ type: string; message?: string }> = [];
  const promise = ollamaWorker.start(job, {
    contextPacket: "",
    signal,
    emit: (type, message) => events.push({ type, message }),
  });
  return { promise, events };
}

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof OllamaError, `expected OllamaError, got ${String(error)}`);
    return error.kind;
  }
  assert.fail("expected the job to fail");
};

const EXTRACT = {
  objective: "Extract the owner and date as JSON",
  expectedOutput: {
    format: "json" as const,
    schema: { type: "object", properties: { owner: { type: "string" }, date: { type: "string" } }, required: ["owner", "date"] },
  },
};

describe("ollama discovery", () => {
  it("discovers qwen3:4b with digest, capabilities and loaded state; it is not enabled by discovery", async () => {
    state.loaded = ["qwen3:4b"];
    state.installed.push({ name: "nomic-embed-text:latest", digest: "sha256:emb", capabilities: ["embedding"] });
    const found = await discoverOllama(baseUrl);
    assert.equal(found.reachable, true);
    assert.deepEqual(found.loaded, ["qwen3:4b"]);
    assert.equal(found.installed.find((m) => m.name === "qwen3:4b")?.digest, "sha256:abc");

    // With no saved configuration, nothing is routable.
    const fresh = buildOllamaOptions(undefined, found);
    assert.ok(fresh.every((o) => !o.enabled));
    const embed = fresh.find((o) => o.modelId === "nomic-embed-text:latest");
    assert.equal(embed?.embeddingOnly, true);
  });

  it("reports an unreachable Ollama as a state, not an exception", async () => {
    const found = await discoverOllama("http://127.0.0.1:1");
    assert.equal(found.reachable, false);
    assert.match(found.unreachableReason ?? "", /not reachable/);
  });
});

describe("ollama worker: success", () => {
  it("returns the text with exact usage, digest and timings, and sends safe request options", async () => {
    state.loaded = ["qwen3:4b"];
    const { promise, events } = run(makeJob());
    const result = await promise;

    assert.equal(result.summary, "- one\n- two");
    assert.equal(result.providerMetrics?.model, "qwen3:4b");
    assert.equal(result.providerMetrics?.modelDigest, "sha256:abc");
    assert.equal(result.providerMetrics?.inputTokens, 40);
    assert.equal(result.providerMetrics?.outputTokens, 12);
    assert.equal(result.providerMetrics?.measurement, "exact");
    assert.equal(result.providerMetrics?.loadMs, 900);
    assert.equal(result.providerMetrics?.location, "local");
    assert.equal(result.providerMetrics?.costUsd, 0);
    assert.deepEqual(result.changedFiles, []);
    assert.ok(events.some((e) => e.type === "job.progress"));

    const call = state.chatCalls[0];
    assert.equal(call.stream, false);
    assert.equal(call.think, false); // thinking disabled: model supports it, config forbids it
    assert.equal(call.format, undefined);
    assert.equal(call.options.num_predict, 512);
    assert.ok(call.options.num_ctx >= 2000 + 512); // never lets Ollama truncate silently
    assert.equal(call.messages[1].content.includes("We ship Friday"), true);
  });

  it("omits the think flag for models that do not report thinking", async () => {
    state.installed[0].capabilities = ["completion"];
    await run(makeJob()).promise;
    assert.equal("think" in state.chatCalls[0], false);
  });

  it("rejects output cut off at the token limit instead of passing it to review", async () => {
    state.chat = async () => ok("We are given notes and need to summarise. Steps: 1.", { done_reason: "length" });
    assert.equal(await kindOf(run(makeJob()).promise), "output_truncated");
  });

  it("does not spend the deadline repairing truncated JSON", async () => {
    configure({ structuredOutput: true });
    state.chat = async () => ok('{"owner":"Dana","da', { done_reason: "length" });
    assert.equal(await kindOf(run(makeJob(EXTRACT)).promise), "output_truncated");
    assert.equal(state.chatCalls.length, 1);
  });

  it("says whether thinking was disabled when it rejects a truncated reply", async () => {
    state.chat = async () => ok("x", { done_reason: "length" });
    await assert.rejects(run(makeJob()).promise, /think=false was sent/);
    state.installed[0].capabilities = ["completion"];
    await assert.rejects(run(makeJob()).promise, /does not report thinking support/);
    await assert.rejects(run(makeJob()).promise, /non-thinking instruct model/);
  });
});

describe("ollama worker: structured output", () => {
  it("sends the schema as format and returns validated JSON", async () => {
    configure({ structuredOutput: true });
    state.chat = async () => ok('{"owner":"Dana","date":"Friday"}');
    const result = await run(makeJob(EXTRACT)).promise;
    assert.deepEqual(JSON.parse(result.summary), { owner: "Dana", date: "Friday" });
    assert.deepEqual(state.chatCalls[0].format, EXTRACT.expectedOutput.schema);
  });

  it("makes exactly one repair attempt, then succeeds", async () => {
    configure({ structuredOutput: true });
    state.chat = async (_call, n) => ok(n === 1 ? "Sure! {owner: Dana" : '{"owner":"Dana","date":"Friday"}');
    const result = await run(makeJob(EXTRACT)).promise;
    assert.equal(state.chatCalls.length, 2);
    assert.equal(result.providerMetrics?.attempts, 2);
    assert.match(state.chatCalls[1].messages.at(-1)?.content ?? "", /rejected/);
  });

  it("cannot succeed with invalid JSON: two attempts, then a clear failure", async () => {
    configure({ structuredOutput: true });
    state.chat = async () => ok("not json at all");
    assert.equal(await kindOf(run(makeJob(EXTRACT)).promise), "invalid_output");
    assert.equal(state.chatCalls.length, 2); // never a third
  });

  it("rejects valid JSON that violates the schema", async () => {
    configure({ structuredOutput: true });
    state.chat = async () => ok('{"owner":"Dana"}');
    assert.equal(await kindOf(run(makeJob(EXTRACT)).promise), "invalid_output");
  });

  it("refuses structured jobs on a model not configured for them, without calling it", async () => {
    configure({ structuredOutput: false });
    assert.equal(await kindOf(run(makeJob(EXTRACT)).promise), "not_configured");
    assert.equal(state.chatCalls.length, 0);
  });

  it("skips the repair when it would not fit the input limit", async () => {
    configure({ structuredOutput: true, maxInputTokens: 110 });
    state.chat = async () => ok("x".repeat(600));
    assert.equal(await kindOf(run(makeJob({ ...EXTRACT, inputText: "short" })).promise), "invalid_output");
    assert.equal(state.chatCalls.length, 1);
  });
});

describe("ollama worker: distinct failures", () => {
  it("offline Ollama is 'offline', and health says why", async () => {
    configure({}, { baseUrl: "http://127.0.0.1:1" });
    assert.equal(await kindOf(run(makeJob()).promise), "offline");
    const health = await ollamaWorker.healthCheck();
    assert.equal(health.available, false);
    assert.match(health.reason ?? "", /not reachable/);
  });

  it("a model missing from Ollama (unmounted SSD) fails before any generation", async () => {
    state.installed = [];
    assert.equal(await kindOf(run(makeJob()).promise), "model_missing");
    assert.equal(state.chatCalls.length, 0);
  });

  it("a 404 from chat is a missing model", async () => {
    state.chat = async () => ({ status: 404, body: { error: "model 'qwen3:4b' not found" } });
    assert.equal(await kindOf(run(makeJob()).promise), "model_missing");
  });

  it("a load failure is distinguished from an HTTP error", async () => {
    state.chat = async () => ({ status: 500, body: { error: "failed to load model: out of memory" } });
    assert.equal(await kindOf(run(makeJob()).promise), "load_failed");
    state.chat = async () => ({ status: 500, body: { error: "boom" } });
    assert.equal(await kindOf(run(makeJob()).promise), "http_error");
  });

  it("empty output is a failure and is not repaired", async () => {
    state.chat = async () => ok("   ");
    assert.equal(await kindOf(run(makeJob()).promise), "empty_output");
    assert.equal(state.chatCalls.length, 1);
  });

  it("enforces the execution deadline", async () => {
    configure({ timeoutMs: 300 });
    state.chat = async () => { await sleep(1500); return ok("late"); };
    assert.equal(await kindOf(run(makeJob()).promise), "timeout");
  });

  it("refuses over-limit input instead of truncating it", async () => {
    configure({ maxInputTokens: 50 });
    const job = makeJob({ inputText: "word ".repeat(400) });
    assert.equal(await kindOf(run(job).promise), "input_too_large");
    assert.equal(state.chatCalls.length, 0);
  });

  it("discards a result when Ollama's own count shows the prompt was truncated", async () => {
    state.chat = async () => ok("ok", { prompt_eval_count: 2600 });
    assert.equal(await kindOf(run(makeJob()).promise), "input_too_large");
  });

  it("never guesses a model, and never runs one that is not enabled", async () => {
    const noModel = makeJob();
    noModel.routing!.policy!.selected!.modelId = undefined;
    assert.equal(await kindOf(run(noModel).promise), "not_configured");

    configure({ enabled: false });
    assert.equal(await kindOf(run(makeJob()).promise), "not_configured");
    assert.equal(state.chatCalls.length, 0);
  });

  it("refuses an embedding-only model", async () => {
    state.installed[0].capabilities = ["embedding"];
    assert.equal(await kindOf(run(makeJob()).promise), "not_configured");
    assert.equal(state.chatCalls.length, 0);
  });

  it("cancellation and configuration errors are not fallback-eligible; others are", () => {
    assert.equal(new OllamaError("cancelled", "").fallbackEligible, false);
    assert.equal(new OllamaError("not_configured", "").fallbackEligible, false);
    assert.equal(new OllamaError("offline", "").fallbackEligible, true);
    assert.equal(new OllamaError("timeout", "").fallbackEligible, true);
  });
});

describe("ollama worker: cancellation and concurrency", () => {
  it("cancelling mid-generation aborts the request and reports 'cancelled'", async () => {
    state.chat = async () => { await sleep(3000); return ok("never"); };
    const controller = new AbortController();
    const { promise } = run(makeJob(), controller.signal);
    await sleep(150);
    controller.abort();
    assert.equal(await kindOf(promise), "cancelled");
    await sleep(50);
    assert.equal(state.inFlight, 0, "the server-side request was released");
  });

  it("holds one generation at a time; a second job waits its turn", async () => {
    state.chat = async () => { await sleep(150); return ok("done"); };
    const [a, b] = await Promise.all([run(makeJob()).promise, run(makeJob()).promise]);
    assert.equal(state.maxInFlight, 1);
    assert.ok((a.providerMetrics?.queueMs ?? 0) < 50);
    assert.ok((b.providerMetrics?.queueMs ?? 0) >= 100, "the waiter's queue time is recorded");
  });

  it("allows more when configured", async () => {
    configure({}, { maxConcurrent: 2 });
    state.chat = async () => { await sleep(150); return ok("done"); };
    await Promise.all([run(makeJob()).promise, run(makeJob()).promise]);
    assert.equal(state.maxInFlight, 2);
  });

  it("cancelling a queued job frees it without ever reaching Ollama", async () => {
    state.chat = async () => { await sleep(300); return ok("done"); };
    const first = run(makeJob());
    await sleep(50);
    const controller = new AbortController();
    const queued = run(makeJob(), controller.signal);
    await sleep(50);
    assert.ok(queued.events.some((e) => /Waiting for the local model/.test(e.message ?? "")));
    controller.abort();
    assert.equal(await kindOf(queued.promise), "cancelled");
    await first.promise;
    assert.equal(state.chatCalls.length, 1);
  });
});

describe("validateOutput", () => {
  it("accepts non-empty text and rejects blank", () => {
    assert.deepEqual(validateOutput(" hi ", { format: "text" }), { ok: true, value: "hi" });
    assert.equal(validateOutput("  ", undefined).ok, false);
  });

  it("parses fenced JSON, and rejects prose", () => {
    assert.equal(validateOutput('```json\n{"a":1}\n```', { format: "json" }).ok, true);
    assert.equal(validateOutput("here you go: {}", { format: "json" }).ok, false);
  });

  it("fails closed on a schema it cannot compile", () => {
    assert.throws(
      () => validateOutput("{}", { format: "json", schema: { type: 42 } as never }),
      (error: unknown) => error instanceof OllamaError && error.kind === "not_configured",
    );
    assert.ok(z);
  });
});

after(closeServer);
