import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BusinessClient, BusinessData, BusinessEntitySummary } from "../../../../shared/business-types";
import { buildGrowth } from "../business-growth";

const entity: BusinessEntitySummary = { id: "virtec", name: "Virtec", kind: "agency", source: "virtec", workspaces: [], clientCount: 0, activeProjectCount: 0, pendingQuoteValue: 0, maintenanceClientCount: 0 };

function client(id: string, extra: Partial<BusinessClient> = {}): BusinessClient {
  return { id, entityId: "virtec", name: id, active: true, maintenance: false, totalSpent: 0, projects: [], quotes: [], activeProjectCount: 0, pendingQuoteValue: 0, openFollowUps: 0, mail: [], ...extra };
}

const data: BusinessData = {
  virtecConfigured: true,
  virtecWritable: false,
  entities: [entity],
  clients: [
    client("big", { totalSpent: 800, maintenance: true, projects: [{ id: "p" }] }),
    client("done", { totalSpent: 150, projects: [{ id: "p2", status: "completed" }] }),
    client("busy", { totalSpent: 50, projects: [{ id: "p3" }], activeProjectCount: 1 }),
    client("gone", { active: false, totalSpent: 0, projects: [{ id: "p4" }] }),
    client("other", { entityId: "voxmachine", totalSpent: 99999 }),
  ],
  quotes: [
    { id: "q1", entityId: "virtec", clientName: "x", status: "accepted", totalAmount: 1000, stale: false, kind: "project" },
    { id: "q2", entityId: "virtec", clientName: "x", status: "accepted", totalAmount: 3000, stale: false, kind: "project" },
    { id: "q4", entityId: "virtec", clientName: "x", status: "accepted", totalAmount: 50, stale: false, kind: "maintenance" },
    { id: "q3", entityId: "virtec", clientName: "x", status: "pending", totalAmount: 500, stale: true, kind: "project" },
  ],
  agreements: [{ projectId: "p3", entityId: "virtec", clientName: "busy", status: "pending" }],
  retainers: [
    { projectId: "r1", entityId: "virtec", clientId: "big", clientName: "Big", frequency: "monthly", amount: 3000, monthlyEquivalent: 3000 },
    { projectId: "r2", entityId: "virtec", clientId: "busy", clientName: "Busy", frequency: "annual", amount: 12000, monthlyEquivalent: 1000 },
  ],
  followUps: [],
};

describe("buildGrowth", () => {
  const growth = buildGrowth(data, entity);

  it("measures recurring revenue and concentration within the business only", () => {
    assert.equal(growth.recurringMonthly, 4000);
    assert.equal(growth.largestClient?.client.id, "big");
    assert.equal(growth.largestClient?.share, 0.8, "another business's client never counts");
    assert.equal(growth.largestRetainer?.share, 0.75);
    assert.equal(growth.retainerShare, 2 / 3);
    assert.equal(growth.averageAcceptedQuote, 2000, "maintenance charges are not build prices");
  });

  it("offers a care plan only to active, finished, unretained clients", () => {
    assert.deepEqual(growth.upsell.map((entry) => entry.id), ["done"]);
  });

  it("lists only checks with something waiting", () => {
    assert.deepEqual(growth.checklist.map((check) => [check.id, check.count]), [["stale", 1], ["agreements", 1], ["upsell", 1], ["unlinked", 1]]);
  });
});
