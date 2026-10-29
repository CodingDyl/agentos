import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { LiveSessions, MAX_LIVE_SESSIONS, type LiveQuery } from "../claude-live-session";

/**
 * A chat's Claude session kept open between messages, against a stand-in
 * Claude that answers each message it reads with a reply and a result.
 */

interface Fake extends LiveQuery {
  closed: boolean;
  interrupts: number;
  models: Array<string | undefined>;
}

function fakeClaude(options: { hangUntilInterrupt?: boolean } = {}) {
  const started: Fake[] = [];
  const start = (prompt: AsyncIterable<SDKUserMessage>): LiveQuery => {
    let interrupted: (() => void) | undefined;
    const fake: Fake = {
      closed: false,
      interrupts: 0,
      models: [],
      async *[Symbol.asyncIterator]() {
        for await (const message of prompt) {
          yield { type: "assistant", text: `heard: ${String(message.message.content)}` } as unknown as SDKMessage;
          if (options.hangUntilInterrupt) await new Promise<void>((resolve) => (interrupted = resolve));
          yield { type: "result", subtype: "success" } as unknown as SDKMessage;
        }
      },
      async interrupt() {
        fake.interrupts += 1;
        interrupted?.();
      },
      async setModel(model) {
        fake.models.push(model);
      },
      close() {
        fake.closed = true;
      },
    };
    started.push(fake);
    return fake;
  };
  return { started, start };
}

const heard = (messages: SDKMessage[]) => messages.map((message) => (message as unknown as { text?: string }).text).filter(Boolean);

describe("a chat's live Claude session", () => {
  it("answers every message from one process, each turn ending at its result", async () => {
    const claude = fakeClaude();
    const sessions = new LiveSessions<string>();
    const session = sessions.open("chat_a", "setup", "sonnet", claude.start);

    const first: SDKMessage[] = [];
    await session.send("hello", "turn 1", (message) => first.push(message), new AbortController().signal);
    const second: SDKMessage[] = [];
    await session.send("again", "turn 2", (message) => second.push(message), new AbortController().signal);

    assert.equal(claude.started.length, 1, "one process for both messages");
    assert.deepEqual(heard(first), ["heard: hello"]);
    assert.deepEqual(heard(second), ["heard: again"], "each turn sees only its own messages");
    assert.equal(sessions.find("chat_a", "setup"), session, "reused while the setup matches");
    sessions.closeAll();
  });

  it("starts over when the chat's setup changes", () => {
    const claude = fakeClaude();
    const sessions = new LiveSessions<string>();
    const session = sessions.open("chat_a", "assistant", "sonnet", claude.start);
    assert.equal(sessions.find("chat_a", "coder"), undefined);
    assert.equal(session.closed, true);
    assert.equal(claude.started[0].closed, true, "the old process is closed");
  });

  it("knows which turn is running, for a tool call mid-turn", async () => {
    let seen: string | undefined;
    const sessions = new LiveSessions<string>();
    const session = sessions.open("chat_a", "setup", "sonnet", fakeClaude().start);
    await session.send("x", "the turn", () => (seen = session.current), new AbortController().signal);
    assert.equal(seen, "the turn");
    assert.equal(session.current, undefined, "nothing once it has finished");
    sessions.closeAll();
  });

  it("switches model in place", async () => {
    const claude = fakeClaude();
    const sessions = new LiveSessions<string>();
    const session = sessions.open("chat_a", "setup", "sonnet", claude.start);
    await session.useModel("sonnet");
    await session.useModel("opus");
    await session.useModel("default");
    assert.deepEqual(claude.started[0].models, ["opus", undefined]);
    sessions.closeAll();
  });

  it("stops a turn by interrupting it, and keeps the session for the next message", async () => {
    const claude = fakeClaude({ hangUntilInterrupt: true });
    const sessions = new LiveSessions<string>();
    const session = sessions.open("chat_a", "setup", "sonnet", claude.start);
    const controller = new AbortController();
    const turn = session.send("long job", "t", () => undefined, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await turn;
    assert.equal(claude.started[0].interrupts, 1);
    assert.equal(session.closed, false);
    sessions.closeAll();
  });

  it("fails the running turn and closes when Claude's process ends", async () => {
    const sessions = new LiveSessions<string>();
    const start = (): LiveQuery => ({
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<SDKMessage>> => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new Error("Claude Code exited");
        },
      }),
      interrupt: async () => undefined,
      setModel: async () => undefined,
      close: () => undefined,
    });
    const session = sessions.open("chat_a", "setup", "sonnet", start);
    await assert.rejects(session.send("x", "t", () => undefined, new AbortController().signal), /exited/);
    assert.equal(session.closed, true);
    assert.equal(sessions.size, 0);
  });

  it(`keeps at most ${MAX_LIVE_SESSIONS} open, closing the longest idle first`, async () => {
    const claude = fakeClaude();
    const sessions = new LiveSessions<string>();
    const opened = [];
    for (let index = 0; index <= MAX_LIVE_SESSIONS; index += 1) {
      opened.push(sessions.open(`chat_${index}`, "setup", "sonnet", claude.start));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(sessions.size, MAX_LIVE_SESSIONS);
    assert.equal(opened[0].closed, true, "the oldest went");
    sessions.closeAll();
  });
});
