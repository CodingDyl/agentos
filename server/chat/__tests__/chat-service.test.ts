import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { ChatApprovalPart, ChatStreamEvent } from "../../../shared/chat-types";
import type { RunClaudeTurnInput } from "../claude-chat-adapter";

/**
 * The chat lifecycle, end to end, with a stand-in agent: a real model can't
 * run in tests, but everything around it (the transcript, the approval
 * round-trip, resuming a session, stopping) is AgentOS's own and is.
 */

let directory: string;
let service: typeof import("../chat-service");
let store: typeof import("../chat-store");
const saved: Record<string, string | undefined> = {};

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-chat-"));
  for (const key of ["AGENTOS_UI_DIR", "HOME", "ANTHROPIC_API_KEY"]) saved[key] = process.env[key];
  process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
  // No plan login here, and a key that is never used: the agent is a stand-in.
  process.env.HOME = path.join(directory, "home");
  process.env.ANTHROPIC_API_KEY = "sk-test-unused";
  service = await import("../chat-service");
  store = await import("../chat-store");
});

after(async () => {
  service.setTurnRunnerForTests(undefined);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(directory, { recursive: true, force: true });
});

let calls: RunClaudeTurnInput[];
beforeEach(() => {
  calls = [];
});

/** A stand-in agent: says something, optionally asks to run a risky command, says how that went. */
function agent(options: { asks?: boolean; sessionId?: string; hang?: boolean } = {}) {
  return async (input: RunClaudeTurnInput) => {
    calls.push(input);
    input.state.sessionId = options.sessionId ?? "sess_a";
    input.state.message.parts.push({ type: "text", text: "Looking into it." });
    input.onChange();

    if (options.asks) {
      const allowed = await input.requestApproval({ tool: "Bash", summary: "git push", reason: "Pushes to a remote.", signal: input.controller.signal });
      input.state.message.parts.push({ type: "text", text: allowed ? " Pushed." : " Skipped the push." });
    }
    if (options.hang) {
      await new Promise((_, reject) => input.controller.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
  };
}

async function waitFor<T>(read: () => Promise<T | undefined> | T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out");
}

const pendingApproval = (id: string) => async () => {
  const chat = await service.getChat(id);
  return chat.messages.at(-1)?.parts.find((part): part is ChatApprovalPart => part.type === "approval" && part.status === "pending");
};

describe("a chat", () => {
  it("starts empty, takes its title from the first message, and saves the reply", async () => {
    service.setTurnRunnerForTests(agent());
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    assert.equal(chat.title, "New chat");

    await service.sendMessage(chat.id, { text: "What changed this week?\nDetails below" });
    await service.turnSettled(chat.id);

    const stored = await store.readChat(chat.id);
    assert.equal(stored?.title, "What changed this week?");
    assert.equal(stored?.status, "idle");
    assert.deepEqual(stored?.messages.map((message) => message.role), ["user", "assistant"]);
    assert.deepEqual(stored?.messages[1].parts, [{ type: "text", text: "Looking into it." }]);
    assert.equal(stored?.agentSessionId, "sess_a");
  });

  it("resumes the agent's session on the next turn, and can switch model", async () => {
    service.setTurnRunnerForTests(agent({ sessionId: "sess_b" }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "First" });
    await service.turnSettled(chat.id);
    await service.sendMessage(chat.id, { text: "Second", model: "claude-sonnet-5-5" });
    await service.turnSettled(chat.id);

    assert.equal(calls[0].resume, undefined);
    assert.equal(calls[1].resume, "sess_b");
    assert.equal(calls[1].model, "claude-sonnet-5-5");
    assert.equal((await store.readChat(chat.id))?.model, "claude-sonnet-5-5");
  });

  it("runs in the AgentOS project", async () => {
    service.setTurnRunnerForTests(agent());
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "Hi" });
    await service.turnSettled(chat.id);
    assert.equal(calls[0].policy.projectRoot, service.PROJECT_ROOT);
    await fs.access(path.join(service.PROJECT_ROOT, "package.json"));
  });

  it("refuses a second message while one is being answered", async () => {
    service.setTurnRunnerForTests(agent({ hang: true }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "Long job" });
    await assert.rejects(service.sendMessage(chat.id, { text: "Another" }), service.ChatStateError);
    service.stopChat(chat.id);
    await service.turnSettled(chat.id);
  });

  it("rejects a model the agent doesn't have", async () => {
    await assert.rejects(service.createChat({ agent: "claude", model: "gpt-nope" }), service.ChatStateError);
  });
});

describe("approving a risky action", () => {
  it("pauses on the operator's decision, and carries on when allowed", async () => {
    service.setTurnRunnerForTests(agent({ asks: true }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    const events: ChatStreamEvent[] = [];
    const stop = service.subscribe(chat.id, (event) => events.push(event));

    await service.sendMessage(chat.id, { text: "Push it" });
    const approval = await waitFor(pendingApproval(chat.id));
    assert.equal(approval.reason, "Pushes to a remote.");
    // The screen heard about the question while it was open.
    assert.ok(events.some((event) => event.type === "message" && event.message.parts.some((part) => part.type === "approval" && part.status === "pending")));

    service.decideApproval(chat.id, approval.id, true);
    await service.turnSettled(chat.id);
    stop();

    const reply = (await store.readChat(chat.id))?.messages.at(-1);
    assert.equal(reply?.parts.find((part) => part.type === "approval")?.status, "allowed");
    assert.match(JSON.stringify(reply?.parts), /Pushed\./);
  });

  it("tells the agent no when denied", async () => {
    service.setTurnRunnerForTests(agent({ asks: true }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "Push it" });
    const approval = await waitFor(pendingApproval(chat.id));
    service.decideApproval(chat.id, approval.id, false);
    await service.turnSettled(chat.id);

    const reply = (await store.readChat(chat.id))?.messages.at(-1);
    assert.equal(reply?.parts.find((part) => part.type === "approval")?.status, "denied");
    assert.match(JSON.stringify(reply?.parts), /Skipped the push\./);
  });

  it("can only be answered once", async () => {
    service.setTurnRunnerForTests(agent({ asks: true }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "Push it" });
    const approval = await waitFor(pendingApproval(chat.id));
    service.decideApproval(chat.id, approval.id, true);
    assert.throws(() => service.decideApproval(chat.id, approval.id, false), service.ChatStateError);
    await service.turnSettled(chat.id);
  });

  it("expires when the operator stops the reply instead of answering", async () => {
    service.setTurnRunnerForTests(agent({ asks: true }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "Push it" });
    await waitFor(pendingApproval(chat.id));
    service.stopChat(chat.id);
    await service.turnSettled(chat.id);

    const stored = await store.readChat(chat.id);
    assert.equal(stored?.status, "idle");
    assert.equal(stored?.messages.at(-1)?.parts.find((part) => part.type === "approval")?.status, "expired");
  });
});

describe("planned runs from a chat", () => {
  it("hands the request to Operator and records the run in the conversation", async () => {
    const started: Array<[string, string]> = [];
    service.setRunStarterForTests(async (input, mode) => {
      started.push([input, mode]);
      return { id: "run_00000000-0000-0000-0000-000000000001" };
    });
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.startChatRun(chat.id, { input: "Set up a landing page for Pantry Pilot", mode: "plan" });
    service.setRunStarterForTests(undefined);

    assert.deepEqual(started, [["Set up a landing page for Pantry Pilot", "plan"]]);
    const stored = await store.readChat(chat.id);
    assert.equal(stored?.title, "Set up a landing page for Pantry Pilot");
    assert.equal(stored?.status, "idle");
    assert.deepEqual(stored?.messages[0].parts, [{ type: "text", text: "/plan Set up a landing page for Pantry Pilot" }]);
    assert.deepEqual(stored?.messages[1].parts, [{ type: "run", runId: "run_00000000-0000-0000-0000-000000000001", mode: "plan" }]);
  });

  it("waits for a reply in progress rather than interleaving", async () => {
    service.setTurnRunnerForTests(agent({ hang: true }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "Long job" });
    await assert.rejects(service.startChatRun(chat.id, { input: "Plan it", mode: "plan" }), service.ChatStateError);
    service.stopChat(chat.id);
    await service.turnSettled(chat.id);
  });
});

describe("the working indicator", () => {
  it("shows a chat while it answers, says when it waits on you, and drops it when done", async () => {
    service.setTurnRunnerForTests(agent({ asks: true }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "Push it" });

    const approval = await waitFor(pendingApproval(chat.id));
    const [item] = service.activeChatWork().filter((entry) => entry.id === chat.id);
    assert.equal(item.href, `/operator/chats/${chat.id}`);
    assert.equal(item.agent, "operator");
    assert.equal(item.detail, "Waiting for your OK");
    assert.equal(item.uncertain, false);

    service.decideApproval(chat.id, approval.id, true);
    await service.turnSettled(chat.id);
    assert.deepEqual(service.activeChatWork().filter((entry) => entry.id === chat.id), []);
  });
});

describe("stopping and restarting", () => {
  it("stop ends the turn and says so", async () => {
    service.setTurnRunnerForTests(agent({ hang: true }));
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.sendMessage(chat.id, { text: "Long job" });
    service.stopChat(chat.id);
    await service.turnSettled(chat.id);

    const stored = await store.readChat(chat.id);
    assert.equal(stored?.status, "idle");
    assert.equal(stored?.messages.at(-1)?.error, "Stopped.");
  });

  it("settles a chat a previous process left mid-reply", async () => {
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await store.saveChat({
      ...chat,
      status: "running",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "Go" }], createdAt: chat.createdAt },
        { id: "m2", role: "assistant", parts: [{ type: "tool", id: "t1", name: "Bash", summary: "npm test", status: "running" }], createdAt: chat.createdAt },
      ],
    });

    await service.reconcileChats();

    const stored = await store.readChat(chat.id);
    assert.equal(stored?.status, "idle");
    assert.match(stored?.messages.at(-1)?.error ?? "", /restarted/);
    const tool = stored?.messages.at(-1)?.parts[0];
    assert.equal(tool?.type === "tool" && tool.status, "error");
  });

  it("deletes a chat, and history no longer lists it", async () => {
    const chat = await service.createChat({ agent: "claude", model: "claude-opus-5-5" });
    await service.removeChat(chat.id);
    assert.ok(!(await service.listChats()).some((entry) => entry.id === chat.id));
    await assert.rejects(service.getChat(chat.id), service.ChatNotFoundError);
  });
});
