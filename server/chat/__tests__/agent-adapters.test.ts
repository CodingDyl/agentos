import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { ChatMessage, ChatToolPart } from "../../../shared/chat-types";
import type { ApprovalRequest, ChatAgentAdapter, TurnState } from "../chat-turn";

/**
 * The Codex and ACP adapters against stand-in agents that speak the real
 * protocols. No model is called; what is tested is AgentOS's side of the
 * wire: the handshake, resuming, choosing a model, folding events into the
 * reply, and above all that every permission request is answered by the
 * policy, with only the risky ones reaching the operator.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../../..");

let directory: string;
let acp: typeof import("../acp-chat-adapter");
let codex: typeof import("../codex-chat-adapter");
let cache: typeof import("../chat-model-cache");
const saved: Record<string, string | undefined> = {};

async function wrapper(name: string, fixture: string): Promise<void> {
  const file = path.join(directory, "bin", name);
  await fs.writeFile(file, `#!/bin/sh\nexec "${process.execPath}" --import tsx "${path.join(here, "fixtures", fixture)}" "$@"\n`, { mode: 0o755 });
}

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-adapters-"));
  await fs.mkdir(path.join(directory, "bin"));
  await wrapper("gemini", "fake-acp-agent.ts");
  await wrapper("codex", "fake-codex-app-server.ts");
  for (const key of ["PATH", "AGENTOS_UI_DIR", "OPENAI_API_KEY"]) saved[key] = process.env[key];
  process.env.PATH = `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
  process.env.OPENAI_API_KEY = "sk-test-unused";
  acp = await import("../acp-chat-adapter");
  codex = await import("../codex-chat-adapter");
  cache = await import("../chat-model-cache");
});

after(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(directory, { recursive: true, force: true });
});

function reply(): ChatMessage {
  return { id: "msg_1", role: "assistant", parts: [], createdAt: new Date().toISOString() };
}

async function turn(agent: ChatAgentAdapter, options: { allow: boolean; resume?: string; model?: string }) {
  const state: TurnState = { message: reply() };
  const asked: ApprovalRequest[] = [];
  await agent.runTurn({
    prompt: "Go",
    model: options.model ?? "default",
    resume: options.resume,
    policy: { projectRoot },
    state,
    controller: new AbortController(),
    onChange: () => undefined,
    requestApproval: async (request) => {
      asked.push(request);
      return options.allow;
    },
  });
  const text = state.message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  const tool = (id: string) => state.message.parts.find((part): part is ChatToolPart => part.type === "tool" && part.id === id);
  return { state, asked, text, tool };
}

describe("an ACP agent (Gemini CLI, Hermes)", () => {
  it("asks the operator about the risky command only, and records a denial as a denial", async () => {
    const { state, asked, text, tool } = await turn(acp.geminiAgent, { allow: false });

    assert.deepEqual(asked.map((request) => request.summary), ["git push origin main"]);
    assert.match(asked[0].reason, /read-only list/);
    assert.match(text, /git status ran/);
    assert.match(text, /git push origin main skipped/);
    assert.equal(tool("t1")?.status, "done");
    assert.equal(tool("t1")?.output, "git status: ok");
    assert.equal(tool("t2")?.status, "denied");
    assert.equal(state.sessionId, "s-new");
  });

  it("learns the agent's models, and the picker lists them from then on", async () => {
    await turn(acp.geminiAgent, { allow: true });
    assert.deepEqual(cache.cachedModels("gemini").map((model) => model.id), ["fast-1", "smart-2"]);
    const described = await acp.geminiAgent.describe();
    assert.deepEqual(described.models.map((model) => model.id), ["default", "fast-1", "smart-2"]);
    assert.equal(described.available, true);
  });

  it("resumes the session, ignores the replayed history, and switches model", async () => {
    const { state, text, tool } = await turn(acp.geminiAgent, { allow: true, resume: "s-old", model: "smart-2" });

    assert.equal(state.sessionId, "s-old");
    assert.doesNotMatch(text, /OLD HISTORY/);
    assert.match(text, /model=smart-2/);
    assert.equal(state.message.model, "smart-2");
    assert.equal(tool("t2")?.status, "done");
  });

  it("starts fresh, and says so, when the old session is gone", async () => {
    const { state, text } = await turn(acp.geminiAgent, { allow: true, resume: "missing" });
    assert.equal(state.sessionId, "s-new");
    assert.match(text, /couldn't reopen the earlier part of this chat/);
  });

  it("reports an agent that isn't installed, with the fix", async () => {
    const described = await acp.hermesAgent.describe();
    assert.equal(described.available, false);
    assert.match(described.unavailableReason ?? "", /isn't installed/);
  });
});

describe("Codex, through its app-server", () => {
  it("answers approvals from the policy: the read goes through, the push and the outside edit come to the operator", async () => {
    const { state, asked, text, tool } = await turn(codex.codexAgent, { allow: false });

    assert.deepEqual(
      asked.map((request) => [request.tool, request.summary]),
      [
        ["Bash", "git push origin main"],
        ["Edit", "/etc/hosts"],
      ],
    );
    assert.match(asked[1].reason, /outside the AgentOS project/);
    assert.equal(text, "Checking. Done.");
    assert.equal(tool("c1")?.status, "done");
    assert.equal(tool("c1")?.output, "git status: ok");
    assert.equal(tool("c2")?.status, "denied");
    assert.equal(tool("f1")?.status, "denied");
    assert.equal(state.sessionId, "th-1");
  });

  it("runs what the operator allows", async () => {
    const { tool } = await turn(codex.codexAgent, { allow: true });
    assert.equal(tool("c2")?.status, "done");
    assert.equal(tool("f1")?.status, "done");
  });

  it("resumes its thread, or starts a new one and says so", async () => {
    const resumed = await turn(codex.codexAgent, { allow: true, resume: "th-1" });
    assert.doesNotMatch(resumed.text, /couldn't reopen/);

    const fresh = await turn(codex.codexAgent, { allow: true, resume: "th-gone" });
    assert.match(fresh.text, /couldn't reopen the earlier part of this chat/);
    assert.equal(fresh.state.sessionId, "th-1");
  });

  it("names its models from Codex's own catalogue, hiding hidden ones", () => {
    assert.deepEqual(
      codex.modelsFromCatalogue([
        { id: "gpt-a", displayName: "GPT A", description: "Fast.\nMore." },
        { id: "gpt-hidden", displayName: "Hidden", hidden: true },
      ]),
      [{ id: "gpt-a", label: "GPT A", hint: "Fast." }],
    );
  });
});

describe("ACP details", () => {
  it("reads models from grouped config options too", () => {
    const found = acp.modelOption([
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "b",
        options: [{ group: "g", name: "Group", options: [{ value: "a", name: "A" }, { value: "b", name: "B" }] }],
      } as never,
    ]);
    assert.deepEqual(found?.models.map((model) => model.id), ["a", "b"]);
    assert.equal(found?.current, "b");
  });

  it("answers with a one-time option, never 'always', so the policy decides every time", () => {
    const options = [
      { optionId: "always", name: "Always", kind: "allow_always" as const },
      { optionId: "once", name: "Once", kind: "allow_once" as const },
      { optionId: "no", name: "No", kind: "reject_once" as const },
    ];
    assert.deepEqual(acp.permissionResponse({ options }, true), { outcome: { outcome: "selected", optionId: "once" } });
    assert.deepEqual(acp.permissionResponse({ options }, false), { outcome: { outcome: "selected", optionId: "no" } });
    assert.deepEqual(acp.permissionResponse({ options: [] }, true), { outcome: { outcome: "cancelled" } });
  });
});
