import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchHit, SearchHitKind } from "../../../shared/agentos-types";
import { searchCorpus } from "../search";

function hit(kind: SearchHitKind, id: string, title: string, detail?: string): SearchHit {
  return { kind, id, title, detail, href: `/${kind}/${id}` };
}

const corpus: Record<SearchHitKind, SearchHit[]> = {
  project: [hit("project", "pantry-pilot", "Pantry Pilot", "Product · active")],
  milestone: [hit("milestone", "pantry-pilot:chef-experience", "Chef Experience", "Pantry Pilot · active")],
  task: [
    hit("task", "PP-014", "PP-014 Improve Chef retry flow", "Pantry Pilot · now"),
    hit("task", "PP-018", "PP-018 Chef visual polish", "Pantry Pilot · next"),
    hit("task", "PP-020", "PP-020 Nutrition dashboard", "Pantry Pilot · later"),
  ],
  decision: [hit("decision", "d1", "Chef should generate missing recipes", "Pantry Pilot")],
  document: [hit("document", "pantry-pilot:artifacts/PP-014/chef-research", "Chef Generation Research", "Pantry Pilot · research · MealDB fallback should occur when search is empty")],
  design: [hit("design", "b1", "Chef Inspiration", "Board · pantry-pilot")],
  job: [hit("job", "j1", "Fix the chef loading state", "pantry-pilot · completed")],
  session: [hit("session", "s1", "Morning planning", "pantry-pilot · 12 messages")],
};

describe("searchCorpus", () => {
  it("returns nothing for a query shorter than two characters", () => {
    assert.deepEqual(searchCorpus(corpus, "c").groups, []);
  });

  it("groups hits by kind in a fixed order", () => {
    const result = searchCorpus(corpus, "chef");

    assert.deepEqual(
      result.groups.map((group) => group.kind),
      ["milestone", "task", "decision", "document", "design", "job"],
    );
  });

  it("ranks title prefixes before substrings before detail matches", () => {
    const result = searchCorpus(corpus, "chef");
    const tasks = result.groups.find((group) => group.kind === "task");

    // Neither title starts with "chef" once the id is prepended, so both are
    // substring matches and keep source order; "Nutrition" only matches nothing.
    assert.deepEqual(
      tasks?.hits.map((entry) => entry.id),
      ["PP-014", "PP-018"],
    );

    const designs = searchCorpus(corpus, "chef i").groups.find((group) => group.kind === "design");
    assert.equal(designs?.hits[0]?.title, "Chef Inspiration");
  });

  it("matches ids and detail text, case-insensitively", () => {
    assert.equal(searchCorpus(corpus, "pp-020").groups[0]?.hits[0]?.id, "PP-020");
    assert.equal(searchCorpus(corpus, "LATER").groups[0]?.hits[0]?.id, "PP-020");
  });

  it("finds a document by a phrase in its body", () => {
    const result = searchCorpus(corpus, "mealdb fallback");
    assert.equal(result.groups[0]?.kind, "document");
    assert.equal(result.groups[0]?.hits[0]?.title, "Chef Generation Research");
  });

  it("cuts each group at the limit and says so", () => {
    const result = searchCorpus(corpus, "pantry", 1);

    assert.equal(result.truncated, true);
    for (const group of result.groups) assert.equal(group.hits.length, 1);
  });
});
