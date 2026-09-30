import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";
import { resetAiSettingsCache, setOllamaSettings } from "../../ai-stack/settings";
import { defaultModelConfig } from "../ollama-config";

/**
 * Routing wired into real dispatch: startJob → policy → Ollama/cloud worker →
 * fallback → text approval. Uses the real job manager and job store against a
 * fake Ollama server and a stub cloud worker, in a temporary state directory.
 */

type Reply = { status?: number; body: unknown };
let chat: (n: number) => Promise<Reply> = async () => ({ body: {} });
let chatCalls = 0;
let server: http.Server;
let baseUrl: string;

const ok = (content: string): Reply => ({
  body: {
    message: { role: "assistant", content },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 30,
    eval_count: 10,
    total_duration: 1_200_000_000,
    load_duration: 700_000_000,
  },
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let manager: typeof import("../../workers/job-manager");
let review: typeof import("../../workers/review");
let store: typeof import("../../workers/job-store");

/** A stand-in for a hosted worker. Counts how often it is actually run. */
let cloudRuns = 0;
let cloudSummary = "Cloud summary.";

before(async () => {
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-dispatch-"));

  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url === "/api/tags") return send(200, { models: [{ name: "qwen3:4b", digest: "sha256:q4b", details: {} }] });
    if (req.url === "/api/ps") return send(200, { models: [] });
    if (req.url === "/api/show") return send(200, { capabilities: ["completion"] });
    if (req.url === "/api/chat") {
      chatCalls += 1;
      const reply = await chat(chatCalls);
      if (!res.destroyed) send(reply.status ?? 200, reply.body);
      return;
    }
    send(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  manager = await import("../../workers/job-manager");
  review = await import("../../workers/review");
  store = await import("../../workers/job-store");
  const registry = await import("../../workers/registry");

  registry.registerWorker({
    id: "claude",
    name: "Stub cloud worker",
    role: "test double",
    capabilities: ["code", "research"],
    healthCheck: async () => ({ available: true }),
    start: async () => {
      cloudRuns += 1;
      return { summary: cloudSummary, changedFiles: [] };
    },
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function configure(over: { fallback?: "none" | "cloud"; baseUrl?: string; model?: Partial<ReturnType<typeof defaultModelConfig>> } = {}) {
  setOllamaSettings({
    baseUrl: over.baseUrl ?? baseUrl,
    maxConcurrent: 1,
    fallback: over.fallback ?? "cloud",
    models: { "qwen3:4b": { ...defaultModelConfig(), enabled: true, structuredOutput: true, ...over.model } },
  });
}

beforeEach(() => {
  resetAiSettingsCache();
  chatCalls = 0;
  cloudRuns = 0;
  cloudSummary = "Cloud summary.";
  chat = async () => ok("- one\n- two");
  configure();
});

async function settle(jobId: string): Promise<WorkerJob> {
  for (let i = 0; i < 200; i += 1) {
    if (!manager.isRunning(jobId)) break;
    await sleep(25);
  }
  const job = await store.readJob(jobId);
  assert.ok(job);
  return job;
}

const NOTES = "Meeting notes: ship Friday. Dana owns QA. Budget approved.";
const summary = (extra: Record<string, unknown> = {}) => ({
  worker: "auto" as const,
  project: "agentos",
  objective: "Summarise these meeting notes into five bullets",
  inputText: NOTES,
  ...extra,
});
const extraction = (extra: Record<string, unknown> = {}) => ({
  worker: "auto" as const,
  project: "agentos",
  objective: "Extract the owner and date as JSON",
  inputText: NOTES,
  expectedOutput: {
    format: "json" as const,
    schema: { type: "object", properties: { owner: { type: "string" }, date: { type: "string" } }, required: ["owner", "date"] },
  },
  ...extra,
});

describe("routing into dispatch", () => {
  it("a short summary runs on the local model, records the exact model, and needs a person to approve", async () => {
    const { job: started, error } = await manager.startJob(summary());
    assert.equal(error, undefined);
    assert.equal(started?.resolvedWorker, "ollama");
    assert.equal(started?.routing?.policy?.selected?.modelId, "qwen3:4b");
    assert.match(started?.routing?.reasons[0] ?? "", /qwen3:4b/);

    const job = await settle(started!.id);
    assert.equal(job.status, "awaiting_review");
    assert.equal(job.result?.summary, "- one\n- two");
    assert.equal(cloudRuns, 0);

    const attempt = job.attempts?.[0];
    assert.equal(attempt?.modelId, "qwen3:4b");
    assert.equal(attempt?.modelDigest, "sha256:q4b");
    assert.equal(attempt?.inputTokens, 30);
    assert.equal(attempt?.loadMs, 700);
    assert.equal(attempt?.outcome, "succeeded");
    assert.equal(attempt?.validation?.passed, true);
    assert.ok(!(job.result?.blockers ?? []).some((b) => /nothing was verified/.test(b)));

    // It goes through the normal approval step; nothing completes itself.
    const approved = await review.approveJob(job.id);
    assert.equal(approved.ok, true);
    assert.equal((await store.readJob(job.id))?.status, "completed");
  });

  it("a repository change goes to the tool-capable worker, never the text-only model", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-repo-"));
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q", "."], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qm", "i"], { cwd: repo });

    const { job: started, error } = await manager.startJob({
      worker: "auto",
      project: "agentos",
      objective: "Implement authentication across this application and run its tests",
      repoPath: repo,
    });
    assert.equal(error, undefined);
    assert.equal(started?.resolvedWorker, "claude");
    await settle(started!.id);
    assert.equal(chatCalls, 0);
    assert.match(
      started?.routing?.policy?.rejected.find((r) => r.optionId === "ollama:qwen3:4b")?.reason ?? "",
      /Lacks required capability/,
    );
  });

  it("oversize input is routed elsewhere with the reason recorded; nothing is truncated", async () => {
    const { job: started } = await manager.startJob(summary({ inputText: "notes ".repeat(2500) }));
    assert.equal(started?.resolvedWorker, "claude");
    assert.match(
      started?.routing?.policy?.rejected.find((r) => r.optionId === "ollama:qwen3:4b")?.reason ?? "",
      /will not be truncated/,
    );
    await settle(started!.id);
    assert.equal(chatCalls, 0);
  });

  it("with no local model enabled and cloud allowed, routing is exactly the legacy path", async () => {
    setOllamaSettings({ baseUrl, maxConcurrent: 1, fallback: "cloud", models: {} });
    const { job } = await manager.startJob(summary());
    assert.equal(job?.routing?.policy, undefined);
    await settle(job!.id);
    assert.equal(chatCalls, 0);
  });
});

describe("local-only", () => {
  it("is refused at start when Ollama is offline, and is not sent to the cloud", async () => {
    configure({ baseUrl: "http://127.0.0.1:1" });
    const { job, error } = await manager.startJob(summary({ routingHints: { localOnly: true } }));
    assert.equal(job, undefined);
    assert.match(error ?? "", /local-only/);
    assert.match(error ?? "", /not sent to the cloud/);
    assert.equal(cloudRuns, 0);
  });

  it("a local failure never falls back to the cloud", async () => {
    chat = async () => ({ status: 500, body: { error: "boom" } });
    const { job: started } = await manager.startJob(summary({ routingMode: "local_only" }));
    assert.equal(started?.resolvedWorker, "ollama");
    const job = await settle(started!.id);
    assert.equal(job.status, "failed");
    assert.equal(cloudRuns, 0);
    assert.equal(job.attempts?.length, 1);
    assert.equal(job.attempts?.[0].failureKind, "http_error");
  });

  it("invalid extraction JSON is never marked successful, and is not repaired in the cloud", async () => {
    chat = async () => ok("not json");
    const { job: started } = await manager.startJob(extraction({ routingHints: { localOnly: true } }));
    const job = await settle(started!.id);
    assert.equal(job.status, "failed");
    assert.equal(job.attempts?.[0].failureKind, "invalid_output");
    assert.equal(chatCalls, 2, "one attempt plus exactly one repair");
    assert.equal(cloudRuns, 0);
  });
});

describe("fallback", () => {
  it("an Ollama failure falls back exactly once, records both attempts, and the cloud worker runs once", async () => {
    chat = async () => ({ status: 500, body: { error: "failed to load model" } });
    const { job: started } = await manager.startJob(summary());
    const job = await settle(started!.id);

    assert.equal(job.status, "awaiting_review");
    assert.equal(cloudRuns, 1);
    assert.equal(job.resolvedWorker, "claude");
    assert.deepEqual(job.attempts?.map((a) => [a.optionId, a.outcome, a.trigger]), [
      ["ollama:qwen3:4b", "failed", "initial"],
      ["claude", "succeeded", "fallback"],
    ]);
    assert.equal(job.attempts?.[0].failureKind, "load_failed");
    assert.equal(chatCalls, 1, "the failed local model is not retried");
  });

  it("does not fall back to the cloud when that fallback is not allowed", async () => {
    configure({ fallback: "none" });
    chat = async () => ({ status: 500, body: { error: "boom" } });
    const { job: started } = await manager.startJob(summary());
    const job = await settle(started!.id);
    assert.equal(job.status, "failed");
    assert.equal(cloudRuns, 0);
  });

  it("if the fallback worker also fails, the job fails: no third attempt, no loop", async () => {
    chat = async () => ({ status: 500, body: { error: "boom" } });
    const registry = await import("../../workers/registry");
    let runs = 0;
    registry.registerWorker({
      id: "claude",
      name: "Failing cloud",
      role: "t",
      capabilities: ["code"],
      healthCheck: async () => ({ available: true }),
      start: async () => { runs += 1; throw new Error("cloud down"); },
    });
    const { job: started } = await manager.startJob(summary());
    const job = await settle(started!.id);
    assert.equal(job.status, "failed");
    assert.equal(runs, 1);
    assert.equal(job.attempts?.length, 2);
    assert.equal(chatCalls, 1);
    // restore the stub for later tests
    registry.registerWorker({
      id: "claude", name: "Stub cloud worker", role: "t", capabilities: ["code", "research"],
      healthCheck: async () => ({ available: true }),
      start: async () => { cloudRuns += 1; return { summary: cloudSummary, changedFiles: [] }; },
    });
  });

  it("the fallback's output is held to the same rules: invalid JSON from the cloud still fails", async () => {
    chat = async () => ({ status: 500, body: { error: "boom" } });
    cloudSummary = "Sure, here is the data!";
    const { job: started } = await manager.startJob(extraction());
    const job = await settle(started!.id);
    assert.equal(job.status, "failed");
    assert.match(job.error ?? "", /rejected/);
    assert.equal(cloudRuns, 1);
  });

  it("valid JSON from the fallback succeeds and is stored normalised", async () => {
    chat = async () => ({ status: 500, body: { error: "boom" } });
    cloudSummary = '{"owner":"Dana","date":"Friday"}';
    const { job: started } = await manager.startJob(extraction());
    const job = await settle(started!.id);
    assert.equal(job.status, "awaiting_review");
    assert.deepEqual(JSON.parse(job.result?.summary ?? ""), { owner: "Dana", date: "Friday" });
  });
});

describe("cancellation", () => {
  it("cancelling a running local job stops it with no retry and no fallback", async () => {
    chat = async () => { await sleep(3000); return ok("never"); };
    const { job: started } = await manager.startJob(summary());
    await sleep(200);
    const cancelled = await manager.cancelJob(started!.id);
    assert.ok(cancelled);
    const job = await settle(started!.id);
    assert.equal(job.status, "cancelled");
    assert.equal(cloudRuns, 0);
    assert.equal(job.attempts?.length, 1);
    assert.equal(job.attempts?.[0].outcome, "cancelled");
    await sleep(100);
    assert.equal(cloudRuns, 0, "nothing was dispatched after cancellation");
  });
});

describe("manual override", () => {
  it("is validated and recorded when valid", async () => {
    const { job } = await manager.startJob(summary({ routingMode: "manual", manualOptionId: "claude" }));
    assert.equal(job?.resolvedWorker, "claude");
    assert.equal(job?.routing?.policy?.overriddenByOperator, true);
    await settle(job!.id);
  });

  it("is refused with the reason when the option cannot do the task", async () => {
    const { job, error } = await manager.startJob({
      worker: "auto", project: "agentos",
      objective: "Modify the repository files and run its tests",
      repoPath: os.tmpdir(),
      routingMode: "manual", manualOptionId: "ollama:qwen3:4b",
    });
    assert.equal(job, undefined);
    assert.match(error ?? "", /Override rejected: Lacks required capability/);
  });
});

describe("suitability test results at dispatch", () => {
  it("a model that failed its test gets no jobs until its limits change", async () => {
    const { saveProbe } = await import("../probe-store");
    const limits = { maxInputTokens: 2000, maxOutputTokens: 512, timeoutMs: 30_000 };
    await saveProbe({
      model: "qwen3:4b",
      digest: "sha256:q4b",
      testedAt: new Date().toISOString(),
      verdict: "unsuitable",
      summary: "Not suitable.",
      checks: [],
      variants: [],
      limits,
    });

    // Matching limits and digest: the verdict applies, so the job goes elsewhere.
    const blocked = await manager.startJob(summary());
    assert.equal(blocked.job?.resolvedWorker, "claude");
    assert.match(
      blocked.job?.routing?.policy?.rejected.find((r) => r.optionId === "ollama:qwen3:4b")?.reason ?? "",
      /Failed its suitability test/,
    );
    await settle(blocked.job!.id);
    assert.equal(chatCalls, 0);

    // The operator changes a limit: the old verdict no longer describes it.
    configure({ model: { timeoutMs: 45_000 } });
    const retried = await manager.startJob(summary());
    assert.equal(retried.job?.resolvedWorker, "ollama");
    await settle(retried.job!.id);
  });
});
