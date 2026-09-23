import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectSummary } from "@shared/agentos-types";
import {
  buildActions,
  groupActions,
  scoreAction,
  searchActions,
  type ActionContext,
} from "../workspace-actions";

const projects: ProjectSummary[] = [
  { slug: "pantry-pilot", name: "Pantry Pilot", state: "active", priority: "high", type: "Product" },
  { slug: "jurivo", name: "Jurivo", state: "incubating", priority: "low" },
  { slug: "old-thing", name: "Old Thing", state: "archived", priority: "low" },
];

function context(project?: string): ActionContext & { calls: string[] } {
  const calls: string[] = [];

  return {
    projects,
    project,
    navigate: (to) => calls.push(`nav:${to}`),
    quickCreate: (kind, forProject) => calls.push(`create:${kind}:${forProject ?? "-"}`),
    calls,
  };
}

describe("buildActions", () => {
  it("scopes creation to the project in context", () => {
    const ctx = context("pantry-pilot");
    const actions = buildActions(ctx);

    actions.find((action) => action.id === "create:task")?.run();
    actions.find((action) => action.id === "create:delegate")?.run();

    assert.deepEqual(ctx.calls, [
      "create:task:pantry-pilot",
      "nav:/projects/pantry-pilot?tab=tasks&delegate=1",
    ]);
    assert.match(actions.find((action) => action.id === "create:task")?.hint ?? "", /Pantry Pilot/);
  });

  it("asks for a project when none is in context", () => {
    const ctx = context();
    const actions = buildActions(ctx);

    actions.find((action) => action.id === "create:task")?.run();
    actions.find((action) => action.id === "agent:delegate")?.run();

    assert.deepEqual(ctx.calls, ["create:task:-", "nav:/projects"]);
  });

  it("lists every project under Navigate, active first and archived last", () => {
    const names = buildActions(context())
      .filter((action) => action.id.startsWith("go:/projects/"))
      .map((action) => action.label);

    assert.deepEqual(names, ["Pantry Pilot", "Jurivo", "Old Thing"]);
  });
});

describe("groupActions", () => {
  it("keeps the fixed group order and caps Navigate", () => {
    const groups = groupActions(buildActions(context()), 3);

    assert.deepEqual(groups.map((group) => group.label), ["Create", "Navigate", "Agents"]);
    assert.equal(groups[1].actions.length, 3);
  });
});

describe("searchActions", () => {
  it("ranks label prefixes over substrings over keywords", () => {
    const actions = buildActions(context());
    const results = searchActions(actions, "new").map((action) => action.label);

    assert.deepEqual(results.slice(0, 3), ["New task", "New project", "New decision"]);
  });

  it("finds projects by slug and screens by keyword", () => {
    const actions = buildActions(context());

    assert.equal(searchActions(actions, "pantry-p")[0]?.label, "Pantry Pilot");
    assert.equal(searchActions(actions, "spend")[0]?.label, "Operations");
    assert.equal(scoreAction(actions[0], ""), 0);
    assert.equal(searchActions(actions, "zzz").length, 0);
  });
});
