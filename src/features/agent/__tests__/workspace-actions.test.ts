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
    actions.find((action) => action.id === "work:delegate")?.run();
    actions.find((action) => action.id === "create:document")?.run();

    assert.deepEqual(ctx.calls, [
      "create:task:pantry-pilot",
      "nav:/workspaces/pantry-pilot?tab=tasks&delegate=1",
      "create:document:pantry-pilot",
    ]);
    assert.match(actions.find((action) => action.id === "create:task")?.hint ?? "", /Pantry Pilot/);
  });

  it("asks for a project when none is in context", () => {
    const ctx = context();
    const actions = buildActions(ctx);

    actions.find((action) => action.id === "create:task")?.run();
    actions.find((action) => action.id === "work:delegate")?.run();

    assert.deepEqual(ctx.calls, ["create:task:-", "nav:/workspaces"]);
  });

  it("starts focus on the workspace in context, or the day without one", () => {
    const scoped = context("pantry-pilot");
    buildActions(scoped).find((action) => action.id === "work:focus")?.run();
    const unscoped = context();
    buildActions(unscoped).find((action) => action.id === "work:focus")?.run();

    assert.deepEqual(scoped.calls, ["nav:/agent?project=pantry-pilot&run=%2Fwork-on%20pantry-pilot"]);
    assert.deepEqual(unscoped.calls, ["nav:/agent?run=%2Fstart-day"]);
  });

  it("lists every workspace under Navigate, active first and archived last", () => {
    const names = buildActions(context())
      .filter((action) => action.id.startsWith("go:/workspaces/"))
      .map((action) => action.label);

    assert.deepEqual(names, ["Pantry Pilot", "Jurivo", "Old Thing"]);
  });

  it("ranks recently opened workspaces first", () => {
    const names = buildActions({ ...context(), recent: ["old-thing", "jurivo"] })
      .filter((action) => action.id.startsWith("go:/workspaces/"))
      .map((action) => action.label);

    assert.deepEqual(names, ["Old Thing", "Jurivo", "Pantry Pilot"]);
  });
});

describe("groupActions", () => {
  it("keeps the fixed group order and caps Navigate", () => {
    const groups = groupActions(buildActions(context()), 3);

    assert.deepEqual(groups.map((group) => group.label), ["Create", "Work", "Navigate"]);
    assert.equal(groups[2].actions.length, 3);
  });
});

describe("searchActions", () => {
  it("ranks label prefixes over substrings over keywords", () => {
    const actions = buildActions(context());
    const results = searchActions(actions, "new").map((action) => action.label);

    assert.deepEqual(results.slice(0, 4), ["New task", "New document", "New workspace", "New milestone"]);
  });

  it("finds projects by slug and screens by keyword", () => {
    const actions = buildActions(context());

    assert.equal(searchActions(actions, "pantry-p")[0]?.label, "Pantry Pilot");
    assert.equal(searchActions(actions, "spend")[0]?.label, "Operations");
    assert.equal(scoreAction(actions[0], ""), 0);
    assert.equal(searchActions(actions, "zzz").length, 0);
  });
});

describe("report friction", () => {
  it("is offered under Work when the shell can open the form, and opens it", () => {
    let opened = 0;
    const actions = buildActions({ ...context(), reportFriction: () => (opened += 1) });
    const action = actions.find((entry) => entry.id === "work:friction");
    assert.equal(action?.group, "Work");
    action?.run();
    assert.equal(opened, 1);
    assert.deepEqual(searchActions(actions, "friction").map((entry) => entry.id), ["go:/operations?tab=friction", "work:friction"]);
  });

  it("is not offered without a form to open", () => {
    assert.equal(buildActions(context()).some((entry) => entry.id === "work:friction"), false);
  });
});
