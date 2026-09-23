import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRunEvent } from "../../../../shared/agentos-types";
import {
  applyRunEvent,
  initialRunState,
  isTerminal,
  resolveApproval,
  settleRunState,
} from "../run-events";

const event = (type: string, data: unknown = {}): AgentRunEvent => ({ type, data });

function fold(...events: AgentRunEvent[]) {
  // Folded one at a time: `reduce` would pass the array index as the run id.
  return events.reduce((state, next) => applyRunEvent(state, next), initialRunState);
}

describe("streamed output", () => {
  it("accumulates text deltas in order", () => {
    const state = fold(
      event("text.delta", { text: "Based on " }),
      event("text.delta", { text: "your state" }),
    );

    assert.equal(state.output, "Based on your state");
  });

  it("accepts the several field names a delta may use", () => {
    assert.equal(fold(event("token", { delta: "a" })).output, "a");
    assert.equal(fold(event("message.delta", { content: "b" })).output, "b");
    assert.equal(fold(event("output.delta", { chunk: "c" })).output, "c");
  });
});

describe("tool activity", () => {
  it("marks a step running, then complete", () => {
    const running = fold(event("tool.started", { name: "Reading context" }));
    assert.deepEqual(running.steps, [
      { id: "Reading context", label: "Reading context", state: "running" },
    ]);

    const done = applyRunEvent(
      running,
      event("tool.completed", { name: "Reading context" }),
    );
    assert.equal(done.steps.length, 1);
    assert.equal(done.steps[0].state, "complete");
  });

  it("keeps separate steps apart", () => {
    const state = fold(
      event("tool.started", { name: "One" }),
      event("tool.started", { name: "Two" }),
    );

    assert.deepEqual(
      state.steps.map((step) => step.label),
      ["One", "Two"],
    );
  });

  it("matches naming variants of the same family", () => {
    assert.equal(fold(event("tool_start", { name: "X" })).steps.length, 1);
    assert.equal(fold(event("agent.step.begin", { label: "Y" })).steps.length, 1);
  });

  it("marks a failed tool as an error", () => {
    assert.equal(
      fold(event("tool.failed", { name: "Broken" })).steps[0].state,
      "error",
    );
  });
});

describe("subagents", () => {
  it("tracks delegated agents separately from tools", () => {
    const state = fold(
      event("subagent.start", { name: "Research Agent" }),
      event("tool.started", { name: "A tool" }),
      event("subagent.complete", { name: "Research Agent" }),
    );

    assert.deepEqual(state.subagents, [
      { name: "Research Agent", state: "complete" },
    ]);
    assert.equal(state.steps.length, 1);
  });
});

describe("run status", () => {
  it("follows the lifecycle to completion", () => {
    assert.equal(fold(event("run.started")).status, "running");
    assert.equal(fold(event("run.completed")).status, "completed");
  });

  it("distinguishes stopping from cancelled", () => {
    assert.equal(fold(event("run.stopping")).status, "stopping");
    assert.equal(fold(event("run.cancelled")).status, "cancelled");
  });

  it("records a failure reason", () => {
    const state = fold(event("run.failed", { error: "boom" }));

    assert.equal(state.status, "failed");
    assert.equal(state.error, "boom");
  });

  it("does not treat steering as a status change", () => {
    const state = fold(event("run.started"), event("run.steered", { guidance: "x" }));

    assert.equal(state.status, "running");
  });

  it("knows which statuses are terminal", () => {
    assert.ok(isTerminal("completed") && isTerminal("failed") && isTerminal("cancelled"));
    assert.ok(!isTerminal("running") && !isTerminal("waiting_for_approval"));
  });
});

describe("approvals", () => {
  it("captures the requested command", () => {
    const state = fold(
      event("approval.request", { id: "a1", command: "git commit -m 'x'" }),
    );

    assert.equal(state.status, "waiting_for_approval");
    assert.equal(state.approval?.command, "git commit -m 'x'");
  });

  it("still offers a decision when the request names no command", () => {
    // A gate with nothing to respond to would hang the run, so a request is
    // always answerable even when Hermes describes it sparsely.
    const state = fold(event("approval.request", { id: "a2" }));

    assert.equal(state.status, "waiting_for_approval");
    assert.equal(state.approval?.requestId, "a2");
    assert.equal(state.approval?.status, "pending");
  });

  it("carries the run id through when the event omits it", () => {
    const state = applyRunEvent(
      initialRunState,
      { type: "approval.request", data: { id: "a3" } },
      "run-77",
    );

    assert.equal(state.approval?.runId, "run-77");
  });

  it("reopens the run once the gate is answered", () => {
    const state = fold(
      event("approval.request", { id: "a4", command: "write" }),
      event("approval.resolved", {}),
    );

    assert.equal(state.status, "running");
    assert.equal(state.approval?.status, "approved");
  });

  it("records a denial as a denial", () => {
    const state = fold(
      event("approval.request", { id: "a5", command: "write" }),
      event("approval.denied", {}),
    );

    assert.equal(state.approval?.status, "denied");
  });

  it("marks the operator's own decision", () => {
    const waiting = fold(event("approval.request", { id: "a6", command: "write" }));

    assert.equal(resolveApproval(waiting, "once").approval?.status, "approved");
    assert.equal(resolveApproval(waiting, "deny").approval?.status, "denied");
    assert.equal(resolveApproval(waiting, "once").status, "running");
  });
});

describe("unknown events", () => {
  it("keeps them instead of throwing", () => {
    const state = fold(event("some.future.event", { note: "hi" }));

    assert.equal(state.unrecognised.length, 1);
    assert.equal(state.unrecognised[0].type, "some.future.event");
  });

  it("does not disturb the rest of the state", () => {
    const state = fold(
      event("tool.started", { name: "Real work" }),
      event("totally.new.thing"),
      event("text.delta", { text: "output" }),
    );

    assert.equal(state.steps.length, 1);
    assert.equal(state.output, "output");
    assert.equal(state.unrecognised.length, 1);
  });

  it("survives events with no data at all", () => {
    assert.doesNotThrow(() => fold(event("weird", null), event("odd", "a string")));
  });
});

describe("settling", () => {
  it("resolves still-running activity when a run ends", () => {
    const state = settleRunState(
      fold(
        event("tool.started", { name: "Unfinished" }),
        event("subagent.start", { name: "Agent" }),
      ),
    );

    assert.equal(state.steps[0].state, "complete");
    assert.equal(state.subagents[0].state, "complete");
  });

  it("leaves errors as errors", () => {
    const state = settleRunState(fold(event("tool.failed", { name: "Broken" })));

    assert.equal(state.steps[0].state, "error");
  });
});
