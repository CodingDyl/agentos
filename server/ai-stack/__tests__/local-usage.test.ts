import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readClaudeLine, readCodexLine } from "../local-usage";

const SINCE = Date.parse("2026-09-01T00:00:00.000Z");

function claudeLine(overrides: Record<string, unknown> = {}, usage: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-09-10T08:00:00.000Z",
    requestId: "req_1",
    message: {
      id: "msg_1",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "This conversation content must never be read out." }],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1_000,
        output_tokens: 50,
        ...usage,
      },
    },
    ...overrides,
  });
}

describe("readClaudeLine", () => {
  it("reads token counts, folding cache writes into input", () => {
    const counts = readClaudeLine(claudeLine(), SINCE);

    assert.deepEqual(counts, {
      key: "msg_1:req_1",
      model: "claude-sonnet-5",
      input: 110,
      output: 50,
      cachedInput: 1_000,
    });
  });

  it("returns nothing about the message beyond its numbers", () => {
    const counts = readClaudeLine(claudeLine(), SINCE);
    assert.doesNotMatch(JSON.stringify(counts), /conversation content/);
  });

  it("ignores lines from before the window", () => {
    assert.equal(readClaudeLine(claudeLine({ timestamp: "2026-08-31T23:59:59.000Z" }), SINCE), undefined);
  });

  it("ignores user lines and lines without usage", () => {
    assert.equal(readClaudeLine(claudeLine({ type: "user" }), SINCE), undefined);
    assert.equal(readClaudeLine(JSON.stringify({ type: "assistant", message: {} }), SINCE), undefined);
  });

  it("ignores Claude Code's synthetic bookkeeping entries", () => {
    const line = claudeLine({ message: { id: "x", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } } });
    assert.equal(readClaudeLine(line, SINCE), undefined);
  });

  it("survives a line that is not JSON", () => {
    assert.equal(readClaudeLine('{"usage": broken', SINCE), undefined);
  });
});

describe("readCodexLine", () => {
  it("reads the model a turn switched to", () => {
    const line = JSON.stringify({ type: "turn_context", timestamp: "2026-09-10T08:00:00.000Z", payload: { model: "gpt-5.6" } });
    assert.deepEqual(readCodexLine(line, SINCE), { model: "gpt-5.6" });
  });

  it("reads a turn's usage, with cached input taken out of fresh input", () => {
    const line = JSON.stringify({
      type: "event_msg",
      timestamp: "2026-09-10T08:00:00.000Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 1_000, cached_input_tokens: 600, output_tokens: 40 },
          total_token_usage: { total_tokens: 5_000 },
        },
      },
    });

    assert.deepEqual(readCodexLine(line, SINCE), { cumulative: 5_000, input: 400, output: 40, cachedInput: 600 });
  });

  it("ignores usage from before the window", () => {
    const line = JSON.stringify({
      type: "event_msg",
      timestamp: "2026-08-01T00:00:00.000Z",
      payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1 } } },
    });
    assert.equal(readCodexLine(line, SINCE), undefined);
  });

  it("ignores unrelated lines without parsing them", () => {
    assert.equal(readCodexLine('{"type":"response_item","payload":{}}', SINCE), undefined);
  });
});
