import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StructureConnection, StructureSubsystem } from "@shared/structure-types";
import { areaPalette, formatCount, groupConnections, OTHER_AREA_COLOR, placeOf, plural, radiusFor, relationLabel } from "../structure-model";

function subsystem(id: number, area: string, size: number, onMap = true): StructureSubsystem {
  return { id, name: `s${id}`, folder: area, area, kind: "code", size, fileCount: 1, crossLinks: 0, onMap };
}

function connection(relation: string, direction: "out" | "in", id: string): StructureConnection {
  return { relation, direction, inferred: false, other: { id, label: id, subsystem: 0, degree: 0, external: false } };
}

describe("areaPalette", () => {
  it("gives the largest folders a hue and folds the rest into Other", () => {
    const { colorOf, legend } = areaPalette([
      subsystem(0, "server", 50),
      subsystem(1, "src", 40),
      subsystem(2, "shared", 30),
      subsystem(3, "e2e", 20),
      subsystem(4, "scripts", 10),
    ]);
    assert.deepEqual(legend.map((entry) => entry.area), ["server", "src", "shared", "e2e", "Other"]);
    assert.equal(colorOf("scripts"), OTHER_AREA_COLOR);
    assert.notEqual(colorOf("server"), colorOf("src"));
  });

  it("leaves Other out when every folder has its own hue", () => {
    assert.deepEqual(areaPalette([subsystem(0, "src", 5)]).legend.map((entry) => entry.area), ["src"]);
  });

  it("ignores what is not drawn on the map", () => {
    const { colorOf } = areaPalette([subsystem(0, "src", 5), subsystem(1, "docs", 500, false)]);
    assert.equal(colorOf("docs"), OTHER_AREA_COLOR);
  });
});

describe("reading connections", () => {
  it("says a relation in the direction it is read", () => {
    assert.equal(relationLabel("calls", "out"), "Calls");
    assert.equal(relationLabel("calls", "in"), "Called by");
  });

  it("does not hide a relation it has no words for", () => {
    assert.equal(relationLabel("mixes_in", "out"), "Mixes in");
    assert.equal(relationLabel("mixes_in", "in"), "Mixes in (from)");
  });

  it("groups by meaning and keeps the order it was given", () => {
    const groups = groupConnections([connection("calls", "out", "a"), connection("calls", "in", "b"), connection("calls", "out", "c")]);
    assert.deepEqual(groups.map((group) => group.label), ["Calls", "Called by"]);
    assert.deepEqual(groups[0].connections.map((entry) => entry.other.id), ["a", "c"]);
  });

  it("joins a file and a line into one place", () => {
    assert.equal(placeOf("server/a.ts", "L12"), "server/a.ts:12");
    assert.equal(placeOf("server/a.ts", undefined), "server/a.ts");
    assert.equal(placeOf(undefined, "L12"), undefined);
  });
});

describe("drawing and counting", () => {
  it("keeps a radius within a size a pointer can hit, including when empty", () => {
    assert.equal(radiusFor(0, 0), 3.5);
    assert.equal(radiusFor(400, 400), 18);
    assert.equal(radiusFor(9000, 400), 18);
    assert.ok(radiusFor(100, 400) < radiusFor(200, 400));
  });

  it("formats counts and picks the right word", () => {
    assert.equal(formatCount(14065), "14,065");
    assert.equal(plural(1, "file"), "1 file");
    assert.equal(plural(47230, "link"), "47,230 links");
  });
});
