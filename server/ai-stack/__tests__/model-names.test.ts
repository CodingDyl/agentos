import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normaliseWorkerModel } from "../model-names";

describe("worker model names", () => {
  it("turns Claude display names into ids Claude Code accepts", () => {
    assert.deepEqual(normaliseWorkerModel("claude-code", "Opus 5.5"), { model: "claude-opus-5-5" });
    assert.deepEqual(normaliseWorkerModel("claude-code", "Claude Sonnet 5.5"), { model: "claude-sonnet-5-5" });
    assert.deepEqual(normaliseWorkerModel("claude-code", "fable 5.1"), { model: "claude-fable-5-1" });
    assert.deepEqual(normaliseWorkerModel("claude-code", "Opus"), { model: "opus" });
  });

  it("leaves real ids and empty values alone", () => {
    assert.deepEqual(normaliseWorkerModel("claude-code", "claude-opus-5-5"), { model: "claude-opus-5-5" });
    assert.deepEqual(normaliseWorkerModel("claude-code", "sonnet"), { model: "sonnet" });
    assert.deepEqual(normaliseWorkerModel("codex", "gpt-5.6-sol"), { model: "gpt-5.6-sol" });
    assert.deepEqual(normaliseWorkerModel("claude-code", "  "), {});
    assert.deepEqual(normaliseWorkerModel("claude-code", undefined), {});
  });

  it("refuses a display name it cannot translate, rather than handing it to the CLI", () => {
    assert.match(normaliseWorkerModel("codex", "GPT 5.6 Sol").error ?? "", /display name, not a model ID/);
    assert.match(normaliseWorkerModel("claude-code", "Claude Opus Max").error ?? "", /claude-opus-5-5/);
  });
});
