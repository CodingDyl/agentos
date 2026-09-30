import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { resetAiSettingsCache, setOllamaSettings } from "../../ai-stack/settings";
import { defaultOllamaModelConfig } from "../../../shared/route-policy-types";
import { ollamaUrlProblem, routePolicyRouter } from "../routes";

/** The /api/route-policy endpoints, over real HTTP, against a fake Ollama. */

let ollama: http.Server;
let api: http.Server;
let ollamaUrl: string;
let apiUrl: string;
let digest = "sha256:one";

const FIVE = "- a\n- b\n- c\n- d\n- e";

before(async () => {
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-routes-"));

  ollama = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    const send = (payload: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url === "/api/tags") return send({ models: [{ name: "m:1b", digest, details: {} }] });
    if (req.url === "/api/ps") return send({ models: [] });
    if (req.url === "/api/show") return send({ capabilities: ["completion"] });
    return send({
      message: { role: "assistant", content: FIVE },
      done: true,
      done_reason: "stop",
      eval_count: 20,
      prompt_eval_count: 100,
      total_duration: 200e6,
    });
  });
  await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", resolve));
  ollamaUrl = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;

  const app = express();
  app.use(express.json());
  app.use("/api/route-policy", routePolicyRouter);
  api = http.createServer(app);
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  resetAiSettingsCache();
  setOllamaSettings({ baseUrl: ollamaUrl, maxConcurrent: 1, fallback: "none", models: {} });
});

after(async () => {
  for (const server of [ollama, api]) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const post = (route: string, body: unknown) =>
  fetch(`${apiUrl}/api/route-policy${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /ollama/probe", () => {
  it("rejects a malformed request", async () => {
    const response = await post("/ollama/probe", { nope: true });
    assert.equal(response.status, 400);
  });

  it("tests the model with the config on screen, stores the result, and status reports it", async () => {
    const response = await post("/ollama/probe", {
      model: "m:1b",
      config: { ...defaultOllamaModelConfig(), enabled: false, maxOutputTokens: 300 },
    });
    assert.equal(response.status, 200);
    const { result } = (await response.json()) as { result: { verdict: string; limits: { maxOutputTokens: number } } };
    assert.equal(result.verdict, "suitable");
    assert.equal(result.limits.maxOutputTokens, 300, "unsaved edits are what gets tested");

    const status = (await (await fetch(`${apiUrl}/api/route-policy/ollama`)).json()) as {
      probes: Record<string, { verdict: string; stale: boolean }>;
      settings: { models: Record<string, unknown> };
    };
    assert.equal(status.probes["m:1b"].verdict, "suitable");
    assert.equal(status.probes["m:1b"].stale, false);
    // Testing never enables or configures anything.
    assert.deepEqual(status.settings.models, {});
  });

  it("marks the stored result stale once the model's digest changes", async () => {
    digest = "sha256:two";
    const status = (await (await fetch(`${apiUrl}/api/route-policy/ollama`)).json()) as { probes: Record<string, { stale: boolean }> };
    assert.equal(status.probes["m:1b"].stale, true);
  });

  it("refuses to probe a non-local Ollama address", async () => {
    setOllamaSettings({ baseUrl: "http://example.com:11434", maxConcurrent: 1, fallback: "none", models: {} });
    const response = await post("/ollama/probe", { model: "m:1b" });
    assert.equal(response.status, 400);
    setOllamaSettings({ baseUrl: ollamaUrl, maxConcurrent: 1, fallback: "none", models: {} });
  });
});

describe("ollamaUrlProblem", () => {
  it("allows loopback and rejects remote hosts and odd schemes", () => {
    assert.equal(ollamaUrlProblem("http://127.0.0.1:11434"), undefined);
    assert.equal(ollamaUrlProblem("http://localhost:11434"), undefined);
    assert.match(ollamaUrlProblem("http://10.0.0.5:11434") ?? "", /this machine/);
    assert.match(ollamaUrlProblem("file:///etc/passwd") ?? "", /http/);
    assert.match(ollamaUrlProblem("not a url") ?? "", /not a valid URL/);
  });
});
