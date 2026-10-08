import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatAgent, ChatSummary } from "@shared/chat-types";
import { groupChats, initialModelChoice, modelLabel, parseSlashRun } from "../chat-model";

const NOW = new Date(2026, 9, 8, 15, 0, 0);

function chat(id: string, updatedAt: Date): ChatSummary {
  const at = updatedAt.toISOString();
  return { id: `chat_${id.padEnd(32, "0")}`, title: id, agent: "claude", model: "claude-opus-5-5", status: "idle", createdAt: at, updatedAt: at, messageCount: 2 };
}

const claude: ChatAgent = {
  id: "claude",
  name: "Claude",
  models: [
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  ],
  defaultModel: "claude-opus-5-5",
  available: true,
};

describe("chat history groups", () => {
  it("files chats by when they were last active, newest group first", () => {
    const groups = groupChats(
      [
        chat("a", new Date(2026, 9, 8, 9)),
        chat("b", new Date(2026, 9, 7, 22)),
        chat("c", new Date(2026, 9, 3)),
        chat("d", new Date(2026, 8, 1)),
      ],
      NOW,
    );
    assert.deepEqual(
      groups.map((group) => [group.label, group.chats.map((entry) => entry.title)]),
      [
        ["Today", ["a"]],
        ["Yesterday", ["b"]],
        ["Previous 7 days", ["c"]],
        ["Older", ["d"]],
      ],
    );
  });

  it("leaves out empty groups", () => {
    assert.deepEqual(groupChats([chat("a", NOW)], NOW).map((group) => group.label), ["Today"]);
    assert.deepEqual(groupChats([], NOW), []);
  });
});

describe("which model a new chat starts on", () => {
  it("remembers the last choice when it still exists", () => {
    assert.deepEqual(initialModelChoice([claude], { agent: "claude", model: "claude-sonnet-5-5" }), { agent: "claude", model: "claude-sonnet-5-5" });
  });

  it("falls back to the agent's default for a model that is gone", () => {
    assert.deepEqual(initialModelChoice([claude], { agent: "claude", model: "claude-retired" }), { agent: "claude", model: "claude-opus-5-5" });
  });

  it("skips an agent that can't be used", () => {
    assert.deepEqual(initialModelChoice([{ ...claude, available: false }], { agent: "claude", model: "claude-sonnet-5-5" }), { agent: "claude", model: "claude-opus-5-5" });
    assert.equal(initialModelChoice([]), undefined);
  });

  it("labels a model with its agent", () => {
    assert.equal(modelLabel([claude], "claude", "claude-opus-5-5"), "Claude Opus 5.5");
    assert.equal(modelLabel([claude], "claude", "unknown"), "unknown");
  });
});

describe("slash commands that start a planned run", () => {
  it("reads the mode and the request", () => {
    assert.deepEqual(parseSlashRun("/plan Set up a landing page"), { mode: "plan", input: "Set up a landing page" });
    assert.deepEqual(parseSlashRun("  /RUN  deploy the site\nto staging "), { mode: "run", input: "deploy the site\nto staging" });
    assert.deepEqual(parseSlashRun("/ask what changed?"), { mode: "ask", input: "what changed?" });
  });

  it("leaves everything else to the agent", () => {
    assert.equal(parseSlashRun("/plan"), undefined);
    assert.equal(parseSlashRun("/runbook please"), undefined);
    assert.equal(parseSlashRun("please /run this"), undefined);
    assert.equal(parseSlashRun("/deploy now"), undefined);
  });
});
