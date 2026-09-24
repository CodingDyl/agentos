import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

// Its own directory: the test run shares one state dir across files, and a
// worker switched off here must not leak into any other test.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ai-stack-"));
process.env.AGENTOS_UI_DIR = directory;

const { isAiEnabled, resetAiSettingsCache, setAiEnabled } = await import("../settings");
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
});
