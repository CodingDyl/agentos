import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * A job being reviewed is not a job nobody is executing. The sweep once
 * marked a finished, validated job "failed" four seconds into its review.
 */
describe("the liveness sweep and reviews", () => {
  let ui: string;
  let previous: string | undefined;
  let manager: typeof import("../job-manager");
  let store: typeof import("../job-store");

  const job = (id: string) =>
    ({ id, worker: "mock", requestedWorker: "mock", resolvedWorker: "mock", project: "demo", objective: "x", status: "reviewing", revision: 1, createdAt: new Date().toISOString() }) as never;

  before(async () => {
    ui = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-review-live-"));
    previous = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = ui;
    manager = await import("../job-manager");
    store = await import("../job-store");
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;
    await fs.rm(ui, { recursive: true, force: true });
  });

  it("leaves a job alone while its review is in progress", async () => {
    await store.saveJob(job("job_reviewing00000000"));
    await manager.holding("job_reviewing00000000", async () => {
      assert.deepEqual(await manager.reconcileInterruptedJobs("Nothing is executing this job"), []);
      assert.equal((await store.readJob("job_reviewing00000000"))?.status, "reviewing");
    });
  });

  it("puts a review cut off by a restart back to waiting, never failed", async () => {
    await store.saveJob(job("job_cutoff00000000000"));
    await manager.reconcileInterruptedJobs("AgentOS restarted");
    assert.equal((await store.readJob("job_cutoff00000000000"))?.status, "awaiting_review");
  });
});
