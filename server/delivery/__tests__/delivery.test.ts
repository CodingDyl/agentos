import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-delivery-"));
process.env.AGENTOS_UI_DIR = root;
process.env.AGENTOS_CLIENT_SITES_DIR = "/Volumes/agentos-test-drive-not-present/clients";

const store = await import("../../website-rebuild/store");
const { deliveryOverview, deliveryWorkspaces } = await import("../overview");
const { startDelivery } = await import("../start");
const { DeliveryStartSchema, workspaceProspectId } = await import("../../../shared/delivery-types");
type ProjectSummary = import("../../../shared/agentos-types").ProjectSummary;

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

const project = (slug: string, name: string): ProjectSummary => ({ slug, name, state: "active", priority: "medium", workspaceType: "client" });
const projects = [project("harris-marcus", "Harris Marcus"), project("bosch", "Bosch"), project("acme", "Acme")];

const brief = { targetMarket: "Homeowners", location: "Cape Town", conversionGoal: "Book a call-out", websiteUrl: "https://acme.example", requiredFunctions: ["contact_form" as const] };

function deps(advanced: string[] = []) {
  return { projects: async () => projects, skillEnabled: async () => true, skillVersion: async () => "1.5.0", advance: (id: string) => void advanced.push(id) };
}

/** A run linked to a workspace, with its stages set as given. */
function runFor(slug: string, statuses: Partial<Record<string, string>>) {
  const { run } = store.createOrReuseRun({ prospectId: `p-${slug}`, company: slug, ...brief, designTemplate: "DESIGN.md", skillVersion: "1.5.0" });
  store.setRunField(run.id, "workspace_slug", slug);
  for (const [stage, status] of Object.entries(statuses)) {
    store.rebuildDatabase().prepare("UPDATE stages SET status = ?, revision = 1, approved_revision = 1, blocker = ? WHERE run_id = ? AND stage = ?").run(status ?? "", status === "blocked" ? "Hermes is offline." : null, run.id, stage);
  }
  return run;
}

describe("the delivery overview", () => {
  it("lists every workspace, with its run's state, waiting work first", () => {
    runFor("harris-marcus", { workspace: "complete", capture: "complete", research: "complete", hero: "complete", build: "complete", functions: "awaiting_approval" });
    runFor("bosch", { workspace: "complete", capture: "in_progress" });
    const rows = deliveryWorkspaces(projects, store.listRuns());
    assert.deepEqual(rows.map((row) => [row.slug, row.state]), [["harris-marcus", "needs_you"], ["bosch", "running"], ["acme", "not_started"]]);
    assert.equal(rows[0].stage, "functions");
    assert.equal(rows[0].done, 5);
    assert.equal(rows[2].runId, undefined);
  });

  it("queues reviews and blocked stages across workspaces, with the reviewer's verdict", () => {
    const waiting = runFor("harris-marcus", { workspace: "complete", capture: "complete", research: "complete", hero: "complete", build: "complete" });
    store.rebuildDatabase().prepare("UPDATE stages SET status = 'not_started' WHERE run_id = ? AND stage = 'functions'").run(waiting.id);
    assert.equal(store.claimStage(waiting.id, "functions", "w"), true);
    store.completeStage(waiting.id, "functions", "w", "Codex worked on 3 features: 3 blocked.", [], { review: { ready: false, blockers: 1, majors: 4, minors: 2 } });
    runFor("bosch", { workspace: "complete", capture: "complete", research: "blocked" });
    runFor("acme", { workspace: "complete", capture: "in_progress" });

    const { decisions } = deliveryOverview(projects, store.listRuns(), store.readRun);
    assert.equal(decisions.length, 2);
    const review = decisions.find((entry) => entry.kind === "review");
    assert.equal(review?.stage, "functions");
    assert.deepEqual(review?.review, { ready: false, blockers: 1, majors: 4, minors: 2 });
    assert.match(review?.detail ?? "", /3 blocked/);
    const blocked = decisions.find((entry) => entry.kind === "blocked");
    assert.equal(blocked?.workspaceSlug, "bosch");
    assert.match(blocked?.detail ?? "", /Hermes is offline/);
  });
});

describe("starting a delivery", () => {
  it("starts a run linked to the workspace, named after it", async () => {
    const advanced: string[] = [];
    const { run, created } = await startDelivery({ workspaceSlug: "acme", ...brief }, deps(advanced));
    assert.equal(created, true);
    assert.equal(run.workspaceSlug, "acme");
    assert.equal(run.company, "Acme");
    assert.equal(run.prospectId, workspaceProspectId("acme"));
    assert.deepEqual(advanced, [run.id]);
  });

  it("resumes the run a workspace already has, however it was started, and never makes a second", async () => {
    const existing = runFor("harris-marcus", { workspace: "complete" });
    const { run, created } = await startDelivery({ workspaceSlug: "harris-marcus", ...brief }, deps());
    assert.equal(created, false);
    assert.equal(run.id, existing.id);
    assert.equal(store.listRuns().filter((entry) => entry.workspaceSlug === "harris-marcus").length, 1);
  });

  it("refuses a workspace that does not exist, and a disabled skill", async () => {
    await assert.rejects(startDelivery({ workspaceSlug: "nope", ...brief }, deps()), /does not exist/);
    await assert.rejects(startDelivery({ workspaceSlug: "acme", ...brief }, { ...deps(), skillEnabled: async () => false }), /disabled/);
  });

  it("validates the request body", () => {
    assert.equal(DeliveryStartSchema.safeParse({ workspaceSlug: "acme", ...brief }).success, true);
    assert.equal(DeliveryStartSchema.safeParse({ workspaceSlug: "acme", ...brief, prospectId: "x" }).success, false);
    assert.equal(DeliveryStartSchema.safeParse({ workspaceSlug: "", ...brief }).success, false);
  });
});
