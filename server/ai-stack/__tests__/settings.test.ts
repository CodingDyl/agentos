import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

// Its own directory: the test run shares one state dir across files, and a
// worker switched off here must not leak into any other test.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ai-stack-"));
process.env.AGENTOS_UI_DIR = directory;

const { aiModel, isAiEnabled, resetAiSettingsCache, setAiEnabled, setAiModel } = await import("../settings");
const { getWorker } = await import("../../workers/registry");

beforeEach(() => {
  fs.rmSync(path.join(directory, "ai-stack.json"), { force: true });
  resetAiSettingsCache();
});

after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("AI stack switches", () => {
  it("treats everything as enabled when nothing was ever switched", () => {
    assert.equal(isAiEnabled("claude"), true);
    assert.equal(isAiEnabled("hermes"), true);
  });

  it("persists a switch, and reads it back after the cache is dropped", () => {
    setAiEnabled("grok", false);
    resetAiSettingsCache();

    assert.equal(isAiEnabled("grok"), false);
    assert.equal(isAiEnabled("claude"), true);
  });

  it("switches back on", () => {
    setAiEnabled("grok", false);
    setAiEnabled("grok", true);
    resetAiSettingsCache();

    assert.equal(isAiEnabled("grok"), true);
  });

  it("treats an unreadable file as nothing switched off", () => {
    fs.writeFileSync(path.join(directory, "ai-stack.json"), "{not json", "utf8");
    resetAiSettingsCache();

    assert.equal(isAiEnabled("grok"), true);
  });
});

describe("opt-in AIs", () => {
  it("keeps the operator's own coding CLIs off until switched on", () => {
    for (const id of ["claude-code", "codex", "gemini", "hermes-worker"]) assert.equal(isAiEnabled(id), false, id);
  });

  it("switches one on, persistently, without touching the others", () => {
    setAiEnabled("codex", true);
    resetAiSettingsCache();

    assert.equal(isAiEnabled("codex"), true);
    assert.equal(isAiEnabled("claude-code"), false);

    setAiEnabled("codex", false);
    assert.equal(isAiEnabled("codex"), false);
  });
});

describe("models", () => {
  it("stores a model, trimmed, and clears it when emptied", () => {
    assert.equal(aiModel("codex"), undefined);

    setAiModel("codex", "  gpt-5-codex ");
    resetAiSettingsCache();
    assert.equal(aiModel("codex"), "gpt-5-codex");

    setAiModel("codex", "");
    assert.equal(aiModel("codex"), undefined);
  });

  it("keeps switches when a model is saved", () => {
    setAiEnabled("grok", false);
    setAiModel("claude-code", "sonnet");
    resetAiSettingsCache();

    assert.equal(isAiEnabled("grok"), false);
    assert.equal(aiModel("claude-code"), "sonnet");
  });
});

describe("the worker registry honours the switch", () => {
  it("reports a switched-off worker as unavailable, saying where to turn it on", async () => {
    const worker = getWorker("mock");
    assert.ok(worker);

    assert.equal((await worker.healthCheck()).available, true);

    setAiEnabled("mock", false);
    const health = await worker.healthCheck();

    assert.equal(health.available, false);
    assert.match(health.reason ?? "", /AI Stack/);
  });

  it("reports an opt-in worker as switched off until it is switched on", async () => {
    const worker = getWorker("codex");
    assert.ok(worker);

    const health = await worker.healthCheck();
    assert.equal(health.available, false);
    assert.match(health.reason ?? "", /AI Stack/);
  });
});
