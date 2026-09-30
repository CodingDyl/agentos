import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConnectorSummary } from "@shared/connector-types";
import { capabilityCounts, formatWhen, groupConnectors, statusLabel, switchNote } from "../connectors-model";

function connector(overrides: Partial<ConnectorSummary>): ConnectorSummary {
  return {
    id: "x",
    name: "X",
    description: "",
    category: "development",
    tier: 1,
    icon: "plug",
    status: "connected",
    enabled: true,
    enabledSource: "connectors",
    capabilityCount: 1,
    implementedCount: 1,
    ...overrides,
  };
}

describe("the Connectors screen", () => {
  it("never reads a failing connector as connected", () => {
    assert.equal(statusLabel("error"), "Error");
    assert.equal(statusLabel("unavailable"), "No adapter");
  });

  it("puts set-up connectors in the grid, errors first, and adapters before wishes below", () => {
    const { setUp, available } = groupConnectors([
      connector({ id: "vercel", name: "Vercel", tier: 1 }),
      connector({ id: "gmail", name: "Gmail", tier: 2, status: "error" }),
      connector({ id: "sentry", name: "Sentry", tier: 3, status: "unavailable" }),
      connector({ id: "github", name: "GitHub", tier: 1, status: "disconnected" }),
      connector({ id: "figma", name: "Figma", tier: 5, status: "unavailable" }),
    ]);

    assert.deepEqual(setUp.map((entry) => entry.id), ["gmail", "vercel"]);
    assert.deepEqual(available.map((entry) => entry.id), ["github", "sentry", "figma"]);
  });

  it("keeps connected and enabled apart", () => {
    const off = connector({ enabled: false });
    assert.equal(groupConnectors([off]).setUp.length, 1);
  });

  it("explains a switch that isn't only this page's", () => {
    assert.match(switchNote(connector({ enabledSource: "ai-stack" })) ?? "", /AI stack/);
    assert.match(switchNote(connector({ enabledSource: "required", name: "Local filesystem" })) ?? "", /can't be switched off/);
    assert.equal(switchNote(connector({})), undefined);
  });

  it("counts capabilities by policy and by whether they're built", () => {
    const base = { name: "", risk: "read" as const, defaultPolicy: "allowed" as const, policyOverridden: false, available: true };
    const counts = capabilityCounts([
      { ...base, id: "a", policy: "allowed", implemented: true },
      { ...base, id: "b", policy: "approval", implemented: false },
      { ...base, id: "c", policy: "disabled", implemented: false },
    ]);
    assert.deepEqual(counts, { allowed: 1, approval: 1, disabled: 1, built: 1 });
  });

  it("formats a use as a time today and a date further back", () => {
    const now = new Date("2026-09-30T18:00:00");
    assert.equal(formatWhen(new Date("2026-09-30T16:42:00").toISOString(), now), "16:42");
    assert.match(formatWhen(new Date("2026-09-03T09:00:00").toISOString(), now), /^3 Sep/);
    assert.equal(formatWhen(undefined, now), "Never");
  });
});
