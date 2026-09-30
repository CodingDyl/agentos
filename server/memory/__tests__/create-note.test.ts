import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { checkFolder, composeNote, noteFileName, normaliseTag } from "../../../shared/memory-paths";
import { createMemoryNote, CreateNoteError } from "../create-note";
import { MemoryService } from "../service";

describe("new note paths", () => {
  it("turns a title into an Obsidian file name", () => {
    assert.equal(noteFileName("  Pricing: v2 / draft?  "), "Pricing v2 draft.md");
    assert.equal(noteFileName("[[ ]]"), "");
    assert.equal(noteFileName("...hidden"), "hidden.md");
  });

  it("checks folders", () => {
    assert.deepEqual(checkFolder("/projects/new-thing/"), { ok: true, folder: "projects/new-thing" });
    assert.deepEqual(checkFolder(""), { ok: true, folder: "" });
    for (const bad of ["../escape", "projects/../..", ".obsidian", "a//b", "a/b:c", "._x"]) {
      assert.equal(checkFolder(bad).ok, false, bad);
    }
  });

  it("normalises tags the way the index reads them", () => {
    assert.equal(normaliseTag("#Pricing Ideas"), "pricing-ideas");
    assert.equal(normaliseTag("2026"), undefined);
    assert.equal(normaliseTag("a b!"), undefined);
  });

  it("writes tags as front matter and links as a Related section", () => {
    const text = composeNote({
      title: "Choice",
      body: "Why.",
      tags: ["decision"],
      links: ["projects/a/PROJECT.md", "me/GOALS.md"],
      allIds: ["projects/a/PROJECT.md", "projects/b/PROJECT.md", "me/GOALS.md"],
    });
    assert.equal(text, "---\ntags: [decision]\n---\n# Choice\n\nWhy.\n\n## Related\n\n- [[projects/a/PROJECT]]\n- [[GOALS]]\n");
  });
});

describe("creating a note", () => {
  let parent: string;
  let root: string;
  let service: MemoryService;

  before(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "memory-create-"));
    root = path.join(parent, "vault");
    await fs.mkdir(path.join(root, "projects/demo"), { recursive: true });
    await fs.writeFile(path.join(root, "projects/demo/PROJECT.md"), "# Demo\n");
    service = new MemoryService({ root, cacheFile: path.join(parent, "cache.json"), probeMs: 60_000, reconcileMs: 60_000 });
    await service.start();
  });

  after(async () => {
    service.stop();
    await fs.rm(parent, { recursive: true, force: true });
  });

  it("creates the note, and a new folder for it, and indexes it at once", async () => {
    const created = await createMemoryNote(service, {
      folder: "projects/demo/research",
      title: "Market scan",
      body: "Three competitors.",
      tags: ["#research"],
      links: ["projects/demo/PROJECT.md"],
    });
    assert.deepEqual(created, { id: "projects/demo/research/Market scan.md", createdFolders: ["projects/demo/research"] });
    const written = await fs.readFile(path.join(root, created.id), "utf8");
    assert.match(written, /\[\[PROJECT\]\]/);
    assert.equal(service.index.detail(created.id, false)?.outgoingCount, 1);
    assert.equal(service.index.detail("projects/demo/PROJECT.md", false)?.backlinkCount, 1);
  });

  it("never overwrites, including a name that differs only in case", async () => {
    await assert.rejects(
      createMemoryNote(service, { folder: "projects/demo", title: "project" }),
      (error: unknown) => error instanceof CreateNoteError && error.status === 409,
    );
    assert.equal(await fs.readFile(path.join(root, "projects/demo/PROJECT.md"), "utf8"), "# Demo\n");
  });

  it("refuses traversal, hidden folders, unknown links and empty titles", async () => {
    for (const request of [
      { folder: "../outside", title: "x" },
      { folder: ".obsidian", title: "x" },
      { folder: "", title: "   " },
      { folder: "", title: "x", links: ["nope.md"] },
    ]) {
      await assert.rejects(createMemoryNote(service, request), (error: unknown) => error instanceof CreateNoteError && error.status === 400);
    }
    await assert.rejects(fs.stat(path.join(parent, "outside")));
  });

  it("refuses a folder that is a symlink out of the vault", async () => {
    const outside = path.join(parent, "elsewhere");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, "sneaky"));
    await assert.rejects(createMemoryNote(service, { folder: "sneaky", title: "x" }), CreateNoteError);
    assert.deepEqual(await fs.readdir(outside), []);
  });

  it("refuses to write, or make folders, while the vault is missing", async () => {
    const away = path.join(parent, "unplugged");
    await fs.rename(root, away);
    try {
      await assert.rejects(
        createMemoryNote(service, { folder: "fresh", title: "x" }),
        (error: unknown) => error instanceof CreateNoteError && error.status === 503,
      );
      await assert.rejects(fs.stat(root), "no replacement vault was created");
    } finally {
      await fs.rename(away, root);
    }
  });
});
