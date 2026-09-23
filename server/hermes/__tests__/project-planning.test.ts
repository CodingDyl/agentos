import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlanningPacket,
  fallbackProjectPlan,
  readProjectPlan,
} from "../project-planning";

describe("readProjectPlan", () => {
  it("reads a fenced JSON reply, defaulting task sections", () => {
    const plan = readProjectPlan(`Here is the plan.

\`\`\`json
{
  "name": "Listing Writer",
  "goal": "Generate listing copy for agents.",
  "scope": ["Copy generation", "Not: CRM"],
  "milestones": ["Prompt works", "Web form"],
  "initialTasks": [
    { "title": "Set up repo", "section": "now" },
    "Write the prompt",
    { "title": "Bad section", "section": "someday" }
  ],
  "risks": ["Quality varies"]
}
\`\`\``);

    assert.ok(plan);
    assert.equal(plan.slug, "listing-writer");
    assert.equal(plan.plannedBy, "hermes");
    assert.deepEqual(plan.initialTasks, [
      { title: "Set up repo", section: "now" },
      { title: "Write the prompt", section: "later" },
      { title: "Bad section", section: "later" },
    ]);
    assert.deepEqual(plan.scope, ["Copy generation", "Not: CRM"]);
  });

  it("returns nothing without a name", () => {
    assert.equal(readProjectPlan('{"goal": "x"}'), undefined);
    assert.equal(readProjectPlan("no json here"), undefined);
  });
});

describe("fallbackProjectPlan", () => {
  it("names the project from the brief and says it is thin", () => {
    const plan = fallbackProjectPlan("Property listing generator for estate agents.\nMore detail.");

    assert.equal(plan.name, "Property listing generator for estate");
    assert.equal(plan.slug, "property-listing-generator-for-estate");
    assert.equal(plan.plannedBy, "agentos");
    assert.match(plan.goal, /More detail/);
  });
});

describe("buildPlanningPacket", () => {
  it("carries the brief and asks for JSON", () => {
    const packet = buildPlanningPacket("  Make a thing.  ");

    assert.match(packet, /--- BRIEF ---\nMake a thing\./);
    assert.match(packet, /"initialTasks"/);
  });
});

describe("readMilestonePlan", () => {
  it("strips invented ids from proposed tasks and reads the planning check", async () => {
    const { readMilestonePlan, stripInventedId } = await import("../milestone-planning");

    assert.equal(stripInventedId("[PP-011] Design the beta programme"), "Design the beta programme");
    assert.equal(stripInventedId("PP-012: Add monitoring"), "Add monitoring");
    assert.equal(stripInventedId("Plain title"), "Plain title");

    const plan = readMilestonePlan(
      JSON.stringify({
        criteria: ["Beta testers rate Chef 4+"],
        tasks: [{ title: "[PP-005] Implement retry", section: "now", after: ["PP-003"] }, "Bare task"],
        risks: ["Quality"],
        dependencies: [],
        uncovered: [{ outcome: "Users know Chef is generating", suggestedTask: "[PP-013] Add a generating state" }],
      }),
      "chef-experience",
    );

    assert.ok(plan);
    assert.equal(plan.tasks[0].title, "Implement retry");
    assert.deepEqual(plan.tasks[0].after, ["PP-003"]);
    assert.equal(plan.tasks[1].section, "later");
    assert.equal(plan.uncovered[0].suggestedTask, "Add a generating state");
    assert.equal(plan.plannedBy, "hermes");
  });
});
