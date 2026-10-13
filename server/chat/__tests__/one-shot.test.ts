import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { RunTurnInput } from "../chat-turn";

/**
 * Asking an agent for text and nothing else: no chat is created, the agent
 * works in an empty folder that is removed afterwards, tools are refused, and
 * a stuck or failed agent is an error rather than a hang or an empty answer.
 */

let directory: string;
let service: typeof import("../chat-service");
let store: typeof import("../chat-store");
const saved: Record<string, string | undefined> = {};

before(async () => {
  process.env.AGENTOS_SKIP_MODEL_DISCOVERY = "1";
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-oneshot-test-"));
  for (const key of ["AGENTOS_UI_DIR", "HOME", "ANTHROPIC_API_KEY"]) saved[key] = process.env[key];
  process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
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

describe("askAgentText", () => {
  it("runs the agent text-only in an empty folder, returns what it said, and cleans up", async () => {
    let seen: RunTurnInput | undefined;
    let existedDuring = false;
    let approved: boolean | undefined;
    service.setTurnRunnerForTests(async (input) => {
      seen = input;
      existedDuring = (await fs.readdir(input.policy.projectRoot)).length === 0;
      approved = await input.requestApproval({ tool: "Read", summary: "/etc/passwd", reason: "x", signal: input.controller.signal });
      input.state.message.parts.push({ type: "text", text: "  Hello " }, { type: "tool", id: "t", name: "Read", summary: "x", status: "denied" }, { type: "text", text: "there.  " });
    });

    const answer = await service.askAgentText({ agent: "claude", prompt: "Say hi" });

    assert.equal(answer, "Hello there.");
    assert.equal(seen?.prompt, "Say hi");
    assert.equal(seen?.policy.textOnly, true);
    assert.equal(seen?.resume, undefined, "a one-shot never resumes a session");
    assert.notEqual(seen?.policy.projectRoot, path.resolve(import.meta.dirname, "../../.."), "not the AgentOS repository");
    assert.equal(existedDuring, true, "an empty folder while it ran");
    assert.equal(approved, false, "any tool request is refused");
    await assert.rejects(fs.stat(seen?.policy.projectRoot as string), "removed afterwards");
  });

  it("creates no chat", async () => {
    service.setTurnRunnerForTests(async (input) => void input.state.message.parts.push({ type: "text", text: "ok" }));
    const before = (await store.listChats()).length;
    await service.askAgentText({ agent: "claude", prompt: "Say hi" });
    assert.equal((await store.listChats()).length, before);
  });

  it("uses the model asked for when the agent offers it, and the agent's default when not", async () => {
    const models: string[] = [];
    service.setTurnRunnerForTests(async (input) => {
      models.push(input.model);
      input.state.message.parts.push({ type: "text", text: "ok" });
    });
    await service.askAgentText({ agent: "claude", prompt: "p", model: "haiku" });
    await service.askAgentText({ agent: "claude", prompt: "p", model: "not-a-model" });
    assert.deepEqual(models, ["haiku", "default"]);
  });

  it("reports an agent's own error, an empty answer, and a crash as errors", async () => {
    service.setTurnRunnerForTests(async (input) => void (input.state.message.error = "Claude hit its spending limit for this turn."));
    await assert.rejects(service.askAgentText({ agent: "claude", prompt: "p" }), /spending limit/);

    service.setTurnRunnerForTests(async () => undefined);
    await assert.rejects(service.askAgentText({ agent: "claude", prompt: "p" }), /didn't answer/);

    service.setTurnRunnerForTests(async () => {
      throw new Error("boom");
    });
    await assert.rejects(service.askAgentText({ agent: "claude", prompt: "p" }), (error: unknown) => error instanceof service.ChatStateError && /Claude stopped before answering: boom/.test(error.message));
  });

  it("gives up on an agent that never answers, and still cleans up", async () => {
    let root = "";
    service.setTurnRunnerForTests(
      (input) =>
        new Promise<void>((_, reject) => {
          root = input.policy.projectRoot;
          input.controller.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await assert.rejects(service.askAgentText({ agent: "claude", prompt: "p", timeoutMs: 30 }), /took too long/);
    await assert.rejects(fs.stat(root));
  });

  it("refuses an agent that is not available, with the reason", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      service.setTurnRunnerForTests(async () => assert.fail("must not run"));
      await assert.rejects(service.askAgentText({ agent: "claude", prompt: "p" }), /isn't signed in/);
    } finally {
      process.env.ANTHROPIC_API_KEY = "sk-test-unused";
    }
  });
});
