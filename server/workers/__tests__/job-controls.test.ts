import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

/**
 * Operator controls: retry from any state, cancel a review job, unstick a
 * task, and rerun with current settings rather than a frozen snapshot.
 */

describe("worker job controls", () => {
  let directory: string;
  let previous: string | undefined;
  let previousRoot: string | undefined;
  let manager: typeof import("../job-manager");
  let store: typeof import("../job-store");
  let taskJobs: typeof import("../../agentos/task-jobs");

  function job(overrides: Partial<WorkerJob>): WorkerJob {
    return {
      id: overrides.id ?? store.createJobId(),
      worker: "mock",
      requestedWorker: "mock",
      resolvedWorker: "mock",
      project: "pantry-pilot",
      objective: "Prove something",
      status: "failed",
      revision: 1,
      createdAt: "2026-09-14T17:50:35.332Z",
      startedAt: "2026-09-14T17:50:35.333Z",
      ...overrides,
    } as WorkerJob;
  }

  async function settle(id: string) {
    for (let attempt = 0; attempt < 200 && manager.isRunning(id); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-job-controls-"));
    previous = process.env.AGENTOS_UI_DIR;
    previousRoot = process.env.AGENTOS_ROOT;
    process.env.AGENTOS_UI_DIR = directory;
    process.env.AGENTOS_ROOT = directory;
    await fs.mkdir(path.join(directory, "projects", "pantry-pilot"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "projects", "pantry-pilot", "PROJECT.md"),
      "# Pantry\n\n## Connected Systems\n- Local repository: /tmp/pantry-now\n",
    );

    manager = await import("../job-manager");
    store = await import("../job-store");
    taskJobs = await import("../../agentos/task-jobs");
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;
    if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
    else process.env.AGENTOS_ROOT = previousRoot;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("retries a stuck running job by cancelling it first", async () => {
    await store.saveJob(job({ id: "job_stuckrun0000000", status: "running" }));

    const { job: retried, error } = await manager.retryJob("job_stuckrun0000000");

    assert.equal(error, undefined);
    assert.ok(retried);
    assert.equal(retried.retryOf, "job_stuckrun0000000");
    assert.equal((await store.readJob("job_stuckrun0000000"))?.status, "cancelled");
    await settle(retried.id);
  });

  it("retries a rejected job", async () => {
    await store.saveJob(job({ id: "job_rejected0000000", status: "rejected", completedAt: "2026-09-14T18:00:00.000Z" }));

    const { job: retried, error } = await manager.retryJob("job_rejected0000000");

    assert.equal(error, undefined);
    assert.ok(retried);
    assert.equal(retried.retryOf, "job_rejected0000000");
    await settle(retried.id);
  });

  it("retries a job another page started, instead of sending the operator there", async () => {
    await store.saveJob(
      job({
        id: "job_origin000000000",
        status: "failed",
        origin: { label: "Claude Motion", href: "/designs/animate/abc" },
      }),
    );

    const { job: retried, error } = await manager.retryJob("job_origin000000000");

    assert.equal(error, undefined);
    assert.ok(retried);
    assert.equal(retried.retryOf, "job_origin000000000");
    await settle(retried.id);
  });

  it("cancels a job that is in review and frees its task", async () => {
    const reviewing = job({ id: "job_reviewing00000", status: "reviewing" });
    await store.saveJob(reviewing);
    await taskJobs.saveTaskLink({
      project: "pantry-pilot",
      taskId: "PP-010",
      jobId: reviewing.id,
      delegatedAt: reviewing.createdAt,
    });

    const result = await manager.cancelJob(reviewing.id);
    assert.equal(result.ok, true);
    assert.equal((await store.readJob(reviewing.id))?.status, "cancelled");
    assert.equal((await store.readJob(reviewing.id))?.worktreePath, reviewing.worktreePath);

    const { activeJobFor } = await import("../../agentos/task-delegation");
    assert.equal(await activeJobFor("pantry-pilot", "PP-010"), undefined);
  });

  it("retries with the current repository and model table, not a frozen override", async () => {
    await store.saveJob(
      job({
        id: "job_frozen000000000",
        status: "failed",
        repoPath: "/tmp/pantry-old",
        sourceRepoPath: "/tmp/pantry-old",
        modelRouteType: "execute",
        modelOverride: "opus",
        effort: "max",
        agentId: "someone-retired",
        modelRoute: {
          taskType: "execute",
          model: "opus",
          effort: "max",
          source: "override",
          reason: "Pinned.",
        },
      }),
    );

    const { job: retried, error } = await manager.retryJob("job_frozen000000000");
    assert.equal(error, undefined);
    assert.ok(retried);
    assert.equal(retried.repoPath, "/tmp/pantry-now");
    assert.equal(retried.modelRouteType, "execute");
    assert.notEqual(retried.modelOverride, "opus");
    assert.notEqual(retried.effort, "max");
    assert.notEqual(retried.agentId, "someone-retired");
    await settle(retried.id);
  });

  it("honours an edited brief on retry", async () => {
    await store.saveJob(job({ id: "job_editbrief00000", status: "cancelled", desiredOutcome: "Old", scope: "Old scope" }));

    const { job: retried, error } = await manager.retryJob("job_editbrief00000", {
      objective: "New objective",
      desiredOutcome: "Ship the form",
      scope: "Login only",
      acceptanceCriteria: ["The form submits"],
      constraints: ["No new deps"],
      referenceLinks: ["https://example.com"],
      worker: "mock",
    });

    assert.equal(error, undefined);
    assert.ok(retried);
    assert.equal(retried.objective, "New objective");
    assert.equal(retried.desiredOutcome, "Ship the form");
    assert.equal(retried.scope, "Login only");
    assert.deepEqual(retried.acceptanceCriteria, ["The form submits"]);
    assert.ok(retried.constraints?.includes("No new deps"));
    assert.deepEqual(retried.referenceLinks, ["https://example.com"]);
    await settle(retried.id);
  });

  it("previews which current settings differ from the original job", async () => {
    await store.saveJob(
      job({
        id: "job_preview00000000",
        status: "failed",
        repoPath: "/tmp/pantry-old",
        sourceRepoPath: "/tmp/pantry-old",
        modelRouteType: "execute",
        modelOverride: "opus",
        effort: "max",
        agentId: "someone-retired",
      }),
    );

    const { preview, error } = await manager.rerunPreview("job_preview00000000");
    assert.equal(error, undefined);
    assert.ok(preview);
    const repo = preview.settings.find((row) => row.key === "repoPath");
    assert.equal(repo?.original, "/tmp/pantry-old");
    assert.equal(repo?.current, "/tmp/pantry-now");
    assert.equal(repo?.changed, true);
    const model = preview.settings.find((row) => row.key === "model");
    assert.equal(model?.original, "opus");
    assert.equal(model?.changed, true);
  });

  it("unsticks a task whose job record is gone", async () => {
    await taskJobs.saveTaskLink({
      project: "pantry-pilot",
      taskId: "PP-011",
      jobId: "job_missing00000000",
      delegatedAt: "2026-09-14T17:50:35.332Z",
    });

    const result = await manager.unstickTask("pantry-pilot", "PP-011");
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.released, true);
    assert.equal(await taskJobs.readTaskLink("pantry-pilot", "PP-011"), undefined);
  });

  it("unsticks a task linked to a dead holding job", async () => {
    const stuck = job({ id: "job_deadhold000000", status: "awaiting_review" });
    await store.saveJob(stuck);
    await taskJobs.saveTaskLink({
      project: "pantry-pilot",
      taskId: "PP-012",
      jobId: stuck.id,
      delegatedAt: stuck.createdAt,
    });

    const result = await manager.unstickTask("pantry-pilot", "PP-012");
    assert.equal(result.ok, true);
    assert.equal((await store.readJob(stuck.id))?.status, "cancelled");
  });
});
