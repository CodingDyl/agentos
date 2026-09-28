import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KnowledgeItem } from "@shared/agentos-types";
import { filterKnowledge, type KnowledgeFilters } from "../knowledge-model";

const now = new Date("2026-09-25T12:00:00Z");

const items: KnowledgeItem[] = [
  {
    id: "a",
    kind: "document",
    title: "Chef UX Analysis",
    project: "pantry-pilot",
    projectName: "Pantry Pilot",
    type: "research",
    source: "hermes",
    updatedAt: "2026-09-24T09:00:00Z",
    href: "/workspaces/pantry-pilot?tab=documents",
  },
  {
    id: "b",
    kind: "document",
    title: "Vaja Architecture",
    project: "virtara",
    projectName: "Virtara",
    type: "spec",
    source: "claude",
    taskId: "VA-018",
    updatedAt: "2026-08-01T09:00:00Z",
    href: "/workspaces/virtara?tab=documents",
  },
  {
    id: "c",
    kind: "decision",
    title: "Pricing",
    project: "virtara",
    projectName: "Virtara",
    type: "decision",
    detail: "Fixed-price quotes only.",
    href: "/workspaces/virtara?tab=decisions",
  },
];

const none: KnowledgeFilters = { query: "", workspace: "all", type: "all", creator: "all", when: "any" };

describe("filterKnowledge", () => {
  it("returns everything with no filters", () => {
    assert.equal(filterKnowledge(items, none, now).length, 3);
  });

  it("filters by workspace, type and creator", () => {
    assert.deepEqual(filterKnowledge(items, { ...none, workspace: "virtara" }, now).map((item) => item.id), ["b", "c"]);
    assert.deepEqual(filterKnowledge(items, { ...none, type: "decision" }, now).map((item) => item.id), ["c"]);
    assert.deepEqual(filterKnowledge(items, { ...none, creator: "claude" }, now).map((item) => item.id), ["b"]);
  });

  it("filters by date, dropping undated items from a dated view", () => {
    assert.deepEqual(filterKnowledge(items, { ...none, when: "7d" }, now).map((item) => item.id), ["a"]);
  });

  it("searches titles, details, workspaces and task ids", () => {
    assert.deepEqual(filterKnowledge(items, { ...none, query: "fixed-price" }, now).map((item) => item.id), ["c"]);
    assert.deepEqual(filterKnowledge(items, { ...none, query: "va-018" }, now).map((item) => item.id), ["b"]);
    assert.deepEqual(filterKnowledge(items, { ...none, query: "pantry" }, now).map((item) => item.id), ["a"]);
  });
});
