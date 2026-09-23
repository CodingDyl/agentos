import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectSummary } from "../../../../shared/agentos-types";
import {
  buildFilterOptions,
  countProjects,
  filterProjects,
  groupProjectsByState,
  sortProjects,
} from "../projects-model";

function project(
  slug: string,
  state: ProjectSummary["state"],
  priority: ProjectSummary["priority"],
  name = slug,
): ProjectSummary {
  return { slug, name, state, priority };
}

const portfolio: ProjectSummary[] = [
  project("voxmachine", "paused", "low", "VoxMachine"),
  project("jurivo", "incubating", "low", "Jurivo"),
  project("virtara", "active", "medium", "Virtara"),
  project("pantry-pilot", "active", "high", "Pantry Pilot"),
  project("legacy", "completed", "high", "Legacy"),
  project("stuck", "blocked", "medium", "Stuck"),
];

describe("sorting", () => {
  it("orders by state, then priority, then name", () => {
    assert.deepEqual(
      sortProjects(portfolio).map((p) => p.slug),
      ["pantry-pilot", "virtara", "stuck", "jurivo", "voxmachine", "legacy"],
    );
  });

  it("keeps the highest-priority active project first", () => {
    assert.equal(sortProjects(portfolio)[0].slug, "pantry-pilot");
  });

  it("breaks priority ties alphabetically", () => {
    const tied = [
      project("b-thing", "active", "high", "Beta"),
      project("a-thing", "active", "high", "Alpha"),
    ];

    assert.deepEqual(
      sortProjects(tied).map((p) => p.name),
      ["Alpha", "Beta"],
    );
  });

  it("does not mutate its input", () => {
    const original = [...portfolio];
    sortProjects(portfolio);

    assert.deepEqual(portfolio, original);
  });
});

describe("filtering", () => {
  it("returns everything for 'all'", () => {
    assert.equal(filterProjects(portfolio, "all").length, portfolio.length);
  });

  it("narrows to a single state", () => {
    assert.deepEqual(
      filterProjects(portfolio, "active").map((p) => p.slug),
      ["virtara", "pantry-pilot"],
    );
  });

  it("returns nothing for a state no project is in", () => {
    assert.deepEqual(filterProjects([project("a", "active", "high")], "paused"), []);
  });
});

describe("grouping", () => {
  it("groups in portfolio reading order and drops empty groups", () => {
    assert.deepEqual(
      groupProjectsByState(portfolio).map((group) => group.state),
      ["active", "blocked", "incubating", "paused", "completed"],
    );

    const activeOnly = groupProjectsByState(
      portfolio.filter((p) => p.state === "active"),
    );
    assert.deepEqual(
      activeOnly.map((group) => group.state),
      ["active"],
    );
  });

  it("sorts within each group", () => {
    const [active] = groupProjectsByState(portfolio);

    assert.deepEqual(
      active.projects.map((p) => p.slug),
      ["pantry-pilot", "virtara"],
    );
  });

  it("returns no groups for an empty portfolio", () => {
    assert.deepEqual(groupProjectsByState([]), []);
  });
});

describe("counts and filter options", () => {
  it("counts every state", () => {
    const { total, byState } = countProjects(portfolio);

    assert.equal(total, 6);
    assert.deepEqual(byState, {
      active: 2,
      blocked: 1,
      incubating: 1,
      paused: 1,
      completed: 1,
      archived: 0,
    });
  });

  it("reports zero for states nothing is in", () => {
    assert.equal(countProjects([project("a", "active", "high")]).byState.blocked, 0);
  });

  it("only offers filters that would match something", () => {
    const options = buildFilterOptions([
      project("a", "active", "high"),
      project("b", "incubating", "low"),
    ]);

    assert.deepEqual(
      options.map((option) => option.value),
      ["all", "active", "incubating"],
    );
    assert.deepEqual(
      options.map((option) => option.count),
      [2, 1, 1],
    );
  });

  it("offers only 'all' for an empty portfolio", () => {
    assert.deepEqual(
      buildFilterOptions([]).map((option) => option.value),
      ["all"],
    );
  });
});
