import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-motion-pass-"));
process.env.AGENTOS_UI_DIR = root;
process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/agentos-test-drive-not-present/clients";

const rebuild = await import("../../website-rebuild/store");
const motionStore = await import("../store");
const { motionPassBlocker, launchMotionDesign } = await import("../launch");
const { assembleMotionPrompt, MotionBriefSchema, MotionLaunchInputSchema } = await import("../../../shared/motion-design-types");

let caseNumber = 0;
beforeEach(() => {
  rebuild.closeRebuildDatabase();
  caseNumber += 1;
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `case-${caseNumber}-`));
});
after(() => {
  rebuild.closeRebuildDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

function rebuildFor(slug: string, finished: boolean) {
  const { run } = rebuild.createOrReuseRun({ prospectId: `p-${slug}`, company: "Harris Marcus", websiteUrl: "", targetMarket: "Clients", location: "Sandton", conversionGoal: "Enquire", requiredFunctions: [], designTemplate: "DESIGN.md", skillVersion: "1.6.0" });
  rebuild.setRunField(run.id, "workspace_slug", slug);
  rebuild.rebuildDatabase().prepare(`UPDATE stages SET status = 'complete', revision = 1, approved_revision = 1 WHERE run_id = ?${finished ? "" : " AND stage != 'preview'"}`).run(run.id);
  return run;
}

const brief = MotionBriefSchema.parse({ brandName: "Harris Marcus Mahlangu Attorneys" });

describe("a motion pass over a rebuilt site", () => {
  it("waits for a finished rebuild, and allows one motion run per workspace", async () => {
    assert.match((await motionPassBlocker("hmm")) ?? "", /no website rebuild/);
    rebuildFor("hmm", false);
    assert.match((await motionPassBlocker("hmm")) ?? "", /Finish the website rebuild first/);
    rebuild.closeRebuildDatabase();
    process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, `case-${caseNumber}-b-`));
    rebuildFor("hmm", true);
    assert.equal(await motionPassBlocker("hmm"), undefined);
    const now = new Date().toISOString();
    await motionStore.saveRun({ id: motionStore.createMotionRunId(), workspaceSlug: "hmm", status: "running", step: "approval", brief, references: [], budgetPlan: "standard", codeOnly: true, model: "x", effort: "high", concepts: [], notes: [], createdAt: now, updatedAt: now });
    assert.match((await motionPassBlocker("hmm")) ?? "", /already has a Motion Design run/);
  });

  it("refuses to launch before the rebuild is done, without touching any repo", async () => {
    rebuildFor("hmm", false);
    await assert.rejects(launchMotionDesign({ brief, references: [], workspaceSlug: "hmm", enhanceExisting: true }), /Finish the website rebuild first/);
  });

  it("tells the worker to add motion to the approved site and leave the features alone", () => {
    const prompt = assembleMotionPrompt({ brief, references: [], codeOnly: true, interviewAnswered: true, enhanceExisting: true });
    assert.match(prompt, /approved website \(Next\.js\)/);
    assert.match(prompt, /Do not rebuild it/);
    assert.match(prompt, /prefers-reduced-motion/);
    assert.match(prompt, /Do not deploy/);
    assert.doesNotMatch(assembleMotionPrompt({ brief, references: [], codeOnly: true, interviewAnswered: true }), /The existing site/);
  });

  it("defaults to a new motion site", () => {
    assert.equal(MotionLaunchInputSchema.parse({ brief, references: [] }).enhanceExisting, false);
  });
});
