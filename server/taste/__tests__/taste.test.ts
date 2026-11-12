import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { DesignAssetSchema } from "../../../shared/agentos-types";

/**
 * Taste Vault is a view over the design library, so what matters is that the
 * library it reads was not broken by the new fields, and that a job is handed
 * only what was attached to its workspace. Temporary directories throughout.
 */

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-taste-"));
process.env.AGENTOS_UI_DIR = path.join(directory, "state");
process.env.AGENTOS_MEDIA_DIR = path.join(directory, "media");
process.env.AGENTOS_ROOT = path.join(directory, "vault");

const library = await import("../../designs/library");
const taste = await import("../taste");

const libraryFile = path.join(directory, "state", "design-library.json");

async function writeLibrary(assets: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(libraryFile), { recursive: true });
  await fs.writeFile(libraryFile, JSON.stringify({ assets, boards: [] }));
}

function stored(id: string, overrides: Record<string, unknown> = {}) {
  return { id, filename: `${id}.png`, storedName: `${id}.png`, hasThumbnail: false, type: "reference", tags: [], favorite: false, createdAt: "2026-11-01T10:00:00Z", ...overrides };
}

after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe("a library written before Taste Vault", () => {
  it("reads back with nothing attached, and keeps the new fields once they are set", async () => {
    await writeLibrary([stored("old")]);

    const [asset] = (await library.getLibrary()).assets;
    assert.deepEqual(asset.attachedTo, []);
    assert.equal(asset.sourceUrl, undefined);
    assert.equal(asset.snippet, undefined);

    await library.updateAsset("old", { snippet: "<button />", attachedTo: ["demo", "demo"] });
    // A later, unrelated write must not drop them: the reader is a whitelist.
    await library.updateAsset("old", { favorite: true });
    const [again] = (await library.getLibrary()).assets;
    assert.equal(again.snippet, "<button />");
    assert.deepEqual(again.attachedTo, ["demo"]);
  });

  it("still parses as a wire asset without the new fields", () => {
    const parsed = DesignAssetSchema.parse({ id: "a", filename: "a.png", url: "/u", thumbnailUrl: "/t", type: "reference", tags: [], favorite: false, createdAt: "2026-11-01T10:00:00Z", boardIds: [] });
    assert.deepEqual(parsed.attachedTo, []);
    assert.throws(() => DesignAssetSchema.parse({ ...parsed, snippet: "x".repeat(20_001) }));
  });
});

describe("what a job is handed", () => {
  it("is only the image references attached to its workspace, newest first, at most twelve", async () => {
    const attached = Array.from({ length: 14 }, (_, index) =>
      stored(`ref-${index}`, { attachedTo: ["demo"], createdAt: `2026-11-${String(index + 1).padStart(2, "0")}T10:00:00Z` }),
    );
    await writeLibrary([
      ...attached,
      stored("elsewhere", { attachedTo: ["other"] }),
      stored("unattached"),
      stored("not-a-reference", { type: "uploaded", attachedTo: ["demo"] }),
      stored("film", { storedName: "film.mp4", mediaType: "video", attachedTo: ["demo"] }),
    ]);

    const references = await taste.tasteReferencesFor("demo");
    assert.equal(references.length, taste.TASTE_JOB_CAP);
    assert.equal(references[0].filename, "ref-13.png");
    assert.equal(references[11].filename, "ref-2.png");
    assert.equal(references[0].path, path.join(directory, "media", "originals", "ref-13.png"));
    assert.deepEqual(await taste.tasteReferencesFor("nobody"), []);
  });

  it("carries the why-note, tags, source and snippet, and only the start of a very long snippet", async () => {
    await writeLibrary([stored("one", { attachedTo: ["demo"], notes: "Calm spacing", tags: ["nav"], sourceUrl: "https://linear.app/", snippet: "s".repeat(9_000) })]);

    const [reference] = await taste.tasteReferencesFor("demo");
    assert.equal(reference.notes, "Calm spacing");
    assert.deepEqual(reference.tags, ["nav"]);
    assert.equal(reference.sourceUrl, "https://linear.app/");
    assert.ok(reference.snippet!.length < 4_100);
    assert.match(reference.snippet!, /\(truncated\)$/);
  });
});

describe("adding a URL", () => {
  it("refuses an address that is not a public website without opening a browser", async () => {
    const original = taste.tasteDeps.capture;
    let opened = 0;
    taste.tasteDeps.capture = async () => {
      opened += 1;
      return undefined;
    };
    try {
      for (const url of ["http://127.0.0.1/", "http://192.168.1.4/admin", "http://localhost/", "file:///etc/passwd", "https://intranet.local/"]) {
        await assert.rejects(taste.addUrlReference({ url }), (error: unknown) => error instanceof taste.TasteError && error.status === 400);
      }
      assert.equal(opened, 0);
    } finally {
      taste.tasteDeps.capture = original;
    }
  });

  it("files the photograph as a reference with its source, once", async () => {
    await writeLibrary([]);
    const original = taste.tasteDeps.capture;
    taste.tasteDeps.capture = async () => Buffer.from("not really a png");
    try {
      const first = await taste.addUrlReference({ url: "https://linear.app/features", notes: " Dense but calm ", tags: ["Nav", "nav"] });
      assert.equal(first.created, true);
      assert.equal(first.asset.type, "reference");
      assert.equal(first.asset.sourceUrl, "https://linear.app/features");
      assert.equal(first.asset.notes, "Dense but calm");
      assert.deepEqual(first.asset.tags, ["nav"]);
      assert.equal(first.asset.filename, "linear.app.png");

      const second = await taste.addUrlReference({ url: "https://linear.app/features" });
      assert.equal(second.created, false);
      assert.equal(second.asset.id, first.asset.id);
      assert.equal((await taste.listTaste()).length, 1);
      assert.deepEqual(await fs.readdir(path.join(directory, "media", "originals")), [`${first.asset.id}.png`]);
    } finally {
      taste.tasteDeps.capture = original;
    }
  });

  it("says so when the page could not be photographed", async () => {
    const original = taste.tasteDeps.capture;
    taste.tasteDeps.capture = async () => undefined;
    try {
      await assert.rejects(taste.addUrlReference({ url: "https://example.com/" }), (error: unknown) => error instanceof taste.TasteError && error.status === 422);
    } finally {
      taste.tasteDeps.capture = original;
    }
  });
});
