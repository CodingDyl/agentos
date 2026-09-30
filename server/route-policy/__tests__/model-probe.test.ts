import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { defaultOllamaModelConfig, type OllamaModelConfig } from "../../../shared/route-policy-types";
import { OllamaError } from "../../workers/providers/ollama-client";
import { assess, countBullets, currentProbeVerdict, probeModel } from "../model-probe";
import { readProbes, saveProbe } from "../probe-store";

/**
 * The "Test model" probe, against a fake Ollama that reproduces the behaviours
 * that matter, including the real thinking-only model seen on hardware.
 */

interface ChatBody {
  think?: boolean;
  format?: unknown;
  messages: Array<{ content: string }>;
}
type Persona = (body: ChatBody, n: number) => Promise<{ content: string; thinking?: string; done_reason?: string; tokens?: number; delay?: number }>;

let persona: Persona;
let chatCalls: ChatBody[] = [];
let inFlight = 0;
let maxInFlight = 0;
let capabilities = ["completion", "thinking"];
let installed = true;
let digest = "sha256:abc";
let server: http.Server;
let baseUrl: string;

const FIVE = "- Priya ships the export Friday\n- Marcus owns QA\n- Marcus reports Monday\n- Pilot budget approved\n- Redesign moves to November";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const good: Persona = async (body) =>
  body.format ? { content: '{"items":[{"person":"Priya","date":"Friday"}]}' } : { content: FIVE, tokens: 40 };

/** What qwen3:4b actually did: ignores think=false, reasons into the content. */
const thinkingOnly: Persona = async (body) => {
  const flagOmitted = body.think === undefined && !body.messages.at(-1)?.content.includes("/no_think");
  return flagOmitted
    ? { content: "", thinking: "x".repeat(2106), done_reason: "length", tokens: 512 }
    : { content: "We are given meeting notes and need to summarize into five bullets.\n The notes:", done_reason: "length", tokens: 512 };
};

before(async () => {
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-probe-"));
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : {};
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url === "/api/tags") return send(200, { models: installed ? [{ name: "m:1b", digest, details: {} }] : [] });
    if (req.url === "/api/ps") return send(200, { models: [] });
    if (req.url === "/api/show") return send(200, { capabilities });
    if (req.url === "/api/chat") {
      chatCalls.push(body);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      let closed = false;
      res.on("close", () => {
        if (!closed) inFlight -= 1;
        closed = true;
      });
      const reply = await persona(body, chatCalls.length);
      await sleep(reply.delay ?? 5);
      if (!res.destroyed) {
        send(200, {
          message: { role: "assistant", content: reply.content, thinking: reply.thinking },
          done: true,
          done_reason: reply.done_reason ?? "stop",
          prompt_eval_count: 120,
          eval_count: reply.tokens ?? 30,
          total_duration: (reply.delay ?? 5) * 1e6 + 100e6,
          load_duration: 100e6,
        });
      }
      return;
    }
    send(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  persona = good;
  chatCalls = [];
  inFlight = 0;
  maxInFlight = 0;
  capabilities = ["completion", "thinking"];
  installed = true;
  digest = "sha256:abc";
});

const config = (over: Partial<OllamaModelConfig> = {}): OllamaModelConfig => ({ ...defaultOllamaModelConfig(), enabled: true, ...over });
const probe = (over: Partial<OllamaModelConfig> = {}, extra: { baseUrl?: string; signal?: AbortSignal } = {}) =>
  probeModel({ baseUrl: extra.baseUrl ?? baseUrl, model: "m:1b", config: config(over), maxConcurrent: 1, signal: extra.signal });

describe("probeModel", () => {
  it("passes a model that answers briefly, without spending time on diagnostics", async () => {
    const result = await probe();
    assert.equal(result.verdict, "suitable");
    assert.ok(result.checks.every((check) => check.passed));
    assert.equal(chatCalls.length, 1);
    assert.equal(chatCalls[0].think, false, "thinking is switched off exactly as real jobs do");
    assert.equal(result.digest, "sha256:abc");
  });

  it("also checks JSON output when the model is configured for it", async () => {
    const result = await probe({ structuredOutput: true });
    assert.equal(result.verdict, "suitable");
    assert.ok(result.checks.some((check) => check.name === "Returns schema-valid JSON" && check.passed));
    assert.equal(chatCalls.length, 2);
  });

  it("fails a model whose JSON is invalid", async () => {
    persona = async (body) => (body.format ? { content: "here is the data!" } : { content: FIVE });
    const result = await probe({ structuredOutput: true });
    assert.equal(result.verdict, "unsuitable");
    assert.match(result.checks.find((check) => check.name.includes("JSON"))?.detail ?? "", /not valid JSON/);
  });

  it("recognises the real thinking-only model and says what to do", async () => {
    persona = thinkingOnly;
    const result = await probe();
    assert.equal(result.verdict, "unsuitable");
    assert.match(result.summary, /^Not suitable\. Failed: Finishes inside the output limit; Answers the task/);
    assert.match(result.recommendation ?? "", /non-thinking instruct model/);
    assert.deepEqual(
      result.variants.map((variant) => variant.label),
      ["As AgentOS sends it (thinking off)", "Thinking flag omitted", "“/no_think” appended"],
    );
    assert.equal(result.variants[1].thinkingChars, 2106);
    assert.match(result.variants[0].startsWith ?? "", /^We are given meeting notes/);
  });

  it("points to 'Allow thinking mode' when the model only works with the flag left alone", async () => {
    persona = async (body) =>
      body.think === false
        ? { content: "ramble ramble", done_reason: "length", tokens: 512 }
        : { content: FIVE, thinking: "short", tokens: 90 };
    const result = await probe();
    assert.equal(result.verdict, "unsuitable");
    assert.match(result.recommendation ?? "", /Allow thinking mode/);
  });

  it("fails a model that finishes but does not give five bullets", async () => {
    persona = async () => ({ content: "- one\n- two\n- three" });
    const result = await probe();
    assert.equal(result.verdict, "unsuitable");
    assert.match(result.checks.find((check) => check.name.includes("five bullets"))?.detail ?? "", /3 bullet lines/);
  });

  it("fails a model too slow for its deadline, measured rather than guessed", async () => {
    persona = async () => ({ content: FIVE, delay: 400 });
    const late = await probe({ timeoutMs: 300 });
    assert.equal(late.verdict, "unsuitable");
    const deadline = late.checks.find((check) => check.name === "Meets the deadline");
    assert.equal(deadline?.passed, false);
    assert.match(deadline?.detail ?? "", /^\d+\.\ds of \d+s/);

    persona = async () => ({ content: FIVE, delay: 2000 });
    const hung = await probe({ timeoutMs: 300 });
    assert.equal(hung.verdict, "unsuitable");
    assert.match(hung.summary, /did not finish/);
  });

  it("gives no verdict when Ollama is down, the model is missing, or it is an embedding model", async () => {
    assert.equal((await probe({}, { baseUrl: "http://127.0.0.1:1" })).verdict, "unavailable");

    installed = false;
    const missing = await probe();
    assert.equal(missing.verdict, "unavailable");
    assert.match(missing.summary, /not installed/);

    installed = true;
    capabilities = ["embedding"];
    const embedding = await probe();
    assert.equal(embedding.verdict, "unavailable");
    assert.match(embedding.summary, /embedding model/);
    assert.equal(chatCalls.length, 0);
  });

  it("uses the same one-at-a-time gate as real jobs", async () => {
    persona = async () => ({ content: FIVE, delay: 150 });
    await Promise.all([probe(), probe()]);
    assert.equal(maxInFlight, 1);
  });

  it("stops when cancelled and leaves nothing running", async () => {
    persona = async () => ({ content: FIVE, delay: 3000 });
    const controller = new AbortController();
    const running = probe({}, { signal: controller.signal });
    await sleep(150);
    controller.abort();
    await assert.rejects(running, (error: unknown) => error instanceof OllamaError && error.kind === "cancelled");
    await sleep(50);
    assert.equal(inFlight, 0);
  });
});

describe("assess", () => {
  const attempt = (over: Record<string, unknown> = {}) => ({
    label: "x",
    wallMs: 1000,
    response: { content: FIVE, doneReason: "stop", outputTokens: 40, totalMs: 1000 },
    ...over,
  });

  it("passes but warns when there is little deadline headroom", () => {
    const result = assess({
      primary: attempt({ response: { content: FIVE, doneReason: "stop", outputTokens: 40, totalMs: 25_000 } }) as never,
      timeoutMs: 30_000,
      maxOutputTokens: 512,
      thinkSent: true,
    });
    assert.equal(result.verdict, "suitable");
    assert.match(result.summary, /little deadline headroom/);
  });

  it("counts bullets in the common styles only when they are real list items", () => {
    assert.equal(countBullets("- a\n* b\n• c\n1. d\n2) e"), 5);
    assert.equal(countBullets("Here are five bullets:\nnot a bullet"), 0);
  });
});

describe("probe store", () => {
  it("keeps the latest verdict, ignores 'unavailable', and marks a changed digest stale", async () => {
    const result = await probe();
    await saveProbe(result);
    await saveProbe({ ...result, model: "gone:1b", verdict: "unavailable" });

    const fresh = await readProbes([{ name: "m:1b", digest: "sha256:abc" }]);
    assert.equal(fresh["m:1b"].verdict, "suitable");
    assert.equal(fresh["m:1b"].stale, false);
    assert.equal(fresh["gone:1b"], undefined);

    const repulled = await readProbes([{ name: "m:1b", digest: "sha256:different" }]);
    assert.equal(repulled["m:1b"].stale, true);
  });
});

describe("currentProbeVerdict", () => {
  const limits = { maxInputTokens: 2000, maxOutputTokens: 512, timeoutMs: 30_000 };
  const record = (over: Record<string, unknown> = {}) => ({ verdict: "unsuitable" as const, limits, stale: false, ...over });

  it("applies only to the same build and the same limits", () => {
    assert.equal(currentProbeVerdict(record(), limits), "unsuitable");
    assert.equal(currentProbeVerdict(record({ stale: true }), limits), undefined);
    assert.equal(currentProbeVerdict(record(), { ...limits, timeoutMs: 60_000 }), undefined);
    assert.equal(currentProbeVerdict(record({ verdict: "unavailable" }), limits), undefined);
    assert.equal(currentProbeVerdict(undefined, limits), undefined);
    assert.equal(currentProbeVerdict(record(), undefined), undefined);
  });
});
