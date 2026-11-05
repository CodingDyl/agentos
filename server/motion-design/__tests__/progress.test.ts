import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-motion-progress-"));
process.env.AGENTOS_UI_DIR = root;

const { parseReviewLog, refreshRun } = await import("../progress");
const { saveJob } = await import("../../workers/job-store");
const { MotionBriefSchema } = await import("../../../shared/motion-design-types");
type MotionRun = import("../../../shared/motion-design-types").MotionRun;
type WorkerJob = import("../../../shared/worker-types").WorkerJob;

after(() => fs.rmSync(root, { recursive: true, force: true }));

const reviews = (markdown: string) => parseReviewLog(markdown).map((entry) => entry.review).sort();

describe("reading the motion review log", () => {
  it("reads the verdict lines real runs write", () => {
    const log = "## Round 1: build\n\n- **Brief: PASS.** Unchanged.\n- **Design rules: FAIL, then fixed.** Captions.\n- **Craft: FAIL, then fixed.** The film.\n";
    assert.deepEqual(reviews(log), ["brief", "craft", "design"]);
    assert.equal(parseReviewLog(log)[0]?.summary, "PASS. Unchanged.");
  });

  it("reads verdict tables and verdict headings", () => {
    assert.deepEqual(reviews("## Round 2\n\n| Brief | Pass with fixes | 0 |\n| Design rules | Pass | 3 |\n| Craft | pass | 1 |\n"), ["brief", "craft", "design"]);
    assert.deepEqual(reviews("## Round 1\n\n### Brief: pass, with gaps\n### Craft: not yet testable\n"), ["brief"]);
  });

  it("does not count concept-round notes as reviews of the build", () => {
    assert.deepEqual(reviews("## Round 0: concepts\n\n**Brief.** Keeps the brand.\n\n- **Craft: PASS.** Planned.\n\n### Brief: pass, with gaps\n"), []);
  });

  it("lets a review's latest verdict decide, and never counts an unfixed failure", () => {
    assert.deepEqual(reviews("## Round 1\n\n- **Craft: PASS.** Fine.\n\n## Round 2\n\n- **Craft: FAIL.** Could not open a browser.\n"), []);
    assert.deepEqual(reviews("## Round 1\n\n- **Craft: FAIL, not fixed.** Later.\n"), []);
    assert.deepEqual(reviews("## Round 1\n\n- **Craft: FAIL.** Bad.\n\n## Round 2\n\n- **Craft: PASS.** Good.\n"), ["craft"]);
  });

  it("reads the Harris log's first build round", () => {
    const logged = parseReviewLog("## Round 0: concepts (2026-11-03)\n\n**Brief.** Keeps it.\n\n## Round 1: build (2026-11-03, job_x)\n\nReused assets.\n\n- **Brief: PASS.** Same.\n");
    assert.deepEqual(logged.map((entry) => entry.review), ["brief"]);
  });
});

describe("a run whose job recovered", () => {
  const siteRepoPath = path.join(root, "site");
  fs.mkdirSync(siteRepoPath, { recursive: true });
  const FAILURE = "The work landed, but validation failed in the source repository.";

  const motionRun = (id: string, over: Partial<MotionRun> = {}): MotionRun => ({
    id: `mdn_${id}`, workspaceSlug: "harris", status: "failed", step: "progress", error: FAILURE, brief: MotionBriefSchema.parse({}), references: [], budgetPlan: "standard", codeOnly: true, model: "x", effort: "high", concepts: [], notes: [], createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z", siteRepoPath, buildJobId: `job_${id}`, ...over,
  });
  const saveJobFor = (id: string, over: Partial<WorkerJob>) =>
    saveJob({ id: `job_${id}`, worker: "claude-code", project: "harris", objective: "motion", createdAt: "2026-11-05T00:00:00.000Z", ...over } as WorkerJob);

  it("clears the failure once the job completes, even with reviews unticked", async () => {
    await saveJobFor("0000000000000001", { status: "completed", integratedCommit: "b".repeat(40) });
    const fresh = await refreshRun(motionRun("0000000000000001"));
    assert.equal(fresh.error, undefined);
    assert.equal(fresh.status, "completed");
  });

  it("keeps the failure while the job is still failed", async () => {
    await saveJobFor("0000000000000002", { status: "failed", error: FAILURE });
    const fresh = await refreshRun(motionRun("0000000000000002"));
    assert.equal(fresh.error, FAILURE);
    assert.equal(fresh.status, "failed");
  });

  it("does not call a run that was never approved complete", async () => {
    await saveJobFor("0000000000000003", { status: "completed" });
    const fresh = await refreshRun(motionRun("0000000000000003", { codeOnly: false }));
    assert.equal(fresh.error, undefined);
    assert.equal(fresh.status, "running");
  });
});
