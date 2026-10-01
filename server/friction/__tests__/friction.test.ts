import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageNameForRoute, type FrictionItem } from "../../../shared/friction-types";
import { frictionPriority, rankFriction } from "../ranking";
import { readFriction, reportFriction, updateFrictionStatus } from "../store";

const item = (overrides: Partial<FrictionItem>): FrictionItem => ({
  id: "x",
  description: "x",
  frequency: "once",
  severity: "low",
  status: "open",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

describe("friction ranking", () => {
  it("is frequency × severity", () => {
    assert.equal(frictionPriority({ frequency: "often", severity: "high" }), 9);
    assert.equal(frictionPriority({ frequency: "often", severity: "medium" }), 6);
    assert.equal(frictionPriority({ frequency: "sometimes", severity: "low" }), 2);
  });

  it("sorts open items deterministically and keeps closed ones apart", () => {
    const ranked = rankFriction([
      item({ id: "nav", description: "Document navigation feels awkward", frequency: "sometimes", severity: "low" }),
      item({ id: "memory", description: "Memory editing", frequency: "often", severity: "medium" }),
      item({ id: "closeout", description: "Task completion loses useful knowledge", frequency: "often", severity: "high" }),
      item({ id: "fixed", frequency: "often", severity: "high", status: "fixed", updatedAt: "2026-10-02T00:00:00.000Z" }),
    ]);
    assert.deepEqual(ranked.open.map((entry) => entry.id), ["closeout", "memory", "nav"]);
    assert.deepEqual(ranked.open.map((entry) => entry.tier), ["high", "high", "low"]);
    assert.deepEqual(ranked.closed.map((entry) => entry.id), ["fixed"]);
  });

  it("breaks ties on severity, then the newer report", () => {
    const ranked = rankFriction([
      item({ id: "a", frequency: "often", severity: "medium", createdAt: "2026-10-01T00:00:00.000Z" }),
      item({ id: "b", frequency: "sometimes", severity: "high", createdAt: "2026-09-01T00:00:00.000Z" }),
      item({ id: "c", frequency: "often", severity: "medium", createdAt: "2026-10-03T00:00:00.000Z" }),
    ]);
    assert.deepEqual(ranked.open.map((entry) => entry.id), ["b", "c", "a"]);
  });

  it("names the page a route belongs to", () => {
    assert.equal(pageNameForRoute("/memory?note=x"), "Memory");
    assert.equal(pageNameForRoute("/"), "Today");
    assert.equal(pageNameForRoute(undefined), undefined);
  });
});

describe("friction store", () => {
  it("persists reports and status changes, and keeps only in-app paths", async () => {
    const saved = await reportFriction({ description: "I can't edit existing memory.", route: "/memory", frequency: "often", severity: "medium" });
    const external = await reportFriction({ description: "Something else", route: "https://evil.example/?token=1", frequency: "once", severity: "low" });
    assert.equal(saved.status, "open");
    assert.equal(external.route, undefined);

    await updateFrictionStatus(saved.id, "fixed");
    const items = await readFriction();
    assert.equal(items.find((entry) => entry.id === saved.id)?.status, "fixed");
    assert.equal(await updateFrictionStatus("missing", "fixed"), undefined);
  });
});
