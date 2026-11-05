import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MarketplaceCandidate } from "@shared/skill-types";
import { filterSkills, initialPicks, isLargeRepo, MAX_SKILLS_PER_INSTALL } from "../marketplace-picks";

function skill(id: string, overrides: Partial<MarketplaceCandidate> = {}): MarketplaceCandidate {
  return { id, name: id, description: "", version: "1.0.0", path: `skills/${id}`, files: 1, bytes: 10, errors: [], installed: false, ...overrides };
}
const many = (count: number) => Array.from({ length: count }, (_, index) => skill(`skill-${index}`));

describe("initialPicks", () => {
  it("ticks every installable skill when they fit in one install", () => {
    const skills = [skill("a"), skill("b", { errors: ["No name."] }), skill("c", { conflict: "Taken." })];
    assert.deepEqual(initialPicks(skills), ["a"]);
    assert.equal(initialPicks(many(MAX_SKILLS_PER_INSTALL)).length, MAX_SKILLS_PER_INSTALL);
  });

  it("ticks nothing when they would not fit, as with a 314-skill repo", () => {
    assert.deepEqual(initialPicks(many(MAX_SKILLS_PER_INSTALL + 1)), []);
    assert.deepEqual(initialPicks(many(314)), []);
  });

  it("counts only installable skills towards the limit", () => {
    const broken = Array.from({ length: 30 }, (_, index) => skill(`broken-${index}`, { errors: ["Bad."] }));
    assert.deepEqual(initialPicks([skill("good"), ...broken]), ["good"]);
  });
});

describe("isLargeRepo", () => {
  it("goes by every skill shown, including ones that can't install", () => {
    assert.equal(isLargeRepo(many(MAX_SKILLS_PER_INSTALL)), false);
    assert.equal(isLargeRepo(many(MAX_SKILLS_PER_INSTALL + 1)), true);
  });
});

describe("filterSkills", () => {
  const skills = [skill("click-path-audit", { description: "Trace every button" }), skill("loop-design-check", { description: "Review an agent loop" })];

  it("matches names and descriptions, ignoring case", () => {
    assert.deepEqual(filterSkills(skills, "CLICK").map((entry) => entry.id), ["click-path-audit"]);
    assert.deepEqual(filterSkills(skills, "agent").map((entry) => entry.id), ["loop-design-check"]);
  });

  it("needs every word, in any order", () => {
    assert.deepEqual(filterSkills(skills, "button trace").map((entry) => entry.id), ["click-path-audit"]);
    assert.deepEqual(filterSkills(skills, "button loop"), []);
  });

  it("shows everything for a blank filter", () => {
    assert.equal(filterSkills(skills, "   ").length, 2);
  });
});
