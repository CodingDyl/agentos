import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

/**
 * The failure the run loop cannot record: the process dying under a job.
 *
 * A job record that says `running` with nothing running it is the one lie the
 * console must never tell. These prove that boot settles such records, that a
 * retry produces a fresh linked job, that heartbeats land on the record, and
 * that Hermes' guessed context paths are pointed at real files.
 */

describe("job liveness", () => {
  let directory: string;
  let previous: string | undefined;
  let manager: typeof import("../job-manager");
  let store: typeof import("../job-store");

  function job(overrides: Partial<WorkerJob>): WorkerJob {
    return {
      id: overrides.id ?? store.createJobId(),
      worker: "mock",
      requestedWorker: "mock",
      resolvedWorker: "mock",
      project: "pantry-pilot",
      objective: "Prove something",
      status: "running",
      revision: 1,
      createdAt: "2026-09-14T17:50:35.332Z",
      startedAt: "2026-09-14T17:50:35.333Z",
      ...overrides,
    } as WorkerJob;
  }

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-liveness-"));
    previous = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = directory;

    manager = await import("../job-manager");
    store = await import("../job-store");
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("marks jobs left live by a dead process as interrupted, and leaves settled ones alone", async () => {
    const orphan = job({ id: "job_orphan00000000", status: "running", lastEventAt: "2026-09-14T17:50:50.000Z" });
    const preparing = job({ id: "job_orphan00000001", status: "preparing" });
    const parked = job({ id: "job_parked000000000", status: "awaiting_review" });
    const done = job({ id: "job_done00000000000", status: "completed", completedAt: "2026-09-14T18:00:00.000Z" });

    for (const entry of [orphan, preparing, parked, done]) await store.saveJob(entry);

    const interrupted = await manager.reconcileInterruptedJobs("AgentOS restarted");

    assert.deepEqual(
      interrupted.map((entry) => entry.id).sort(),
      ["job_orphan00000000", "job_orphan00000001"],
    );

    const settled = await store.readJob("job_orphan00000000");
    assert.equal(settled?.status, "failed");
    assert.ok(settled?.interruptedAt);
    assert.ok(settled?.completedAt);
    assert.match(settled?.error ?? "", /Interrupted: AgentOS restarted/);
    // The reason names when it was last heard from, so the operator knows how
    // much was lost.
    assert.match(settled?.error ?? "", /2026-09-14T17:50:50/);

    const events = await store.readEvents("job_orphan00000000");
    assert.equal(events.at(-1)?.type, "job.interrupted");

    assert.equal((await store.readJob("job_parked000000000"))?.status, "awaiting_review");
    assert.equal((await store.readJob("job_done00000000000"))?.status, "completed");

    // Idempotent: a second boot finds nothing to do.
    assert.deepEqual(await manager.reconcileInterruptedJobs(), []);
  });

  it("retries a finished job as a new job that remembers the old one", async () => {
    const failed = job({
      id: "job_failed000000000",
      status: "failed",
      error: "Interrupted",
      completedAt: "2026-09-14T18:00:00.000Z",
      constraints: ["Keep it small"],
    });
    await store.saveJob(failed);

    const { saveTaskLink } = await import("../../agentos/task-jobs");
    await saveTaskLink({ project: "pantry-pilot", taskId: "PP-002", jobId: failed.id, delegatedAt: failed.createdAt });

    const { job: retried, error } = await manager.retryJob("job_failed000000000");

    assert.equal(error, undefined);
    assert.ok(retried);
    assert.notEqual(retried.id, failed.id);
    assert.equal(retried.retryOf, "job_failed000000000");
    assert.equal(retried.objective, failed.objective);
    assert.deepEqual(retried.constraints, ["Keep it small"]);

    // The mock worker finishes on its own; wait for it so the temp dir can go.
    for (let attempt = 0; attempt < 200 && manager.isRunning(retried.id); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const persisted = await store.readJob(retried.id);
    assert.equal(persisted?.retryOf, "job_failed000000000");

    // The task that was delegated to the failed job now points at the retry.
    const { readTaskLink } = await import("../../agentos/task-jobs");
    assert.equal((await readTaskLink("pantry-pilot", "PP-002"))?.jobId, retried.id);
    // The mock run emitted events, so the heartbeat reached the record.
    assert.ok(persisted?.lastEventAt, "a run that emitted events must record when it was last heard from");
  });

  it("refuses to retry a job that is still live", async () => {
    await store.saveJob(job({ id: "job_live00000000000", status: "running" }));

    const { job: retried, error } = await manager.retryJob("job_live00000000000");

    assert.equal(retried, undefined);
    assert.match(error ?? "", /finished job/);
  });
});

describe("context file resolution", () => {
  let vault: string;
  let repo: string;
  let previousRoot: string | undefined;
  let resolveContextFiles: typeof import("../context-builder").resolveContextFiles;

  before(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-vault-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-repo-"));
    previousRoot = process.env.AGENTOS_ROOT;
    process.env.AGENTOS_ROOT = vault;

    await fs.mkdir(path.join(vault, "projects", "pantry-pilot"), { recursive: true });
    await fs.writeFile(path.join(vault, "projects", "pantry-pilot", "PROJECT.md"), "# P\n");
    await fs.writeFile(path.join(vault, "projects", "pantry-pilot", "STATUS.md"), "# S\n");
    await fs.writeFile(path.join(repo, "README.md"), "# R\n");

    ({ resolveContextFiles } = await import("../context-builder"));
  });

  after(async () => {
    if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
    else process.env.AGENTOS_ROOT = previousRoot;
    await fs.rm(vault, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("points vault documents at the vault, keeps real paths, drops the rest", async () => {
    const resolved = await resolveContextFiles(
      [
        `${repo}/PROJECT.md`,
        `${repo}/STATUS.md`,
        `${repo}/DECISIONS.md`,
        "README.md",
        repo,
        `${repo}/does-not-exist.ts`,
      ],
      { slug: "pantry-pilot", repoPath: repo },
    );

    assert.deepEqual(resolved, [
      path.join(vault, "projects", "pantry-pilot", "PROJECT.md"),
      path.join(vault, "projects", "pantry-pilot", "STATUS.md"),
      path.join(repo, "README.md"),
      repo,
    ]);
  });
});
