import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatMessage } from "../../../shared/chat-types";
import { applyClaudeMessage, startTurn } from "../claude-chat-adapter";

/**
 * The transcript is what the operator reads, so the fold from Claude Code's
 * message stream has to be exact: text once (not once streamed and again
 * whole), every tool call with how it ended, and nothing from sub-agents.
 */

function reply(): ChatMessage {
  return { id: "msg_1", role: "assistant", parts: [], createdAt: "2026-10-08T10:00:00.000Z" };
}

const sdk = (message: object) => message as unknown as SDKMessage;

const init = sdk({ type: "system", subtype: "init", session_id: "sess_1", model: "claude-opus-5-5" });
const start = (id: string) => sdk({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id } } });
const delta = (text: string, parent: string | null = null) =>
  sdk({ type: "stream_event", parent_tool_use_id: parent, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
const assistant = (id: string, content: object[], parent: string | null = null) =>
  sdk({ type: "assistant", parent_tool_use_id: parent, message: { id, content } });
const toolResult = (id: string, content: string, isError = false) =>
  sdk({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });
const result = (overrides: object = {}) => sdk({ type: "result", subtype: "success", is_error: false, result: "", total_cost_usd: 0.0123, ...overrides });

describe("folding Claude's stream into a reply", () => {
  it("records the session to resume and the model that answered", () => {
    const state = startTurn(reply());
    applyClaudeMessage(state, init);
    assert.equal(state.sessionId, "sess_1");
    assert.equal(state.message.model, "claude-opus-5-5");
  });

  it("streams text in, then does not add it again when the whole message arrives", () => {
    const state = startTurn(reply());
    applyClaudeMessage(state, start("m1"));
    applyClaudeMessage(state, delta("Hel"));
    applyClaudeMessage(state, delta("lo"));
    applyClaudeMessage(state, assistant("m1", [{ type: "text", text: "Hello" }]));

    assert.deepEqual(state.message.parts, [{ type: "text", text: "Hello" }]);
  });

  it("keeps text from a message that was not streamed", () => {
    const state = startTurn(reply());
    applyClaudeMessage(state, assistant("m2", [{ type: "text", text: "Done." }]));
    assert.deepEqual(state.message.parts, [{ type: "text", text: "Done." }]);
  });

  it("shows each tool call with a summary, then how it ended", () => {
    const state = startTurn(reply());
    applyClaudeMessage(state, assistant("m1", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }]));
    assert.deepEqual(state.message.parts[0], { type: "tool", id: "t1", name: "Bash", summary: "npm test", status: "running" });

    applyClaudeMessage(state, toolResult("t1", "2355 passing"));
    assert.equal(state.message.parts[0].type === "tool" && state.message.parts[0].status, "done");
    assert.equal(state.message.parts[0].type === "tool" && state.message.parts[0].output, "2355 passing");
  });

  it("marks a failed tool as an error", () => {
    const state = startTurn(reply());
    applyClaudeMessage(state, assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/nope" } }]));
    applyClaudeMessage(state, toolResult("t1", "File does not exist", true));
    assert.equal(state.message.parts[0].type === "tool" && state.message.parts[0].status, "error");
  });

  it("leaves a denial as a denial, not an error", () => {
    const state = startTurn(reply());
    applyClaudeMessage(state, assistant("m1", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "rm -rf x" } }]));
    const part = state.message.parts[0];
    if (part.type === "tool") part.status = "denied";
    applyClaudeMessage(state, toolResult("t1", "The operator declined", true));
    assert.equal(part.type === "tool" && part.status, "denied");
  });

  it("leaves out a sub-agent's own text and tools", () => {
    const state = startTurn(reply());
    assert.equal(applyClaudeMessage(state, delta("thinking aloud", "task_1")), false);
    assert.equal(applyClaudeMessage(state, assistant("s1", [{ type: "tool_use", id: "t9", name: "Grep", input: {} }], "task_1")), false);
    assert.deepEqual(state.message.parts, []);
  });

  it("records the cost, and settles tools still marked running", () => {
    const state = startTurn(reply());
    applyClaudeMessage(state, assistant("m1", [{ type: "tool_use", id: "t1", name: "Glob", input: { pattern: "*" } }]));
    applyClaudeMessage(state, result());
    assert.equal(state.message.costUsd, 0.0123);
    assert.equal(state.message.parts[0].type === "tool" && state.message.parts[0].status, "done");
    assert.equal(state.message.error, undefined);
  });

  it("says why a turn ended early", () => {
    const state = startTurn(reply());
    applyClaudeMessage(state, result({ subtype: "error_max_turns", is_error: true }));
    assert.match(state.message.error ?? "", /turn limit/);
  });
});
