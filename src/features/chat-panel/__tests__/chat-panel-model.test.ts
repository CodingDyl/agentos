import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatAgent } from "@shared/chat-types";
import { jarvisChatRoute, jarvisChatTarget, screenTitle } from "../chat-panel-model";

describe("the screen a ⌘J message was sent from", () => {
  it("is named by the navigation entry its address sits under", () => {
    assert.equal(screenTitle("/"), "Dashboard");
    assert.equal(screenTitle("/inbox"), "Inbox");
    assert.equal(screenTitle("/workspaces/pantry-pilot"), "Workspaces");
    assert.equal(screenTitle("/designs/motion/abc"), "Creative");
  });

  it("falls back to AgentOS for an address with no entry", () => {
    assert.equal(screenTitle("/design-system"), "AgentOS");
    assert.equal(screenTitle("/inboxes"), "AgentOS", "a prefix of a word is not the same screen");
  });
});

const agent = (id: ChatAgent["id"], available = true): ChatAgent =>
  ({ id, name: id, models: [{ id: `${id}-default`, label: id }], defaultModel: `${id}-default`, available, unavailableReason: available ? undefined : `${id} is not signed in.` }) as ChatAgent;

describe("where Jarvis sends a request no screen has taken over", () => {
  it("goes to the ⌘J chat when Claude can be used, so AgentOS's tools are there", () => {
    assert.deepEqual(jarvisChatRoute({ agents: [agent("hermes"), agent("claude")], panelAvailable: true }), { to: "chat" });
  });

  it("stays with Hermes when Claude can't be used", () => {
    const route = jarvisChatRoute({ agents: [agent("hermes"), agent("claude", false)], panelAvailable: true });
    assert.equal(route.to, "hermes");
    assert.match(route.to === "hermes" ? route.reason : "", /claude is not signed in/);
    assert.equal(jarvisChatRoute({ agents: [agent("codex")], panelAvailable: true }).to, "hermes");
  });

  it("stays with Hermes before the agents have loaded, and where the panel doesn't open", () => {
    assert.equal(jarvisChatRoute({ agents: undefined, panelAvailable: true }).to, "hermes");
    assert.equal(jarvisChatRoute({ agents: [agent("claude")], panelAvailable: false }).to, "hermes");
  });
});

describe("which chat a request from Jarvis goes into", () => {
  const agents = [agent("codex"), agent("claude")];

  it("carries on in the panel's chat when it is a Claude chat", () => {
    assert.deepEqual(jarvisChatTarget(agents, { agent: "claude" }), { continueCurrent: true });
  });

  it("starts a Claude assistant chat when the panel has none, or one without the tools", () => {
    const fresh = { continueCurrent: false, choice: { agent: "claude", model: "claude-default" }, mode: "assistant" };
    assert.deepEqual(jarvisChatTarget(agents, undefined), fresh);
    assert.deepEqual(jarvisChatTarget(agents, { agent: "codex" }), fresh);
    assert.deepEqual(jarvisChatTarget(agents, { agent: "hermes" }), fresh);
  });
});
