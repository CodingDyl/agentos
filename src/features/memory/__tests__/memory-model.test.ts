import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryGraphNode } from "../../../../shared/memory-types";
import { buildLegend, GROUP_COLORS, groupOf, noteColor, nodeRadius, OTHER_COLOR } from "../memory-model";

const node = (id: string, folder: string, tags: string[] = [], unresolved = false): MemoryGraphNode => ({
  id,
  title: id,
  folder,
  tags,
  degree: 0,
  unresolved,
});

describe("memory graph model", () => {
  it("groups by top-level folder or first tag", () => {
    assert.equal(groupOf(node("a", "projects/alpha"), "folder"), "projects");
    assert.equal(groupOf(node("a", "", ["x", "y"]), "tag"), "x");
    assert.equal(groupOf(node("a", "projects", [], true), "folder"), "");
  });

  it("gives the biggest groups named colours and pools the rest as other", () => {
    const nodes = Array.from({ length: 10 }, (_, group) =>
      Array.from({ length: 10 - group }, (_, n) => node(`g${group}-${n}`, `f${group}`)),
    ).flat();
    const legend = buildLegend(nodes, "folder");
    assert.equal(legend.entries[0].group, "f0");
    assert.equal(legend.entries[0].color, GROUP_COLORS[0]);
    assert.equal(legend.entries.length, GROUP_COLORS.length);
    assert.equal(legend.colors.get("f9"), OTHER_COLOR);
    assert.equal(legend.other, 3 + 2 + 1);
  });

  it("caps hub sizes", () => {
    assert.equal(nodeRadius(0), 3);
    assert.ok(nodeRadius(4) < nodeRadius(9));
    assert.equal(nodeRadius(10_000), 10);
  });

  it("gives each note a stable colour of its own", () => {
    assert.equal(noteColor("projects/a/PROJECT.md"), noteColor("projects/a/PROJECT.md"));
    assert.notEqual(noteColor("projects/a/PROJECT.md"), noteColor("projects/b/PROJECT.md"));
    assert.match(noteColor("x.md"), /^hsl\(\d+ \d+% \d+%\)$/);
  });
});
