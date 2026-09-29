import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSendable, projectNamedIn, resolveProject } from "../voice-model";

const projects = [
  { name: "Pantry Pilot", slug: "pantry-pilot" },
  { name: "Vaja Sauna", slug: "vaja-sauna" },
  { name: "Pilot", slug: "pilot" },
];

describe("projectNamedIn", () => {
  it("finds a project by name or slug, ignoring case and punctuation", () => {
    assert.equal(projectNamedIn("Create a task for the Vaja sauna project.", projects), "vaja-sauna");
    assert.equal(projectNamedIn("what should i focus on for pantry-pilot?", projects), "pantry-pilot");
  });

  it("prefers the longer name over a name it contains", () => {
    assert.equal(projectNamedIn("focus on pantry pilot", projects), "pantry-pilot");
  });

  it("refuses to guess when two unrelated projects are named", () => {
    assert.equal(projectNamedIn("compare vaja sauna and pantry pilot", projects), undefined);
  });

  it("returns nothing when no project is named", () => {
    assert.equal(projectNamedIn("Give me my morning brief", projects), undefined);
  });
});

describe("resolveProject", () => {
  it("prefers the spoken project over the page you are on", () => {
    assert.equal(resolveProject("task for vaja sauna", projects, "pantry-pilot"), "vaja-sauna");
  });
  it("falls back to the page context", () => {
    assert.equal(resolveProject("morning brief", projects, "vaja-sauna"), "vaja-sauna");
  });
});

describe("isSendable", () => {
  it("rejects silence and punctuation", () => {
    assert.equal(isSendable("  ... "), false);
    assert.equal(isSendable("hi"), true);
  });
});
