import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-motion-publish-"));
process.env.AGENTOS_UI_DIR = root;
process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/agentos-test-drive-not-present/clients";

const store = await import("../store");
const { publishMotionPass } = await import("../motion-publish");
const { previewCommit } = await import("../stages");
const { MotionBriefSchema } = await import("../../../shared/motion-design-types");
type MotionRun = import("../../../shared/motion-design-types").MotionRun;
type WorkerJob = import("../../../shared/worker-types").WorkerJob;
type Deps = import("../motion-publish").MotionPublishDeps;

let caseNumber = 0;
beforeEach(() => {
  store.closeRebuildDatabase();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `case-${caseNumber}-`));
});
after(() => {
  store.closeRebuildDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

const REPO = "/clients/harris-marcus";
const APPROVED = "a".repeat(40);
const MOTION = "b".repeat(40);

/** A finished rebuild whose functions revision 1 (commit APPROVED) is approved and whose preview is live. */
function finishedRebuild() {
  const { run } = store.createOrReuseRun({ prospectId: `p-${caseNumber}`, company: "Harris Marcus", websiteUrl: "", targetMarket: "Clients", location: "Sandton", conversionGoal: "Enquire", requiredFunctions: ["contact_form"], designTemplate: "DESIGN.md", skillVersion: "1.6.0" });
  store.setRunField(run.id, "workspace_slug", "harris-marcus");
  store.setRunField(run.id, "repo_path", REPO);
  const db = store.rebuildDatabase();
  db.prepare("UPDATE stages SET status = 'complete', revision = 1, approved_revision = 1 WHERE run_id = ?").run(run.id);
  db.prepare("INSERT INTO revisions (run_id, stage, revision, summary, artifact_ids, created_at, ref) VALUES (?, 'functions', 1, 'features', '[]', ?, ?)").run(run.id, new Date().toISOString(), APPROVED);
  return run;
}

const motionRun = (over: Partial<MotionRun> = {}): MotionRun => ({
  id: "mdn_0123456789abcdef", workspaceSlug: "harris-marcus", status: "building", step: "progress", brief: MotionBriefSchema.parse({}), references: [], budgetPlan: "standard", codeOnly: false, model: "x", effort: "high", concepts: [], notes: [], createdAt: "", updatedAt: "",
  siteRepoPath: REPO, enhanceExisting: true, buildJobId: "job_1", ...over,
});
const job = (over: Partial<WorkerJob> = {}): WorkerJob => ({ id: "job_1", worker: "claude-code", project: "harris-marcus", objective: "motion", status: "awaiting_review", createdAt: "", worktreePath: "/tmp/wt", workerBranch: "agentos/job_1", result: { tests: [{ command: "npm run build", success: true }] }, ...over }) as WorkerJob;

function deps(over: Partial<Deps> = {}): Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    motionRunFor: async () => motionRun(),
    latestJob: async () => job(),
    integrate: async (_job, repo, _message, tag) => {
      calls.push(`integrate ${repo} ${tag}`);
      return MOTION;
    },
    isAncestor: async () => true,
    advance: (id) => void calls.push(`advance ${id}`),
    ...over,
  };
}

describe("publishing a motion pass", () => {
  it("integrates the motion job, points the preview at it, and publishes again", async () => {
    const run = finishedRebuild();
    const d = deps();
    const after = await publishMotionPass(run.id, d);
    assert.deepEqual(d.calls, [`integrate ${REPO} rebuild/motion-job_1`, `advance ${run.id}`]);
    assert.equal(after.motionRef, MOTION);
    assert.equal(after.motionBase, APPROVED);
    assert.equal(after.stages.find((stage) => stage.id === "preview")?.status, "not_started");
    assert.equal(previewCommit(after), MOTION);
  });

  it("drops a stale motion pass once a newer revision is approved", () => {
    const run = finishedRebuild();
    store.setRunField(run.id, "motion_ref", MOTION);
    store.setRunField(run.id, "motion_base", "c".repeat(40));
    assert.equal(previewCommit(store.readRun(run.id)), APPROVED);
  });

  it("refuses work that is not finished, failed its build, or is not built on the approved site", async () => {
    const run = finishedRebuild();
    await assert.rejects(publishMotionPass(run.id, deps({ latestJob: async () => job({ status: "running" }) })), /is running/);
    await assert.rejects(publishMotionPass(run.id, deps({ latestJob: async () => job({ result: { tests: [{ command: "npm run build", success: false }] } } as Partial<WorkerJob>) })), /did not pass npm run build/);
    await assert.rejects(publishMotionPass(run.id, deps({ isAncestor: async () => false })), /not built on the approved site/);
    assert.equal(store.readRun(run.id).motionRef, undefined);
  });

  it("refuses a new motion site, another repository, or a rebuild without a preview yet", async () => {
    const run = finishedRebuild();
    await assert.rejects(publishMotionPass(run.id, deps({ motionRunFor: async () => motionRun({ enhanceExisting: undefined }) })), /no motion pass/);
    await assert.rejects(publishMotionPass(run.id, deps({ motionRunFor: async () => motionRun({ siteRepoPath: "/elsewhere" }) })), /another repository/);
    store.rebuildDatabase().prepare("UPDATE stages SET status = 'in_progress' WHERE run_id = ? AND stage = 'preview'").run(run.id);
    await assert.rejects(publishMotionPass(run.id, deps()), /Publish the rebuild's preview first/);
  });
});
