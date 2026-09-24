import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { skipReasonFor } from "../milestone-delegation";
import type { RoadmapTask } from "../../../shared/agentos-types";

function task(overrides: Partial<RoadmapTask> = {}): RoadmapTask {
  return {
    id: "PP-001",
    title: "Example task",
    section: "now",
    completed: false,
    status: "ready",
    blockedBy: [],
    ...overrides,
  };
}

describe("skipReasonFor", () => {
  it("is eligible when ready", () => {
    assert.equal(skipReasonFor(task({ status: "ready" })), undefined);
  });

  it("is eligible when only in the backlog", () => {
    assert.equal(skipReasonFor(task({ status: "backlog" })), undefined);
  });

  it("skips a task that is already done", () => {
    assert.equal(skipReasonFor(task({ status: "done" })), "Already done.");
  });

  it("skips a blocked task, naming what it is blocked by", () => {
    assert.equal(
      skipReasonFor(task({ status: "blocked", blockedBy: ["PP-000"] })),
      "Blocked by PP-000.",
    );
  });

  it("names every blocker when there is more than one", () => {
    assert.equal(
      skipReasonFor(task({ status: "blocked", blockedBy: ["PP-000", "PP-002"] })),
      "Blocked by PP-000, PP-002.",
    );
  });

  it("skips a task already in progress", () => {
    assert.equal(skipReasonFor(task({ status: "in_progress" })), "Already has an active worker job.");
  });

  it("skips a task awaiting review", () => {
    assert.equal(skipReasonFor(task({ status: "review" })), "Already has an active worker job.");
  });
});
