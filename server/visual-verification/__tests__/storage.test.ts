import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { VisualVerificationResult } from "../../../shared/visual-verification-types";
import {
  readVerification,
  readVerificationHistory,
  resolveScreenshot,
  saveScreenshot,
  saveVerification,
  screenshotName,
} from "../storage";

/**
 * Two properties are being protected here.
 *
 * A revision's screenshots and verdict survive the revision after it — the
 * whole reason for keeping history is answering "did sending it back actually
 * fix anything?", which needs both attempts.
 *
 * And the browser names screenshots while only the server names files. A name
 * this system would not have generated must be refused rather than resolved.
 */

const JOB = "job_abcd1234abcd1234";

function verdict(
  revision: number,
  fields: Partial<VisualVerificationResult> = {},
): VisualVerificationResult {
  return {
    jobId: JOB,
    revision,
    verdict: "changes_required",
    summary: `Revision ${revision}`,
    strengths: [],
    issues: [],
    criteria: [],
    screenshots: [],
    references: [],
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

describe("naming a capture", () => {
  it("reads as the route and the viewport it came from", () => {
    assert.equal(screenshotName("/designs", "desktop"), "designs-desktop.png");
  });

  it("flattens a nested route into one readable name", () => {
    assert.equal(
      screenshotName("/projects/pantry-pilot", "mobile"),
      "projects-pantry-pilot-mobile.png",
    );
  });

  it("gives the site root a name of its own", () => {
    assert.equal(screenshotName("/", "desktop"), "root-desktop.png");
  });
});

describe("where screenshots and verdicts are kept", () => {
  let directory: string;
  let previous: string | undefined;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-visual-"));
    previous = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = directory;
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;

    await fs.rm(directory, { recursive: true, force: true });
  });

  it("refuses a name it would not have generated", () => {
    assert.throws(() => resolveScreenshot(JOB, 1, "../../../etc/passwd"));
    assert.throws(() => resolveScreenshot(JOB, 1, "designs-desktop.png.sh"));
    assert.throws(() => resolveScreenshot(JOB, 1, "Designs.png"));
  });

  it("refuses a job id it would not have generated", () => {
    assert.throws(() => resolveScreenshot("../escape", 1, "a.png"));
  });

  it("refuses a revision that is not one", () => {
    assert.throws(() => resolveScreenshot(JOB, 0, "a.png"));
    assert.throws(() => resolveScreenshot(JOB, 1.5, "a.png"));
  });

  it("stores a capture where the verdict for that revision can find it", async () => {
    await saveScreenshot(JOB, 1, "designs-desktop.png", Buffer.from("png"));

    const contents = await fs.readFile(
      resolveScreenshot(JOB, 1, "designs-desktop.png"),
      "utf8",
    );

    assert.equal(contents, "png");
  });

  it("keeps each revision apart, so an earlier attempt is never overwritten", async () => {
    await saveScreenshot(JOB, 1, "designs-desktop.png", Buffer.from("first"));
    await saveScreenshot(JOB, 2, "designs-desktop.png", Buffer.from("second"));

    assert.equal(
      await fs.readFile(resolveScreenshot(JOB, 1, "designs-desktop.png"), "utf8"),
      "first",
    );
    assert.equal(
      await fs.readFile(resolveScreenshot(JOB, 2, "designs-desktop.png"), "utf8"),
      "second",
    );
  });

  it("reads back a verdict it wrote", async () => {
    await saveVerification(verdict(1, { summary: "Over-framed" }));

    const read = await readVerification(JOB, 1);

    assert.equal(read?.summary, "Over-framed");
    assert.equal(read?.verdict, "changes_required");
  });

  it("returns nothing for a revision that was never verified", async () => {
    assert.equal(await readVerification(JOB, 9), undefined);
  });

  it("returns every revision, oldest first", async () => {
    await saveVerification(verdict(1));
    await saveVerification(verdict(2, { verdict: "pass", summary: "Fixed" }));

    const history = await readVerificationHistory(JOB);

    assert.deepEqual(
      history.map((entry) => entry.revision),
      [1, 2],
    );
    assert.equal(history[1].verdict, "pass");
  });

  it("has no history for a job that was never verified", async () => {
    assert.deepEqual(
      await readVerificationHistory("job_neverneverneve"),
      [],
    );
  });
});
