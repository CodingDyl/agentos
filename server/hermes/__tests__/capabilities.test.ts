import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCapabilities, readFlag } from "../capabilities";
import { readRun, readRunStatus } from "../runs";

/**
 * Capability discovery must fail closed: an unfamiliar payload disables
 * features rather than enabling ones this Hermes may not have.
 */

describe("capability discovery", () => {
  it("reads flags nested under `capabilities`", () => {
    const caps = readCapabilities({
      capabilities: { runs: true, events: true, stop: true, steer: true },
    });

    assert.equal(caps.available, true);
    assert.equal(caps.runs, true);
    assert.equal(caps.steer, true);
  });

  it("reads flags at the top level", () => {
    assert.equal(readCapabilities({ runs: true, stop: true }).stop, true);
  });

  it("reads a feature list", () => {
    const caps = readCapabilities({ features: ["runs", "events", "subagents"] });

    assert.equal(caps.runs, true);
    assert.equal(caps.events, true);
    assert.equal(caps.subagents, true);
    assert.equal(caps.steer, false);
  });

  it("disables run-dependent features when runs are unsupported", () => {
    const caps = readCapabilities({ stop: true, steer: true, approvals: true });

    assert.equal(caps.runs, false);
    assert.equal(caps.stop, false);
    assert.equal(caps.steer, false);
    assert.equal(caps.approvals, false);
  });

  it("turns everything off for an unfamiliar payload", () => {
    for (const payload of [{}, null, "nonsense", { other: { thing: true } }]) {
      const caps = readCapabilities(payload);
      assert.equal(caps.runs, false);
      assert.equal(caps.approvals, false);
    }
  });

  it("reads the flag names Hermes actually publishes", () => {
    // The shape a real Hermes returns. The console reported no run support
    // against this payload for as long as the aliases only looked for `runs`,
    // which meant the agent screen quietly fell back to plain messaging while
    // every run endpoint was available.
    const caps = readCapabilities({
      features: {
        run_submission: true,
        run_status: true,
        run_events_sse: true,
        run_stop: true,
        run_steer: true,
        run_approval_response: true,
        tool_progress_events: true,
        approval_events: true,
      },
    });

    assert.equal(caps.runs, true);
    assert.equal(caps.events, true);
    assert.equal(caps.stop, true);
    assert.equal(caps.steer, true);
    assert.equal(caps.approvals, true);
  });

  it("does not claim subagents from a payload that never mentions them", () => {
    // Hermes advertises a `delegation` toolset, which is a tool being
    // installed rather than a statement about the run API.
    const caps = readCapabilities({
      features: { run_submission: true, run_status: true },
    });

    assert.equal(caps.runs, true);
    assert.equal(caps.subagents, false);
  });

  it("still refuses run-dependent features when nothing offers runs", () => {
    // The widened aliases must not become a way in: a payload that only
    // mentions stopping and steering has still not said it can start a run.
    const caps = readCapabilities({
      features: { run_stop: true, run_steer: true, run_events_sse: true },
    });

    assert.equal(caps.runs, false);
    assert.equal(caps.stop, false);
    assert.equal(caps.events, false);
  });

  it("does not treat a false or absent flag as support", () => {
    assert.equal(readFlag({ runs: false }, ["runs"]), false);
    assert.equal(readFlag({}, ["runs"]), false);
  });
});

describe("run payloads", () => {
  it("accepts snake_case and camelCase ids", () => {
    assert.equal(readRun({ run_id: "a" }).runId, "a");
    assert.equal(readRun({ runId: "b" }).runId, "b");
    assert.equal(readRun({ id: "c" }).runId, "c");
  });

  it("reads a run nested under `run`", () => {
    assert.equal(readRun({ run: { run_id: "nested", status: "running" } }).runId, "nested");
  });

  it("carries the session id through", () => {
    assert.equal(readRun({ run_id: "a", session_id: "s1" }).sessionId, "s1");
  });

  it("refuses a payload with no run id", () => {
    assert.throws(() => readRun({ status: "running" }), /run id/);
    assert.throws(() => readRun(null), /unreadable/);
  });
});

describe("run status mapping", () => {
  it("passes through known statuses", () => {
    assert.equal(readRunStatus("completed"), "completed");
    assert.equal(readRunStatus("waiting_for_approval"), "waiting_for_approval");
  });

  it("normalises spacing and casing", () => {
    assert.equal(readRunStatus("Waiting For Approval"), "waiting_for_approval");
    assert.equal(readRunStatus("in-progress"), "running");
  });

  it("maps near-misses rather than failing a live run", () => {
    assert.equal(readRunStatus("succeeded"), "completed");
    assert.equal(readRunStatus("canceling"), "cancelled");
    assert.equal(readRunStatus("errored"), "failed");
    assert.equal(readRunStatus("queued"), "starting");
  });

  it("defaults to running for anything unrecognised", () => {
    assert.equal(readRunStatus("bananas"), "running");
    assert.equal(readRunStatus(undefined), "running");
  });
});
