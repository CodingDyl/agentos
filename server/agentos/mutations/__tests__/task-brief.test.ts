import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

describe("task briefs and reference uploads", () => {
  let vault: string;
  let previous: string | undefined;
  let briefs: typeof import("../task-brief");

  before(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-task-brief-"));
    previous = process.env.AGENTOS_ROOT;
    process.env.AGENTOS_ROOT = vault;
    await fs.mkdir(path.join(vault, "projects", "bosch"), { recursive: true });
    briefs = await import("../task-brief");
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_ROOT;
    else process.env.AGENTOS_ROOT = previous;
    await fs.rm(vault, { recursive: true, force: true });
  });

  it("stores outcome, scope, acceptance and constraints under artifacts/<task-id>", async () => {
    const brief = await briefs.saveTaskBrief({
      slug: "bosch",
      taskId: "BO-014",
      desiredOutcome: "The loader is DedSec and never flashes on a fast read.",
      scope: "Replace the Chef spinner with the shared DedSec loader.",
      acceptanceCriteria: ["Loader shows after 150ms", "Reduced motion uses the still"],
      constraints: ["Existing theme only"],
      links: ["https://example.com/brief"],
    });

    assert.equal(brief.desiredOutcome?.includes("DedSec"), true);
    assert.match(brief.scope ?? "", /Chef spinner/);
    assert.deepEqual(brief.acceptanceCriteria, ["Loader shows after 150ms", "Reduced motion uses the still"]);

    const onDisk = await fs.readFile(path.join(vault, "projects", "bosch", "artifacts", "BO-014", "brief.md"), "utf8");
    assert.match(onDisk, /desiredOutcome:/);
    assert.match(onDisk, /Chef spinner/);
  });

  it("saves a reference upload under artifacts/<task-id>/refs", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ref = await briefs.saveTaskReference({
      slug: "bosch",
      taskId: "BO-014",
      filename: "Chef loading.png",
      mimeType: "image/png",
      body: png,
    });

    assert.equal(ref.image, true);
    assert.match(ref.relativePath, /artifacts\/BO-014\/refs\/Chef-loading\.png$/);

    const reread = await briefs.readTaskBrief("bosch", "BO-014");
    assert.equal(reread?.references?.some((entry) => entry.name === "Chef-loading.png"), true);

    const files = await briefs.taskBriefContextFiles("bosch", "BO-014");
    assert.ok(files.some((file) => file.endsWith("brief.md")));
    assert.ok(files.some((file) => file.endsWith("Chef-loading.png")));
  });

  it("stores a path-climbing filename as a basename inside the refs folder", async () => {
    const ref = await briefs.saveTaskReference({
      slug: "bosch",
      taskId: "BO-014",
      filename: "../../etc/passwd",
      mimeType: "text/plain",
      body: Buffer.from("nope"),
    });

    assert.equal(path.basename(ref.relativePath), ref.name);
    assert.match(ref.relativePath, /artifacts\/BO-014\/refs\/passwd\.txt$/);
    assert.ok(!ref.relativePath.includes(".."));
  });

  it("names a content type from the stored extension", () => {
    assert.equal(briefs.mimeForRefName("shot.png"), "image/png");
    assert.equal(briefs.mimeForRefName("notes.md"), "text/markdown");
    assert.equal(briefs.mimeForRefName("unknown.bin"), "application/octet-stream");
  });
});
