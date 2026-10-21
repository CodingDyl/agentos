import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-reengineer-root-"));
const ui = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-reengineer-ui-"));
process.env.AGENTOS_ROOT = root;
process.env.AGENTOS_UI_DIR = ui;

const { listLibrary } = await import("../library");
const { ingestFinishedRuns, listRunViews, runView } = await import("../runs");
const { saveJob } = await import("../../workers/job-store");

const RUN = "rev_0123456789abcdef";
const JOB = "job_reengineer00001";

function finishedRun(status: WorkerJob["status"] = "awaiting_review") {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-reengineer-checkout-"));
  const out = path.join(checkout, "reengineer", RUN);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "teardown.md"), "Verdict: tidy.\n");
  fs.writeFileSync(
    path.join(out, "library.json"),
    JSON.stringify({
      entries: [
        { title: "Sticky header", kind: "component", summary: "Shrinks on scroll.", whyItWorks: "CTA stays reachable." },
        { title: "Dolly hero", kind: "motion", summary: "Scroll scrubs a shot.", whyItWorks: "No cuts." },
      ],
    }),
  );
  const runs = path.join(ui, "reengineer-runs");
  fs.mkdirSync(runs, { recursive: true });
  const run = { id: RUN, target: "https://a.test", kind: "website", focus: [], jobId: JOB, createdAt: new Date().toISOString(), entryIds: [] };
  fs.writeFileSync(path.join(runs, `${RUN}.json`), JSON.stringify(run));
  return {
    run,
    runFile: path.join(runs, `${RUN}.json`),
    job: {
      id: JOB, worker: "claude-code", requestedWorker: "claude-code", resolvedWorker: "claude-code", project: "reengineer",
      objective: "x", status, revision: 1, createdAt: "2026-09-14T17:50:35.332Z", worktreePath: checkout,
    } as WorkerJob,
  };
}

describe("filing a finished teardown", () => {
  it("files once however many readers and sweeps arrive together, and not at all while the job runs", async () => {
    const { job } = finishedRun("running");
    await saveJob(job);
    assert.equal(await ingestFinishedRuns(), 0);
    assert.equal((await listLibrary()).length, 0);

    await saveJob({ ...job, status: "awaiting_review" });
    await Promise.all([runView(RUN), runView(RUN), listRunViews(), ingestFinishedRuns(), runView(RUN)]);

    assert.deepEqual((await listLibrary()).map((entry) => entry.id).sort(), ["dolly-hero", "sticky-header"]);
    const view = await runView(RUN);
    assert.equal(view?.status, "completed");
    assert.equal(view?.entryIds.length, 2);
  });

  it("does not file twice when a run is re-filed after the entries landed but the run did not save", async () => {
    const { runFile, run } = finishedRun();
    fs.writeFileSync(runFile, JSON.stringify({ ...run, ingestedAt: undefined, entryIds: [] }));
    assert.equal(await ingestFinishedRuns(), 1);
    assert.equal((await listLibrary()).length, 2);
    assert.equal((await runView(RUN))?.entryIds.length, 2);
  });

  it("is quiet once everything is filed", async () => {
    assert.equal(await ingestFinishedRuns(), 0);
  });
});
