import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";
import { MANUAL_WAIT_MS, pickWorker, runJob, WorkerStageBlocked, type WorkerDeps } from "../workers";

// Fakes only: no worker is started and nothing waits in real time.
const NAMES: Record<string, string> = { "grok-bot": "Grok Bot", "hermes-worker": "Hermes worker", gemini: "Gemini" };

function deps(options: { available?: string[]; job?: Partial<WorkerJob>; clock?: { at: number } } = {}): WorkerDeps & { started: string[] } {
  const started: string[] = [];
  const available = new Set(options.available ?? ["grok-bot", "hermes-worker", "gemini"]);
  const job = { id: "job_1", worker: "grok-bot", status: "running", objective: "x", project: "p", createdAt: "2026-10-07T08:00:00Z", ...options.job } as WorkerJob;
  return {
    started,
    health: async (id) => ({ available: available.has(id), name: NAMES[id] ?? id, manualOnly: id === "grok-bot", reason: available.has(id) ? undefined : "switched off" }),
    start: async (request) => {
      started.push(request.worker);
      return { job: { ...job, worker: request.worker as WorkerJob["worker"] } };
    },
    read: async () => job,
    sleep: async (ms) => {
      if (options.clock) options.clock.at += ms;
    },
    now: () => options.clock?.at ?? 0,
  };
}

describe("picking a worker for a rebuild stage", () => {
  it("never picks a hand-started worker on its own, even when it is first", async () => {
    const picked = await pickWorker(["grok-bot", "hermes-worker", "gemini"], deps());
    assert.equal(picked.id, "hermes-worker");
  });

  it("uses it when the person chose it", async () => {
    const picked = await pickWorker(["grok-bot"], deps(), true);
    assert.equal(picked.id, "grok-bot");
  });

  it("says how to use it when nothing else is available", async () => {
    await assert.rejects(pickWorker(["grok-bot", "gemini"], deps({ available: ["grok-bot"] })), (error: Error) =>
      error instanceof WorkerStageBlocked && /Grok Bot: started by hand, so only used when you choose it/.test(error.message),
    );
  });
});

describe("waiting on a hand-started worker", () => {
  const bridge = { bridge: { taskPath: "/t", resultPath: "/r" } } as unknown as Partial<WorkerJob>;
  const watch = (chosen: boolean) => ({ onProgress: () => undefined, onStarted: () => undefined, pollMs: 60_000, chosen });

  it("stops after the wait limit with what to do next, instead of running for hours", async () => {
    const clock = { at: 0 };
    await assert.rejects(runJob(() => ({ project: "p", objective: "x" }), ["grok-bot"], undefined, watch(true), deps({ job: bridge, clock })), (error: Error) =>
      error instanceof WorkerStageBlocked && /Still waiting for you to run Grok Bot/.test(error.message) && /Try another worker/.test(error.message),
    );
    assert.ok(clock.at > MANUAL_WAIT_MS && clock.at <= MANUAL_WAIT_MS + 60_000);
  });

  it("stops at once on a hand-started job the plan picked before this rule, rather than resuming the wait", async () => {
    const fake = deps({ job: bridge });
    await assert.rejects(runJob(() => ({ project: "p", objective: "x" }), ["grok-bot", "hermes-worker"], "job_1", watch(false), fake), /Still waiting for you to run Grok Bot/);
    assert.deepEqual(fake.started, []);
  });

  it("keeps waiting on one the person chose", async () => {
    const clock = { at: 0 };
    const answered = { ...bridge, status: "awaiting_review" } as Partial<WorkerJob>;
    const result = await runJob(() => ({ project: "p", objective: "x" }), ["grok-bot"], "job_1", watch(true), deps({ job: answered, clock }));
    assert.equal(result.worker.id, "grok-bot");
  });
});
