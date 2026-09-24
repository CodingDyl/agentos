import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-seo-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeSeoDatabase, seoDatabase } = await import("../db");
const { markFindingFiled, readFinding, readProjectSeo, recordAuditRun } = await import("../store");

before(() => {
  seoDatabase();
});

after(() => {
  closeSeoDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("recordAuditRun / readProjectSeo", () => {
  it("has nothing to show before an audit ever runs", () => {
    assert.deepEqual(readProjectSeo("pantry-pilot"), { latest: undefined, history: [] });
  });

  it("records a completed run with its findings", () => {
    const run = recordAuditRun({
      projectSlug: "pantry-pilot",
      targetUrl: "https://pantrypilot.app",
      startedAt: "2026-09-24T08:00:00.000Z",
      finishedAt: "2026-09-24T08:00:05.000Z",
      status: "complete",
      findings: [
        { category: "on-page", severity: "warning", title: "Missing meta description", description: "...", pageUrl: "https://pantrypilot.app" },
      ],
    });

    assert.equal(run.status, "complete");
    assert.equal(run.findings.length, 1);
    assert.ok(run.findings[0].id);

    const data = readProjectSeo("pantry-pilot");
    assert.equal(data.latest?.id, run.id);
    assert.equal(data.latest?.findings.length, 1);
    assert.deepEqual(data.history, []);
  });

  it("keeps prior runs as compact history once a newer one exists", () => {
    recordAuditRun({
      projectSlug: "pantry-pilot",
      targetUrl: "https://pantrypilot.app",
      startedAt: "2026-09-24T09:00:00.000Z",
      finishedAt: "2026-09-24T09:00:05.000Z",
      status: "complete",
      findings: [],
    });

    const data = readProjectSeo("pantry-pilot");
    assert.equal(data.history.length, 1);
    assert.equal(data.history[0].findingCount, 1);
  });

  it("keeps a project's audits separate from another project's", () => {
    assert.deepEqual(readProjectSeo("vaja"), { latest: undefined, history: [] });
  });

  it("records a failed run with no findings, and it never becomes latest ahead of a complete one that is newer", () => {
    recordAuditRun({
      projectSlug: "pantry-pilot",
      targetUrl: "https://pantrypilot.app",
      startedAt: "2026-09-24T07:00:00.000Z",
      finishedAt: "2026-09-24T07:00:01.000Z",
      status: "failed",
      error: "The site did not respond.",
      findings: [],
    });

    // Older than both runs above, so it must not be `latest`.
    const data = readProjectSeo("pantry-pilot");
    assert.notEqual(data.latest?.status, "failed");
  });
});

describe("markFindingFiled / readFinding", () => {
  it("marks a finding filed once a task exists for it", () => {
    const run = recordAuditRun({
      projectSlug: "vaja",
      targetUrl: "https://vaja.example",
      startedAt: "2026-09-24T10:00:00.000Z",
      finishedAt: "2026-09-24T10:00:02.000Z",
      status: "complete",
      findings: [
        { category: "links", severity: "critical", title: "Broken link", description: "...", pageUrl: "https://vaja.example" },
      ],
    });

    const findingId = run.findings[0].id;
    assert.equal(readFinding(findingId)?.taskId, undefined);

    markFindingFiled(findingId, "VJ-12");

    assert.equal(readFinding(findingId)?.taskId, "VJ-12");
  });

  it("reads undefined for a finding that does not exist", () => {
    assert.equal(readFinding("not-a-real-id"), undefined);
  });
});
