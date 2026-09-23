import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The library is the only record of what an image *means*. Losing it would
 * leave a directory of anonymous PNGs, so every change is serialised and
 * written atomically — and board membership lives in exactly one place, so a
 * board and an asset can never disagree about whether it belongs.
 *
 * Exercised against temporary directories, never the operator's own library.
 */

describe("the design library", () => {
  let directory: string;
  let previousUi: string | undefined;
  let previousMedia: string | undefined;
  let library: typeof import("../library");

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-designs-"));
    previousUi = process.env.AGENTOS_UI_DIR;
    previousMedia = process.env.AGENTOS_MEDIA_DIR;
    process.env.AGENTOS_UI_DIR = path.join(directory, "state");
    process.env.AGENTOS_MEDIA_DIR = path.join(directory, "media");
    library = await import("../library");
  });

  after(async () => {
    if (previousUi === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previousUi;

    if (previousMedia === undefined) delete process.env.AGENTOS_MEDIA_DIR;
    else process.env.AGENTOS_MEDIA_DIR = previousMedia;

    await fs.rm(directory, { recursive: true, force: true });
  });

  async function addAsset(id: string, overrides = {}) {
    return library.createAsset({
      id,
      filename: `${id}.png`,
      storedName: `${id}.png`,
      hasThumbnail: false,
      type: "uploaded",
      ...overrides,
    });
  }

  it("starts empty rather than failing", async () => {
    assert.deepEqual(await library.getLibrary(), { assets: [], boards: [] });
  });

  it("gives the browser URLs, never a filesystem path", async () => {
    const asset = await addAsset("a1", { dimensions: { width: 1440, height: 1000 } });

    assert.equal(asset.url, "/api/designs/assets/a1/media");
    assert.equal(asset.width, 1440);
    assert.ok(!JSON.stringify(asset).includes("storedName"));
    assert.ok(!JSON.stringify(asset).includes(directory));
  });

  it("serves the original when no thumbnail was made", async () => {
    const asset = await addAsset("a2");

    assert.equal(asset.thumbnailUrl, "/api/designs/assets/a2/media");
  });

  it("lists newest first", async () => {
    const { assets } = await library.getLibrary();

    assert.deepEqual(
      assets.map((asset) => asset.id),
      ["a2", "a1"],
    );
  });

  it("normalises tags, and keeps each one once", async () => {
    const asset = await library.updateAsset("a1", {
      tags: [" Mobile ", "NUTRITION", "mobile", "  "],
    });

    assert.deepEqual(asset?.tags, ["mobile", "nutrition"]);
  });

  it("distinguishes leaving a field alone from clearing it", async () => {
    await library.updateAsset("a1", { project: "pantry-pilot" });

    const untouched = await library.updateAsset("a1", { favorite: true });
    assert.equal(untouched?.project, "pantry-pilot");
    assert.equal(untouched?.favorite, true);

    const cleared = await library.updateAsset("a1", { project: null });
    assert.equal(cleared?.project, undefined);
  });

  it("reports nothing for an asset that is not there", async () => {
    assert.equal(await library.updateAsset("missing", { favorite: true }), undefined);
  });

  describe("boards", () => {
    let boardId: string;

    it("creates a board with no assets in it", async () => {
      const board = await library.createBoard({
        name: "Chef Inspiration",
        project: "pantry-pilot",
      });

      boardId = board.id;
      assert.deepEqual(board.assetIds, []);
    });

    it("collects ids rather than copying assets", async () => {
      const board = await library.setBoardMembership(boardId, "a1", true);

      assert.deepEqual(board?.assetIds, ["a1"]);
    });

    it("derives membership onto the asset, from the board", async () => {
      const { assets } = await library.getLibrary();
      const asset = assets.find((entry) => entry.id === "a1");

      assert.deepEqual(asset?.boardIds, [boardId]);
    });

    it("lets one asset belong to several boards", async () => {
      const second = await library.createBoard({ name: "Mobile UI References" });
      await library.setBoardMembership(second.id, "a1", true);

      const { assets } = await library.getLibrary();
      const asset = assets.find((entry) => entry.id === "a1");

      assert.equal(asset?.boardIds.length, 2);
    });

    it("adding twice does not add twice", async () => {
      const board = await library.setBoardMembership(boardId, "a1", true);

      assert.deepEqual(board?.assetIds, ["a1"]);
    });

    it("refuses to collect an asset that does not exist", async () => {
      assert.equal(
        await library.setBoardMembership(boardId, "missing", true),
        undefined,
      );
    });

    it("removes an asset from a board without deleting it", async () => {
      await library.setBoardMembership(boardId, "a2", true);
      await library.setBoardMembership(boardId, "a2", false);

      const { assets, boards } = await library.getLibrary();

      assert.ok(!boards.find((b) => b.id === boardId)?.assetIds.includes("a2"));
      assert.ok(assets.some((asset) => asset.id === "a2"));
    });

    it("deleting a board leaves its assets in the library", async () => {
      const doomed = await library.createBoard({ name: "Temporary" });
      await library.setBoardMembership(doomed.id, "a1", true);

      assert.equal(await library.deleteBoard(doomed.id), true);

      const { assets } = await library.getLibrary();
      assert.ok(assets.some((asset) => asset.id === "a1"));
    });

    it("deleting an asset removes it from every board it was on", async () => {
      assert.equal(await library.deleteAsset("a1"), true);

      const { assets, boards } = await library.getLibrary();

      assert.ok(!assets.some((asset) => asset.id === "a1"));
      assert.ok(boards.every((board) => !board.assetIds.includes("a1")));
    });

    it("reports an asset that was never there", async () => {
      assert.equal(await library.deleteAsset("a1"), false);
    });
  });

  /**
   * A hand-edited or half-written library must not take the whole thing with
   * it. Each of these reads an isolated file, so neither depends on what any
   * other test left behind.
   */
  async function withLibraryFile<T>(contents: string, read: () => Promise<T>): Promise<T> {
    const isolated = await fs.mkdtemp(path.join(directory, "isolated-"));
    const restore = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = isolated;

    try {
      await fs.writeFile(path.join(isolated, "design-library.json"), contents, "utf8");
      return await read();
    } finally {
      process.env.AGENTOS_UI_DIR = restore;
    }
  }

  it("survives a library file it cannot read", async () => {
    const result = await withLibraryFile("{ half written", () => library.getLibrary());

    assert.deepEqual(result, { assets: [], boards: [] });
  });

  it("keeps the entries it can read when one is unusable", async () => {
    const { assets, boards } = await withLibraryFile(
      JSON.stringify({
        assets: [
          { id: "good", storedName: "good.png", createdAt: "2026-09-07T10:00:00Z" },
          { filename: "no-id.png" },
        ],
        boards: [{ id: "b1", name: "Kept" }, { name: "No id" }],
      }),
      () => library.getLibrary(),
    );

    assert.deepEqual(
      assets.map((asset) => asset.id),
      ["good"],
    );
    assert.deepEqual(
      boards.map((board) => board.name),
      ["Kept"],
    );
  });

  it("does not lose a change when two are made at once", async () => {
    await library.createAsset({
      id: "race",
      filename: "race.png",
      storedName: "race.png",
      hasThumbnail: false,
      type: "uploaded",
    });

    // Both read-modify-write the same file; serialised, each sees the other's
    // result rather than overwriting it.
    await Promise.all([
      library.updateAsset("race", { favorite: true }),
      library.updateAsset("race", { tags: ["dark"] }),
    ]);

    const { assets } = await library.getLibrary();
    const asset = assets.find((entry) => entry.id === "race");

    assert.equal(asset?.favorite, true);
    assert.deepEqual(asset?.tags, ["dark"]);
  });
});
