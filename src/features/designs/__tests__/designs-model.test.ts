import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesignAsset } from "@shared/agentos-types";
import {
  aspectRatio,
  collectTags,
  distributeIntoColumns,
  collectProducts,
  collectSources,
  filterAssets,
  matchesSearch,
  UNASSIGNED,
} from "../designs-model";

/**
 * A library is only as good as its finding, and a moodboard is only as good as
 * its layout. These are the two things that have to be right: what counts as a
 * match, and how tiles fill columns without one running long.
 */

function asset(overrides: Partial<DesignAsset> = {}): DesignAsset {
  return {
    id: "a1",
    filename: "dashboard-inspiration.png",
    url: "/api/designs/assets/a1/media",
    thumbnailUrl: "/api/designs/assets/a1/media?size=thumbnail",
    type: "uploaded",
    tags: [],
    favorite: false,
    createdAt: "2026-09-07T10:00:00Z",
    boardIds: [],
    mediaType: "image",
    source: "upload",
    referenceAssetIds: [],
    approved: false,
    ...overrides,
  };
}

describe("searching", () => {
  const subject = asset({
    filename: "chef-screen.png",
    project: "pantry-pilot",
    tags: ["mobile", "nutrition"],
    notes: "Warm, not overly AI-looking.",
  });

  it("matches everything when nothing is typed", () => {
    assert.equal(matchesSearch(subject, ""), true);
    assert.equal(matchesSearch(subject, "   "), true);
  });

  it("searches what a person would actually remember", () => {
    assert.equal(matchesSearch(subject, "chef"), true);
    assert.equal(matchesSearch(subject, "pantry"), true);
    assert.equal(matchesSearch(subject, "nutrition"), true);
    assert.equal(matchesSearch(subject, "warm"), true);
  });

  it("ignores casing", () => {
    assert.equal(matchesSearch(subject, "MOBILE"), true);
  });

  it("narrows as more is typed, rather than widening", () => {
    // Every term must match something: two terms is a stricter query, not a
    // looser one.
    assert.equal(matchesSearch(subject, "chef mobile"), true);
    assert.equal(matchesSearch(subject, "chef desktop"), false);
  });

  it("does not match what is not there", () => {
    assert.equal(matchesSearch(subject, "virtara"), false);
  });
});

describe("filtering", () => {
  const assets = [
    asset({ id: "up", type: "uploaded", project: "pantry-pilot" }),
    asset({ id: "gen", type: "generated", favorite: true }),
    asset({ id: "ref", type: "reference", project: "virtara", tags: ["dark"] }),
  ];

  const base = { search: "", filter: "all" as const, project: "all" as const };

  it("returns everything but references by default", () => {
    // A reference is a generation's input; showing it in the feed made it
    // look as if it had been generated again.
    assert.deepEqual(filterAssets(assets, base).map((a) => a.id), ["up", "gen"]);
  });

  it("filters by kind", () => {
    assert.deepEqual(
      filterAssets(assets, { ...base, filter: "reference" }).map((a) => a.id),
      ["ref"],
    );
  });

  it("treats favourites as a filter of its own, not a kind", () => {
    assert.deepEqual(
      filterAssets(assets, { ...base, filter: "favorites" }).map((a) => a.id),
      ["gen"],
    );
  });

  it("filters by project", () => {
    assert.deepEqual(
      filterAssets(assets, { ...base, filter: "reference", project: "virtara" }).map((a) => a.id),
      ["ref"],
    );
  });

  it("combines filters with the search", () => {
    assert.equal(
      filterAssets(assets, { ...base, filter: "reference", project: "virtara", search: "dark" }).length,
      1,
    );
    assert.equal(
      filterAssets(assets, { ...base, filter: "reference", project: "virtara", search: "light" }).length,
      0,
    );
  });
});

describe("tags", () => {
  it("lists every tag, most used first", () => {
    const tags = collectTags([
      asset({ id: "1", tags: ["dark", "mobile"] }),
      asset({ id: "2", tags: ["mobile"] }),
      asset({ id: "3", tags: ["mobile", "dark"] }),
    ]);

    assert.deepEqual(tags, ["mobile", "dark"]);
  });

  it("has nothing to list for an untagged library", () => {
    assert.deepEqual(collectTags([asset()]), []);
  });
});

describe("tile proportions", () => {
  it("uses the asset's real shape", () => {
    assert.equal(aspectRatio(asset({ width: 1440, height: 1000 })), 1.44);
  });

  it("falls back to a square when the format had no dimensions to read", () => {
    assert.equal(aspectRatio(asset()), 1);
  });
});

describe("filling masonry columns", () => {
  const wide = (id: string) => asset({ id, width: 1600, height: 800 });
  const tall = (id: string) => asset({ id, width: 400, height: 1200 });

  it("keeps every asset", () => {
    const assets = [wide("a"), tall("b"), wide("c"), tall("d"), wide("e")];
    const columns = distributeIntoColumns(assets, 3);

    assert.equal(columns.flat().length, 5);
    assert.deepEqual(
      new Set(columns.flat().map((entry) => entry.id)),
      new Set(["a", "b", "c", "d", "e"]),
    );
  });

  it("runs reading order across the grid, not down one column", () => {
    // CSS columns would put the first three — the newest — in column one. In a
    // library ordered newest first, that is the wrong shape entirely.
    const columns = distributeIntoColumns(
      [wide("a"), wide("b"), wide("c")],
      3,
    );

    assert.deepEqual(
      columns.map((column) => column.map((entry) => entry.id)),
      [["a"], ["b"], ["c"]],
    );
  });

  it("puts each asset in whichever column is currently shortest", () => {
    // A tall tile in column one means the next one belongs elsewhere, even
    // though column one holds fewer tiles.
    const columns = distributeIntoColumns([tall("tall"), wide("w1"), wide("w2")], 2);

    assert.deepEqual(columns[0].map((entry) => entry.id), ["tall"]);
    assert.deepEqual(columns[1].map((entry) => entry.id), ["w1", "w2"]);
  });

  it("always produces the number of columns asked for", () => {
    assert.equal(distributeIntoColumns([], 4).length, 4);
    assert.equal(distributeIntoColumns([asset()], 4).length, 4);
  });

  it("never produces fewer than one column", () => {
    assert.equal(distributeIntoColumns([asset()], 0).length, 1);
    assert.equal(distributeIntoColumns([asset()], -3).length, 1);
  });
});

/**
 * Step 57: a visual does not have to belong to a project, so the feed has to
 * be able to ask for exactly the ones that do not.
 */
describe("filtering unassigned work", () => {
  const loose = asset({ id: "loose", filename: "experiment.png" });
  const owned = asset({ id: "owned", project: "pantry-pilot", product: "chef" });
  const generated = asset({
    id: "gen",
    type: "generated",
    source: "higgsfield",
    project: "pantry-pilot",
    product: "planner",
    model: "nano_banana_pro",
    approved: true,
  });

  const all = [loose, owned, generated];

  it("finds work that belongs to no project", () => {
    const visible = filterAssets(all, { search: "", filter: "all", project: UNASSIGNED });
    assert.deepEqual(visible.map((entry) => entry.id), ["loose"]);
  });

  it("keeps project filtering, and narrows further by product and source", () => {
    assert.deepEqual(
      filterAssets(all, { search: "", filter: "all", project: "pantry-pilot" }).map((e) => e.id),
      ["owned", "gen"],
    );
    assert.deepEqual(
      filterAssets(all, { search: "", filter: "all", project: "pantry-pilot", product: "chef" }).map((e) => e.id),
      ["owned"],
    );
    assert.deepEqual(
      filterAssets(all, { search: "", filter: "all", project: "all", source: "higgsfield" }).map((e) => e.id),
      ["gen"],
    );
  });

  it("separates approved from merely favourited", () => {
    assert.deepEqual(
      filterAssets(all, { search: "", filter: "approved", project: "all" }).map((e) => e.id),
      ["gen"],
    );
    assert.deepEqual(filterAssets(all, { search: "", filter: "favorites", project: "all" }), []);
  });

  it("searches the model and product a person would remember", () => {
    assert.equal(matchesSearch(generated, "nano_banana"), true);
    assert.equal(matchesSearch(generated, "planner"), true);
    assert.equal(matchesSearch(loose, "planner"), false);
  });

  it("lists only the products and sources actually present", () => {
    assert.deepEqual(collectProducts(all), ["chef", "planner"]);
    assert.deepEqual(collectSources(all), ["higgsfield", "upload"]);
  });
});
