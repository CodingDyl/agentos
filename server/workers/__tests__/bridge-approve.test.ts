import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

// A throwaway state folder: jobs are written here, never to the real one. No worker runs.
const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bridge-approve-"));
process.env.AGENTOS_UI_DIR = state;

const { approveJob, textResultApprovable } = await import("../review");
const { createJobId, readJob, saveJob } = await import("../job-store");
const { bridgeAttempt } = await import("../../route-policy/dispatch");

after(() => fs.rmSync(state, { recursive: true, force: true }));

const bridge = {
  taskId: "job_x-5b4194",
  workspace: "/Volumes/DylanSSD/AgentOS-grok-poc",
  taskPath: "/Volumes/DylanSSD/AgentOS-grok-poc/tasks/job_x-5b4194.json",
  resultPath: "/Volumes/DylanSSD/AgentOS-grok-poc/results/job_x-5b4194.json",
  memoryDir: "/Volumes/DylanSSD/AgentOS-grok-poc/memory/job_x-5b4194",
  exportedAt: "2026-10-07T08:00:00.000Z",
  notes: [],
  instruction: "AgentOS task …",
  importedAt: "2026-10-07T10:00:00.000Z",
  resultHash: "abc",
};

function bridgeJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: createJobId(),
    worker: "grok-bot",
    resolvedWorker: "grok-bot",
    project: "watergate",
    objective: "Research how Watergate compares with the businesses doing best online.",
    status: "awaiting_review",
    createdAt: "2026-10-07T08:00:00.000Z",
    startedAt: "2026-10-07T08:00:01.000Z",
    bridge,
    result: { summary: "# Five key areas\n\n1. Speed …", changedFiles: [] },
    ...overrides,
  } as WorkerJob;
}

describe("approving a Grok Bot text result", () => {
  it("approves an imported answer whose job has no attempts recorded (attempts: undefined)", async () => {
    const job = bridgeJob({ attempts: undefined });
    await saveJob(job);
    const result = await approveJob(job.id);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((await readJob(job.id))?.status, "completed");
  });

  it("also with an empty attempts list", () => {
    assert.deepEqual(textResultApprovable(bridgeJob({ attempts: [] })), { ok: true });
  });

  it("refuses an empty answer, and a bridge job whose result was never imported", () => {
    assert.match((textResultApprovable(bridgeJob({ result: { summary: "  ", changedFiles: [] } as WorkerJob["result"] })) as { error: string }).error, /result is empty/);
    assert.match(
      (textResultApprovable(bridgeJob({ bridge: { ...bridge, importedAt: undefined }, attempts: undefined })) as { error: string }).error,
      /did not produce a validated result/,
    );
  });

  it("still refuses when a recorded attempt failed, or failed validation", () => {
    const failed = bridgeAttempt(bridgeJob(), "failed", "Grok reported it could not do the task");
    assert.equal(textResultApprovable(bridgeJob({ attempts: [failed] })).ok, false);
    const invalid = { ...bridgeAttempt(bridgeJob(), "succeeded"), validation: { passed: false } };
    assert.equal(textResultApprovable(bridgeJob({ attempts: [invalid] })).ok, false);
  });

  it("keeps routed text jobs to the old rule: no attempt, no approval", () => {
    const routed = bridgeJob({ bridge: undefined, attempts: undefined, routing: { policy: {} } as WorkerJob["routing"] });
    assert.equal(textResultApprovable(routed).ok, false);
  });
});

describe("the attempt a bridge job now records", () => {
  it("is one succeeded attempt with a passing validation that says what was checked", () => {
    const attempt = bridgeAttempt(bridgeJob(), "succeeded");
    assert.equal(attempt.attempt, 1);
    assert.equal(attempt.workerId, "grok-bot");
    assert.equal(attempt.outcome, "succeeded");
    assert.equal(attempt.trigger, "initial");
    assert.equal(attempt.startedAt, "2026-10-07T08:00:01.000Z");
    assert.deepEqual(attempt.validation?.passed, true);
    assert.match(attempt.validation?.detail ?? "", /matching the result schema/);
    assert.deepEqual(textResultApprovable(bridgeJob({ attempts: [attempt] })), { ok: true });
  });

  it("records a failure as failed validation, so it cannot be approved", () => {
    const attempt = bridgeAttempt(bridgeJob(), "failed", "AgentOS's own validation failed after the result was imported.");
    assert.equal(attempt.outcome, "failed");
    assert.equal(attempt.validation?.passed, false);
  });
});
