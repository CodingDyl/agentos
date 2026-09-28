import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { AttentionItem } from "../../../shared/mission-control-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-today-dismiss-"));
process.env.AGENTOS_UI_DIR = directory;

const { applyDismissals, dismissAttention, restoreAttention } = await import("../dismissals");

after(() => fs.rmSync(directory, { recursive: true, force: true }));

function card(id: string, createdAt: string): AttentionItem {
  return {
    id,
    type: "failed",
    severity: "critical",
    title: id,
    description: "It failed.",
    action: { label: "Open job", href: `/workers/jobs/${id}` },
    createdAt,
  };
}

const failedOnce = card("job-a", "2026-09-14T17:50:35.333Z");
const other = card("job-b", "2026-09-16T17:05:54.969Z");

describe("Today dismissals", () => {
  it("hides a dismissed card and keeps it listed as dismissed", async () => {
    await dismissAttention([{ id: failedOnce.id, createdAt: failedOnce.createdAt }]);
    const { attention, dismissed } = await applyDismissals([failedOnce, other]);
    assert.deepEqual(attention.map((item) => item.id), ["job-b"]);
    assert.deepEqual(dismissed.map((item) => item.id), ["job-a"]);
  });

  it("brings the same job back when it fails again later", async () => {
    const failedAgain = card("job-a", "2026-09-29T08:00:00.000Z");
    const { attention } = await applyDismissals([failedAgain]);
    assert.deepEqual(attention.map((item) => item.id), ["job-a"]);
  });

  it("dismisses the same card twice without duplicating it", async () => {
    await dismissAttention([{ id: failedOnce.id, createdAt: failedOnce.createdAt }]);
    const stored = JSON.parse(fs.readFileSync(path.join(directory, "today-dismissals.json"), "utf8"));
    assert.equal(stored.length, 1);
  });

  it("restores one card, or all of them", async () => {
    await dismissAttention([{ id: other.id, createdAt: other.createdAt }]);
    await restoreAttention(["job-a"]);
    assert.deepEqual((await applyDismissals([failedOnce, other])).attention.map((item) => item.id), ["job-a"]);

    await restoreAttention();
    assert.equal((await applyDismissals([failedOnce, other])).dismissed.length, 0);
  });
});
