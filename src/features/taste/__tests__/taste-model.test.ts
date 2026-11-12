import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL, collectTags, filterTaste, isWebUrl, parseTags, shortUrl, toggleAttachment } from "../taste-model";

const items = [
  { filename: "linear-home.png", notes: "Calm density", tags: ["dark", "saas"], sourceUrl: "https://linear.app/", attachedTo: ["pantry-pilot"] },
  { filename: "pricing.png", notes: undefined, tags: ["pricing"], sourceUrl: undefined, attachedTo: [] },
  { filename: "hero.webp", notes: "Big type, one action", tags: ["dark"], sourceUrl: undefined, attachedTo: ["pantry-pilot", "virtara"] },
];

const none = { search: "", tag: ALL, workspace: ALL };
const names = (list: typeof items) => list.map((item) => item.filename);

describe("taste model", () => {
  it("leaves the list alone with no filters", () => {
    assert.deepEqual(filterTaste(items, none), items);
  });

  it("searches filename, why-note, tags and source URL, case-insensitively", () => {
    assert.deepEqual(names(filterTaste(items, { ...none, search: "PRICING" })), ["pricing.png"]);
    assert.deepEqual(names(filterTaste(items, { ...none, search: "density" })), ["linear-home.png"]);
    assert.deepEqual(names(filterTaste(items, { ...none, search: "saas" })), ["linear-home.png"]);
    assert.deepEqual(names(filterTaste(items, { ...none, search: "linear.app" })), ["linear-home.png"]);
    assert.deepEqual(names(filterTaste(items, { ...none, search: "dark type" })), ["hero.webp"]);
    assert.deepEqual(filterTaste(items, { ...none, search: "nothing like this" }), []);
  });

  it("narrows by tag and by attached workspace, together", () => {
    assert.deepEqual(names(filterTaste(items, { ...none, tag: "dark" })), ["linear-home.png", "hero.webp"]);
    assert.deepEqual(names(filterTaste(items, { ...none, workspace: "virtara" })), ["hero.webp"]);
    assert.deepEqual(names(filterTaste(items, { search: "", tag: "saas", workspace: "pantry-pilot" })), ["linear-home.png"]);
    assert.deepEqual(filterTaste(items, { ...none, workspace: "agentos" }), []);
  });

  it("collects each tag once, alphabetically", () => {
    assert.deepEqual(collectTags(items), ["dark", "pricing", "saas"]);
  });

  it("toggles one workspace and returns the whole new list", () => {
    assert.deepEqual(toggleAttachment([], "virtara"), ["virtara"]);
    assert.deepEqual(toggleAttachment(["pantry-pilot"], "virtara"), ["pantry-pilot", "virtara"]);
    assert.deepEqual(toggleAttachment(["pantry-pilot", "virtara"], "pantry-pilot"), ["virtara"]);
  });

  it("parses a comma list of tags", () => {
    assert.deepEqual(parseTags(" dark, pricing ,, dark "), ["dark", "pricing"]);
    assert.deepEqual(parseTags("  "), []);
  });

  it("shortens a URL for a caption and only links web addresses", () => {
    assert.equal(shortUrl("https://www.linear.app/"), "linear.app");
    assert.equal(shortUrl("http://example.com/pricing"), "example.com/pricing");
    assert.equal(isWebUrl("https://linear.app"), true);
    assert.equal(isWebUrl("javascript:alert(1)"), false);
  });
});
