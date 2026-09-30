import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import type { WorkerRoutingDecision } from "../../../shared/worker-routing-types";
import type { WorkerEvent } from "../../../shared/worker-types";

/**
 * The job manager is the one place that decides the shape of a delegated task.
 * These prove the properties that make delegation safe: an unavailable worker
 * never starts, coding work is isolated from the live checkout, events arrive
 * in the order they happened, and every job reaches a terminal state.
 *
 * Run against temporary directories and a throwaway repository — never the
 * operator's own.
 */

const run = promisify(execFile);

describe("running jobs", () => {
  let directory: string;
  let repo: string;
  let previous: string | undefined;
  let manager: typeof import("../job-manager");
  let store: typeof import("../job-store");
  let registry: typeof import("../registry");

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-workers-"));
    previous = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = directory;

    repo = path.join(directory, "repo");
    await fs.mkdir(repo, { recursive: true });
    await run("git", ["init", "-q", "."], { cwd: repo });
    await fs.writeFile(path.join(repo, "README.md"), "# Test\n", "utf8");
    await run("git", ["add", "-A"], { cwd: repo });
    await run(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qm", "init"],
      { cwd: repo },
    );

    manager = await import("../job-manager");
    store = await import("../job-store");
    registry = await import("../registry");
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;

    await fs.rm(directory, { recursive: true, force: true });
  });

  /** Waits for a job to leave the running set. */
  async function settle(jobId: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (!manager.isRunning(jobId)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Job ${jobId} never finished`);
  }

  describe("what is refused before anything starts", () => {
    it("answers automatic selection with a worker and the reasoning for it", async () => {
      const { id, routing, error } = await manager.resolveWorkerId("auto", {
        objective: "Implement the design library filters",
        project: "agentos",
      });

      assert.equal(error, undefined);
      assert.ok(id, "auto must resolve to a worker");

      // The decision travels with the id. A routed job that kept only the
      // worker would be indistinguishable afterwards from one a person picked.
      assert.ok(routing, "a routed job must carry its decision");
      assert.equal(routing?.selectedWorker, id);
      assert.ok(routing?.reasons.length);

      // Hermes is not configured in tests, so this is the deterministic
      // fallback — which must say that it is one rather than pass itself off
      // as a considered recommendation.
      assert.equal(routing?.decidedBy, "agentos");
    });

    it("runs the decision the operator was shown, not a fresh one", async () => {
      // The console shows the recommendation before anything starts. Routing
      // again here could start a different worker from the one agreed to.
      const shown: WorkerRoutingDecision = {
        selectedWorker: "mock",
        confidence: "high",
        reasons: ["Already decided"],
        decidedBy: "hermes",
        decidedAt: new Date().toISOString(),
      };

      const { id, routing } = await manager.resolveWorkerId(
        "auto",
        { objective: "Anything at all", project: "agentos" },
        shown,
      );

      assert.equal(id, "mock");
      assert.deepEqual(routing, shown);
    });

    it("refuses a worker that cannot actually run", async () => {
      // Claude reports itself unavailable without a key. Removing it here
      // rather than relying on the machine keeps the test about the gate:
      // health is checked before a job exists, whatever the operator's
      // environment happens to hold.
      const key = process.env.ANTHROPIC_API_KEY;
      const token = process.env.ANTHROPIC_AUTH_TOKEN;

      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;

      try {
        const { job, error } = await manager.startJob({
          worker: "claude",
          project: "agentos",
          objective: "Do the thing",
        });

        assert.equal(job, undefined);
        assert.match(error ?? "", /ANTHROPIC_API_KEY/);
      } finally {
        if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
        if (token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = token;
      }
    });

    it("leaves no job record behind when a worker is refused", async () => {
      assert.deepEqual(await store.listJobs(), []);
    });
  });

  describe("a job that runs", () => {
    let jobId: string;
    let events: WorkerEvent[];

    it("parks a verified job for review rather than completing it itself", async () => {
      events = [];

      const { job, error } = await manager.startJob({
        worker: "mock",
        project: "agentos",
        objective: "Prove the pipeline",
        repoPath: repo,
        // A real command with a real exit code — the point is that AgentOS
        // runs it, not that it is interesting.
        validationCommands: ["exit 0"],
      });

      assert.ok(job, error ?? "the job should have started");
      jobId = job.id;

      manager.subscribe(jobId, (event) => events.push(event));
      await settle(jobId);

      const finished = await store.readJob(jobId);

      // Work that passed validation still waits for a person. Nothing in the
      // pipeline may declare a job complete on its own.
      assert.equal(finished?.status, "awaiting_review");
      assert.ok(manager.isTerminal(finished!.status));
    });

    it("isolates the work in its own worktree, never the live checkout", async () => {
      const finished = await store.readJob(jobId);

      assert.ok(finished?.worktreePath, "expected a worktree");
      assert.ok(!finished.worktreePath.startsWith(repo + path.sep));
      assert.ok(
        (await fs.stat(finished.worktreePath!)).isDirectory(),
        "worktree should exist on disk",
      );
    });

    it("branches rather than checking out over the operator's branch", async () => {
      const { stdout } = await run("git", ["branch", "--show-current"], {
        cwd: repo,
      });

      assert.notEqual(stdout.trim(), `agentos-worker/${jobId}`);
    });

    it("delivers events in the order they happened", () => {
      const types = events.map((event) => event.type);

      // A log that reordered these would tell a different story from the one
      // the worker actually acted out.
      assert.ok(
        types.indexOf("validation.started") < types.indexOf("validation.completed"),
        types.join(", "),
      );
      assert.equal(types.at(0), "job.started");
      assert.equal(types.at(-1), "job.completed");
    });

    it("persists the same events it streamed", async () => {
      const stored = await store.readEvents(jobId);

      assert.deepEqual(
        stored.map((event) => event.type),
        events.map((event) => event.type),
      );
    });

    it("reads what changed from git rather than taking the worker's word", async () => {
      const finished = await store.readJob(jobId);

      // Mock writes nothing, and git agrees.
      assert.deepEqual(finished?.result?.changedFiles, []);
    });

    it("records its own validation run, not the worker's account of one", async () => {
      const finished = await store.readJob(jobId);
      const tests = finished?.result?.tests ?? [];

      assert.equal(tests.length, 1);
      assert.equal(tests[0]?.command, "exit 0");
      assert.equal(tests[0]?.success, true);

      // Mock rehearses validation and says so. Those rehearsed claims must not
      // survive into the record as if they were results.
      assert.ok(
        !tests.some((test) => /nothing was executed/.test(test.detail ?? "")),
        "worker-claimed tests should not be recorded as tests",
      );
    });

    it("fails a job whose validation fails, whatever the worker reported", async () => {
      const { job } = await manager.startJob({
        worker: "mock",
        project: "agentos",
        objective: "Work that does not build",
        repoPath: repo,
        validationCommands: ["exit 0", "exit 1"],
      });

      assert.ok(job);
      await settle(job.id);

      const finished = await store.readJob(job.id);

      // Mock always reports success. The exit code is what decides.
      assert.equal(finished?.status, "failed");
      assert.match(finished?.error ?? "", /Validation failed: exit 1/);

      // Every command is run, so the operator sees the whole picture rather
      // than only the first thing that broke.
      assert.deepEqual(
        finished?.result?.tests?.map((test) => test.success),
        [true, false],
      );
    });

    it("does not fail a job for a validation it had nowhere to run", async () => {
      const { job } = await manager.startJob({
        worker: "mock",
        project: "agentos",
        objective: "Research with no repository",
        // Commands, but no repoPath — so there is no worktree to run them in.
        validationCommands: ["exit 0"],
      });

      assert.ok(job);
      await settle(job.id);

      const finished = await store.readJob(job.id);

      // Unverified is not the same as broken, and must not be reported as a
      // validation failure with nothing named in it.
      assert.equal(finished?.status, "awaiting_review");
      assert.equal(finished?.error, undefined);
      assert.ok(
        finished?.result?.blockers?.some((blocker) =>
          /no worktree to validate in/.test(blocker),
        ),
        JSON.stringify(finished?.result?.blockers),
      );
    });

    it("says plainly when a job was never verified at all", async () => {
      const { job } = await manager.startJob({
        worker: "mock",
        project: "agentos",
        objective: "Work with nothing to check it",
        repoPath: repo,
      });

      assert.ok(job);
      await settle(job.id);

      const finished = await store.readJob(job.id);

      assert.equal(finished?.status, "awaiting_review");
      assert.ok(
        finished?.result?.blockers?.some((blocker) =>
          /nothing was verified/.test(blocker),
        ),
        "an unverified job should say so",
      );
    });
  });

  describe("cancelling", () => {
    it("stops a running job and records it as cancelled", async () => {
      const { job } = await manager.startJob({
        worker: "mock",
        project: "agentos",
        objective: "A job to interrupt",
      });

      assert.ok(job);
      const result = await manager.cancelJob(job.id);
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.stopped, true);

      await settle(job.id);

      const finished = await store.readJob(job.id);
      assert.equal(finished?.status, "cancelled");
      // A cancellation is a decision, not a failure, so it carries no error.
      assert.equal(finished?.error, undefined);
    });

    it("reports a job that does not exist", async () => {
      const result = await manager.cancelJob("job_doesnotexist00");
      assert.equal(result.ok, false);
    });

    it("cancels a job whose worker has finished but nobody has decided on", async () => {
      const { job } = await manager.startJob({
        worker: "mock",
        project: "agentos",
        objective: "Finished work nobody wants any more",
        repoPath: repo,
      });

      assert.ok(job);
      await settle(job.id);
      assert.equal((await store.readJob(job.id))?.status, "awaiting_review");

      const result = await manager.cancelJob(job.id);
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.stopped, false);

      const cancelled = await store.readJob(job.id);
      assert.equal(cancelled?.status, "cancelled");
      assert.ok(cancelled?.completedAt);
      // Cancelling ends the job, not the evidence.
      if (cancelled?.worktreePath) await fs.access(cancelled.worktreePath);

      const again = await manager.cancelJob(job.id);
      assert.equal(again.ok, false);
      assert.match(again.ok ? "" : again.error, /already cancelled/);
    });

    it("refuses to cancel a job that is being applied to the repository", async () => {
      const { job } = await manager.startJob({
        worker: "mock",
        project: "agentos",
        objective: "Mid-integration",
        repoPath: repo,
      });

      assert.ok(job);
      await settle(job.id);
      const settled = await store.readJob(job.id);
      assert.ok(settled);
      await store.saveJob({ ...settled, status: "integrating" });

      const result = await manager.cancelJob(job.id);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, /applied to the repository/);
    });
  });

  describe("steering", () => {
    it("refuses to steer a job that is not running", async () => {
      const result = await manager.steerJob("job_doesnotexist00", "try harder");

      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /not running/);
    });
  });

  describe("what the registry offers", () => {
    it("lists every worker, built or not", async () => {
      const workers = await registry.describeWorkers();

      assert.deepEqual(
        workers.map((worker) => worker.id).sort(),
        ["claude", "claude-code", "codex", "gemini", "grok", "grok-bot", "hermes-worker", "mock", "ollama"],
      );
    });

    it("says which are usable, and why the others are not", async () => {
      const workers = await registry.describeWorkers();
      const mock = workers.find((worker) => worker.id === "mock");
      const claude = workers.find((worker) => worker.id === "claude");
      const grok = workers.find((worker) => worker.id === "grok");

      assert.equal(mock?.available, true);

      // Grok and Claude are both integrated, so whether either is usable
      // depends on the machine rather than on the build. Either answer is
      // correct; a missing answer is not.
      for (const worker of [grok, claude]) {
        assert.equal(typeof worker?.available, "boolean");

        if (!worker?.available) {
          assert.ok(
            (worker?.unavailableReason ?? "").length > 0,
            "an unusable worker must say why",
          );
        }
      }
    });

    it("refuses to run a coding worker with nowhere isolated to run it", async () => {
      // Isolation is the basis for running any of this unattended. A worker
      // asked to work without a worktree would be editing the operator's live
      // checkout, so both real workers refuse loudly rather than proceed.
      for (const id of ["grok", "claude"] as const) {
        await assert.rejects(
          async () =>
            registry.getWorker(id)?.start({ id } as never, {
              contextPacket: "",
              emit: () => undefined,
              signal: new AbortController().signal,
            }),
          /worktree/,
          `${id} must refuse to run without a worktree`,
        );
      }
    });
  });
});
