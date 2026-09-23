import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCategory, readScope, readSkill, readSkillName, readSkills } from "../skills";

/**
 * Skill discovery must survive Hermes changing how it describes a skill.
 *
 * The payload shape is not contractual, so an unfamiliar entry is dropped and
 * the rest of the list still reaches the console — a renamed field must never
 * empty the command palette.
 */

describe("skill names", () => {
  it("strips a leading slash", () => {
    assert.equal(readSkillName("/start-day"), "start-day");
  });

  it("normalises snake_case and camelCase to one spelling", () => {
    assert.equal(readSkillName("start_day"), "start-day");
    assert.equal(readSkillName("startDay"), "start-day");
    assert.equal(readSkillName("Start Day"), "start-day");
  });

  it("rejects anything that cannot be named", () => {
    assert.equal(readSkillName(""), undefined);
    assert.equal(readSkillName("///"), undefined);
    assert.equal(readSkillName(42), undefined);
  });
});

describe("reading one skill", () => {
  it("reads a plain name from a list of strings", () => {
    assert.deepEqual(readSkill("capture"), {
      name: "capture",
      command: "/capture",
      category: "Daily",
      scope: "workspace",
    });
  });

  it("reads name and description from an object", () => {
    const skill = readSkill({
      name: "start-day",
      description: "Plan today's priorities",
    });

    assert.equal(skill?.command, "/start-day");
    assert.equal(skill?.description, "Plan today's priorities");
  });

  it("accepts the field names Hermes might use", () => {
    assert.equal(readSkill({ id: "capture", summary: "Capture an idea" })?.name, "capture");
    assert.equal(readSkill({ command: "/dashboard" })?.name, "dashboard");
    assert.equal(readSkill({ skill: "end-day", help: "Wrap up" })?.description, "Wrap up");
  });

  it("drops an entry with no usable name", () => {
    assert.equal(readSkill({ description: "No name here" }), undefined);
    assert.equal(readSkill(null), undefined);
  });
});

describe("categories", () => {
  it("prefers the category Hermes declares", () => {
    assert.equal(readCategory({ category: "weekly_ritual" }, "capture"), "Weekly ritual");
  });

  it("falls back to the first tag", () => {
    assert.equal(readCategory({ tags: ["review", "slow"] }, "capture"), "Review");
  });

  it("reads a category from the name when Hermes gives none", () => {
    assert.equal(readCategory({}, "start-day"), "Daily");
    assert.equal(readCategory({}, "project-sync"), "Project");
    assert.equal(readCategory({}, "weekly-review"), "Review");
    assert.equal(readCategory({}, "memory-hygiene"), "System");
    assert.equal(readCategory({}, "system-health"), "System");
  });

  it("still groups a skill it does not recognise", () => {
    assert.equal(readCategory({}, "something-new"), "Skills");
  });
});

describe("scope", () => {
  it("reads a declared project parameter", () => {
    assert.equal(readScope({ parameters: [{ name: "project" }] }, "anything"), "project");
    assert.equal(readScope({ args: ["project"] }, "anything"), "project");
    assert.equal(readScope({ params: { project: "slug" } }, "anything"), "project");
  });

  it("knows the project skills by name", () => {
    assert.equal(readScope({}, "work-on"), "project");
    assert.equal(readScope({}, "stop-work"), "project");
  });

  it("treats a new `project-` skill as project scoped", () => {
    assert.equal(readScope({}, "project-update"), "project");
  });

  it("defaults to workspace scope", () => {
    assert.equal(readScope({}, "start-day"), "workspace");
    assert.equal(readScope({ parameters: [{ name: "note" }] }, "capture"), "workspace");
  });
});

describe("reading a skills list", () => {
  it("reads a bare array", () => {
    assert.deepEqual(
      readSkills(["capture", "start-day"]).map((skill) => skill.command),
      ["/capture", "/start-day"],
    );
  });

  it("reads a wrapped collection, whatever the key", () => {
    for (const key of ["skills", "data", "items", "results", "commands"]) {
      assert.equal(readSkills({ [key]: ["capture"] }).length, 1, key);
    }
  });

  it("reads skills keyed by name", () => {
    const skills = readSkills({
      skills: { "start-day": { description: "Plan today" } },
    });

    assert.equal(skills[0]?.name, "start-day");
    assert.equal(skills[0]?.description, "Plan today");
  });

  it("collapses two spellings of the same skill", () => {
    assert.equal(readSkills(["start-day", "startDay", "/start_day"]).length, 1);
  });

  it("keeps the readable skills when one entry is unreadable", () => {
    const skills = readSkills(["capture", { nope: true }, null, "start-day"]);

    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["capture", "start-day"],
    );
  });

  it("returns nothing for an unfamiliar payload", () => {
    assert.deepEqual(readSkills({ unexpected: "shape" }), []);
    assert.deepEqual(readSkills(null), []);
  });

  it("sorts by name so the palette order is stable", () => {
    assert.deepEqual(
      readSkills(["work-on", "capture", "dashboard"]).map((skill) => skill.name),
      ["capture", "dashboard", "work-on"],
    );
  });
});
