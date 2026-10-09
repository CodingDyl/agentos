import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActiveWorkItem } from "@shared/mission-control-types";
import type { LiveAgent } from "@shared/usage-types";
import {
  formatNetworkCounts,
  networkCounts,
  pickTask,
  sameAgent,
  toNode,
} from "../agent-network-model";

/**
 * The agent network only earns its movement if a node that is working always
 * looks it, whatever kind of task it is on and whichever read noticed first.
 *
 * Activity comes from jobs (`activeWork`), never from Operations' slower
 * `live[].state`. The two views on this tab — the graph and Working On —
 * therefore cannot disagree: they share this derivation.
 */

function agent(overrides: Partial<LiveAgent> = {}): LiveAgent {
  return { agent: "claude-code", label: "Claude Code", state: "ready", ...overrides };
}

function task(overrides: Partial<ActiveWorkItem> = {}): ActiveWorkItem {
  return {
    id: "job_1",
    actor: "CLAUDE-CODE",
    agent: "claude-code",
    title: "Refactor billing webhooks",
    startedAt: "2026-10-08T10:00:00.000Z",
    href: "/workers/jobs/job_1",
    uncertain: false,
    ...overrides,
  };
}

function workforce(): LiveAgent[] {
  return [
    { agent: "mock", label: "Mock", state: "ready" },
    { agent: "claude", label: "Claude", state: "ready" },
    { agent: "codex", label: "Codex", state: "ready" },
    { agent: "hermes-worker", label: "Hermes Agent", state: "ready" },
    { agent: "grok-bot", label: "Grok Bot", state: "ready" },
    { agent: "grok", label: "Grok Build", state: "ready" },
    { agent: "claude-code", label: "Claude Code", state: "ready" },
    { agent: "gemini", label: "Gemini CLI", state: "offline" },
    { agent: "ollama", label: "Ollama (local)", state: "ready" },
  ];
}

describe("agent identity", () => {
  it("matches a worker id to its label, actor, and hyphenation", () => {
    assert.equal(sameAgent("claude-code", "claude-code"), true);
    assert.equal(sameAgent("claude-code", "Claude Code"), true);
    assert.equal(sameAgent("claude-code", "CLAUDE-CODE"), true);
    assert.equal(sameAgent("claude-code", "Claude  Code"), true);
    assert.equal(sameAgent("claude-code", "grok"), false);
    assert.equal(sameAgent("claude-code", undefined), false);
    assert.equal(sameAgent(undefined, "claude-code"), false);
  });
});

describe("agent network nodes", () => {
  it("is working when a live task names the agent, even if Operations has not caught up", () => {
    // The case that had no visual cue: Operations reads every minute and said "ready".
    const node = toNode(agent({ state: "ready" }), [task()]);

    assert.equal(node.state, "running");
    assert.equal(node.task?.href, "/workers/jobs/job_1");
    assert.equal(node.tasks.length, 1);
  });

  it("does not treat Operations' running flag as activity of its own", () => {
    // Jobs are the source of activity. A stale Operations read saying "running"
    // with nothing in Working On would otherwise light a node the list denies.
    assert.equal(toNode(agent({ state: "running" }), []).state, "ready");
  });

  it("never animates a task nothing is executing", () => {
    const node = toNode(agent(), [task({ uncertain: true })]);

    assert.equal(node.state, "uncertain");
    // Still linked, so the operator can go and see whether it finished.
    assert.equal(node.task?.id, "job_1");
    assert.equal(node.tasks.length, 1);
  });

  it("matches a job keyed by label rather than id", () => {
    const node = toNode(agent(), [task({ agent: "Claude Code" })]);
    assert.equal(node.state, "running");
  });

  it("matches a job keyed by the actor stamp when agent is missing", () => {
    const node = toNode(agent(), [task({ agent: undefined, actor: "CLAUDE-CODE" })]);
    assert.equal(node.state, "running");
  });

  it("ignores tasks that belong to someone else", () => {
    assert.equal(toNode(agent(), [task({ agent: "grok", actor: "GROK" }), task({ agent: undefined, actor: "HERMES" })]).state, "ready");
  });

  it("keeps offline when nothing names the agent", () => {
    assert.equal(toNode(agent({ state: "offline" }), []).state, "offline");
  });

  it("still shows activity when the worker is listed offline", () => {
    const node = toNode(agent({ state: "offline" }), [task()]);
    assert.equal(node.state, "running");
  });

  it("prefers the live task over a stale one, and keeps both", () => {
    const stale = task({ id: "old", uncertain: true });
    const live = task({ id: "new" });
    const node = toNode(agent(), [stale, live]);

    assert.equal(pickTask([stale, live])?.id, "new");
    assert.equal(pickTask([stale])?.id, "old");
    assert.equal(pickTask([]), undefined);
    assert.equal(node.task?.id, "new");
    assert.equal(node.tasks.length, 2);
    assert.equal(node.state, "running");
  });
});

describe("shared network counts", () => {
  it("counts unconfirmed apart from ready, matching Working On", () => {
    // The screenshot: Claude Code has a stale Motion job, Gemini is offline,
    // nothing is confidently running. Working On said 1; the graph said 0/8/1.
    const nodes = workforce().map((entry) =>
      toNode(entry, [task({ uncertain: true, lastSeenAt: "2026-10-08T12:00:00.000Z" })]),
    );
    const counts = networkCounts(nodes);

    assert.equal(counts.running, 0);
    assert.equal(counts.unconfirmed, 1);
    assert.equal(counts.ready, 7);
    assert.equal(counts.offline, 1);
    assert.equal(formatNetworkCounts(counts), "0 running · 1 unconfirmed · 7 ready · 1 offline");
  });

  it("counts a live job as running, not unconfirmed", () => {
    const nodes = workforce().map((entry) => toNode(entry, [task()]));
    const counts = networkCounts(nodes);

    assert.equal(counts.running, 1);
    assert.equal(counts.unconfirmed, 0);
    assert.equal(counts.ready, 7);
    assert.equal(counts.offline, 1);
    assert.equal(formatNetworkCounts(counts), "1 running · 7 ready · 1 offline");
  });

  it("omits an unconfirmed segment when there is nothing to hedge", () => {
    assert.equal(
      formatNetworkCounts({ running: 0, unconfirmed: 0, ready: 8, offline: 1 }),
      "0 running · 8 ready · 1 offline",
    );
  });
});
