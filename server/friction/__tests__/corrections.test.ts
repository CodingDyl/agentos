import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SetRegressionRequestSchema, type FrictionItem } from "../../../shared/friction-types";
import type { WorkerJob } from "../../../shared/worker-types";
import { captureJobCorrection, reconcileRegressions, recordJobCorrection } from "../corrections";
import { frictionFile, readFriction, reportFriction, setRegression, startRegressionTracking, updateFrictionStatus } from "../store";

const job = (overrides: Partial<WorkerJob> = {}): WorkerJob =>
  ({ id: "job_aaaaaaaaaaaaaaaa", worker: "mock", status: "awaiting_review", project: "agentos", objective: "Fix the widget\nwith detail", createdAt: "2026-11-01T10:00:00Z", revision: 1, ...overrides }) as WorkerJob;

describe("corrections", () => {
  let dir: string;
  let previous: string | undefined;

  beforeEach(async () => {
    previous = process.env.AGENTOS_UI_DIR;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "corrections-"));
    process.env.AGENTOS_UI_DIR = dir;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const report = (kind: "friction" | "correction" = "correction") =>
    reportFriction({ description: "The agent got the totals wrong", frequency: "once", severity: "medium", kind, expected: kind === "correction" ? "Totals should add up" : undefined });

  it("a legacy item with no kind loads as friction and can be marked fixed", async () => {
    await fs.writeFile(frictionFile(), JSON.stringify({ items: [{ id: "old", description: "Old report", frequency: "often", severity: "low", status: "open", createdAt: "2026-09-01T00:00:00.000Z" }] }));
    const [loaded] = await readFriction();
    assert.equal(loaded.kind, "friction");
    assert.equal((await updateFrictionStatus("old", "fixed"))?.status, "fixed");
  });

  it("a correction cannot be marked fixed while its regression is needed", async () => {
    const item = await report();
    assert.equal(item.regression?.status, "needed");
    await assert.rejects(updateFrictionStatus(item.id, "fixed"), /regression test/i);
    assert.equal((await readFriction())[0].status, "open");
  });

  it("a correction can be marked fixed once covered, or not-testable with a reason", async () => {
    const covered = await report();
    await setRegression(covered.id, { status: "covered", testPath: "server/x/__tests__/x.test.ts" });
    assert.equal((await updateFrictionStatus(covered.id, "fixed"))?.status, "fixed");

    const excused = await report();
    await setRegression(excused.id, { status: "not-testable", reason: "Copy wording only" });
    assert.equal((await updateFrictionStatus(excused.id, "fixed"))?.status, "fixed");
  });

  it("not-testable without a reason is refused", () => {
    assert.equal(SetRegressionRequestSchema.safeParse({ status: "not-testable" }).success, false);
    assert.equal(SetRegressionRequestSchema.safeParse({ status: "not-testable", reason: "  " }).success, false);
    assert.equal(SetRegressionRequestSchema.safeParse({ status: "not-testable", reason: "Visual only" }).success, true);
  });

  it("a testPath containing .. or an absolute path is refused", async () => {
    for (const testPath of ["../outside.test.ts", "a/../../b.test.ts", "/etc/passwd", "C:\\x\\y.test.ts"]) {
      assert.equal(SetRegressionRequestSchema.safeParse({ status: "covered", testPath }).success, false, testPath);
    }
    const item = await report();
    await assert.rejects(setRegression(item.id, { status: "covered", testPath: "../x.test.ts" }));
  });

  it("a correction needs to say what should have happened", async () => {
    await assert.rejects(reportFriction({ description: "The agent got it wrong", frequency: "once", severity: "low", kind: "correction" }));
  });

  it("one job and attempt records one correction, however many times the route is called", async () => {
    const first = await recordJobCorrection(job(), "job-rejected", "Wrong totals");
    const again = await recordJobCorrection(job(), "job-rejected", "Wrong totals");
    assert.equal(first?.id, again?.id);
    assert.equal((await readFriction()).length, 1);
    assert.equal(first?.kind, "correction");
    assert.equal(first?.regression?.status, "needed");
    assert.equal(first?.expected, "Wrong totals");
    assert.deepEqual(first?.source, { type: "job-rejected", jobId: "job_aaaaaaaaaaaaaaaa", attempt: 1, project: "agentos" });

    await recordJobCorrection(job({ revision: 2 }), "job-rejected");
    await recordJobCorrection(job(), "job-revision");
    assert.equal((await readFriction()).length, 3);
  });

  it("never throws when a correction cannot be saved, so the owner's decision stands", async () => {
    // A state folder that is really a file: every write fails.
    const blocker = path.join(dir, "not-a-folder");
    await fs.writeFile(blocker, "x");
    process.env.AGENTOS_UI_DIR = blocker;
    const originalError = console.error;
    console.error = () => undefined;
    try {
      await assert.doesNotReject(captureJobCorrection(job(), "job-rejected", "Wrong"));
    } finally {
      console.error = originalError;
    }
  });

  it("captures a correction through the safe wrapper, ignoring a note that is not text", async () => {
    await captureJobCorrection(job(), "visual-revision", { not: "text" });
    const [saved] = await readFriction();
    assert.equal(saved.source?.type, "visual-revision");
    assert.equal(saved.expected, undefined);
  });

  describe("reconcileRegressions", () => {
    const tracked = async (jobId = "job_bbbbbbbbbbbbbbbb") => {
      const item = await report();
      return startRegressionTracking(item.id, jobId);
    };
    const reader = (found: Partial<WorkerJob> | undefined) => async () => (found ? job(found) : undefined);
    const run = async (items: FrictionItem[], found: Partial<WorkerJob> | undefined) => (await reconcileRegressions(items, reader(found)))[0];

    it("a job with a test file in its changes marks the regression covered with that path", async () => {
      const item = (await tracked())!;
      const result = await run([item], { status: "completed", result: { summary: "done", changedFiles: ["server/x.ts", "server/x/__tests__/x.test.ts"] } });
      assert.equal(result.regression?.status, "covered");
      assert.equal(result.regression?.testPath, "server/x/__tests__/x.test.ts");
    });

    it("a completed job that changed no test returns the regression to needed and says why", async () => {
      const item = (await tracked())!;
      const result = await run([item], { status: "completed", result: { summary: "done", changedFiles: ["server/x.ts"] } });
      assert.equal(result.regression?.status, "needed");
      assert.match(result.regression?.reason ?? "", /no test/i);
    });

    it("a failed job returns the regression to needed", async () => {
      const item = (await tracked())!;
      for (const status of ["failed", "cancelled", "rejected"] as const) {
        const result = await run([item], { status });
        assert.equal(result.regression?.status, "needed", status);
        assert.ok(result.regression?.reason);
      }
    });

    it("leaves a job that is still running alone, and never touches friction or settled corrections", async () => {
      const item = (await tracked())!;
      assert.equal((await run([item], { status: "running" })).regression?.status, "in-progress");
      const plain = (await report("friction"))!;
      assert.deepEqual(await run([plain], { status: "failed" }), plain);
    });

    it("ignores an unsafe path in a job's changes", async () => {
      const item = (await tracked())!;
      const result = await run([item], { status: "completed", result: { summary: "done", changedFiles: ["../evil.test.ts"] } });
      assert.equal(result.regression?.status, "needed");
    });
  });
});
