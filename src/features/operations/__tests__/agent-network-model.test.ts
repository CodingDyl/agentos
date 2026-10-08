import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActiveWorkItem } from "@shared/mission-control-types";
import type { LiveAgent } from "@shared/usage-types";
import { pickTask, toNode } from "../agent-network-model";

/**
 * The agent network only earns its movement if a node that is working always
 * looks it, whatever kind of task it is on and whichever read noticed first.
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

describe("agent network nodes", () => {
  it("is working when a live task names the agent, even if Operations has not caught up", () => {
    // The case that had no visual cue: Operations reads every minute and said "ready".
    const node = toNode(agent({ state: "ready" }), [task()]);

    assert.equal(node.state, "running");
    assert.equal(node.task?.href, "/workers/jobs/job_1");
  });

  it("is working when Operations says so, with or without a task", () => {
    assert.equal(toNode(agent({ state: "running" }), []).state, "running");
  });

  it("never animates a task nothing is executing", () => {
    const node = toNode(agent(), [task({ uncertain: true })]);

    assert.equal(node.state, "uncertain");
    // Still linked, so the operator can go and see whether it finished.
    assert.equal(node.task?.id, "job_1");
  });

  it("ignores tasks that belong to someone else", () => {
    assert.equal(toNode(agent(), [task({ agent: "grok" }), task({ agent: undefined })]).state, "ready");
  });

  it("keeps offline when nothing names the agent", () => {
    assert.equal(toNode(agent({ state: "offline" }), []).state, "offline");
  });

  it("prefers the live task over a stale one", () => {
    const stale = task({ id: "old", uncertain: true });
    const live = task({ id: "new" });

    assert.equal(pickTask([stale, live])?.id, "new");
    assert.equal(pickTask([stale])?.id, "old");
    assert.equal(pickTask([]), undefined);
  });
});
