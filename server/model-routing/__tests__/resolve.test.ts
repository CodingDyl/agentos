import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-model-route-"));
process.env.AGENTOS_UI_DIR = directory;

const { resetAiSettingsCache } = await import("../../ai-stack/settings");
const { resolveModelRoute, pickOfferedModel, modelFamily, routeFor } = await import("../resolve");
const { setModelRouting, resetModelRouting } = await import("../settings");

beforeEach(() => {
  fs.rmSync(path.join(directory, "ai-stack.json"), { force: true });
  resetAiSettingsCache();
});

after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("resolveModelRoute", () => {
  it("uses the default table for a tagged Motion job", async () => {
    const route = await resolveModelRoute({
      objective: "anything",
      taggedType: "motion",
    });
    assert.equal(route.taskType, "motion");
    assert.equal(route.model, "claude-opus-5-5");
    assert.equal(route.effort, "high");
    assert.equal(route.source, "tagged");
  });

  it("keeps an explicit model override and still records the type", async () => {
    const route = await resolveModelRoute({
      objective: "Implement the form",
      taggedType: "execute",
      modelOverride: "haiku",
      effort: "low",
    });
    assert.equal(route.taskType, "execute");
    assert.equal(route.model, "haiku");
    assert.equal(route.effort, "low");
  });

  it("honours an edited table", async () => {
    setModelRouting({
      plan: { model: "haiku", effort: "low" },
      execute: { model: "sonnet", effort: "medium" },
      motion: { model: "claude-opus-5-5", effort: "high" },
      normal: { model: "haiku", effort: "low" },
    });
    const route = await resolveModelRoute({ objective: "Plan the rewrite", taggedType: "plan" });
    assert.equal(route.model, "haiku");
    assert.equal(route.effort, "low");
    resetModelRouting();
  });

  it("classifies a free-form request as normal and routes to Haiku", async () => {
    const route = await resolveModelRoute({ objective: "What did we decide about pricing?" });
    assert.equal(route.taskType, "normal");
    assert.equal(route.model, "haiku");
    assert.equal(route.effort, "low");
    assert.equal(route.source, "heuristic");
  });
});

describe("pickOfferedModel", () => {
  const offered = [{ id: "default" }, { id: "opus" }, { id: "sonnet" }, { id: "haiku" }];

  it("keeps an exact match", () => {
    assert.equal(pickOfferedModel(offered, "sonnet", "default"), "sonnet");
  });

  it("maps a full Opus id onto the opus alias", () => {
    assert.equal(pickOfferedModel(offered, "claude-opus-5-5", "default"), "opus");
  });

  it("falls back when nothing in the family is offered", () => {
    assert.equal(pickOfferedModel([{ id: "default" }], "claude-opus-5-5", "default"), "default");
  });
});

describe("modelFamily", () => {
  it("reads aliases and full ids", () => {
    assert.equal(modelFamily("claude-opus-5-5"), "opus");
    assert.equal(modelFamily("sonnet"), "sonnet");
    assert.equal(modelFamily("haiku"), "haiku");
    assert.equal(modelFamily("gpt-5.6"), undefined);
  });
});

describe("routeFor", () => {
  it("returns the default execute assignment", () => {
    assert.deepEqual(routeFor("execute"), { model: "sonnet", effort: "medium" });
  });
});
