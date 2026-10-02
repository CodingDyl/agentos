import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { VirtecSnapshot } from "../../../shared/virtec-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-business-"));
process.env.AGENTOS_UI_DIR = directory;

const store = await import("../store");
const { buildBusiness, monthlyEquivalent } = await import("../business");

const businessDir = path.join(directory, "business");

beforeEach(() => {
  fs.rmSync(businessDir, { recursive: true, force: true });
});

after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const snapshot: VirtecSnapshot = {
  configured: true,
  fetchedAt: "2026-10-02T08:00:00.000Z",
  sources: {},
  leads: [],
  inbound: [],
  clients: [
    { id: "c1", name: "Ada", companyName: "Ada Law", maintenance: true, active: true, totalSpent: 1000 },
    { id: "c2", name: "Bo", active: false },
  ],
  quotes: [
    { id: "q1", clientId: "c1", status: "pending", totalAmount: 500, features: [] },
    { id: "q2", clientId: "c1", status: "accepted", totalAmount: 900, features: [] },
  ],
  projects: [
    { id: "p1", clientId: "c1", status: "active" },
    { id: "p2", clientId: "c1", status: "Completed" },
  ],
  followUps: [
    { id: "f1", customerId: "c1", status: "open" },
    { id: "f2", customerId: "c1", status: "dismissed" },
  ],
} as unknown as VirtecSnapshot;

describe("business store", () => {
  it("starts with Virtec, Pantry Pilot and Voxmachine", async () => {
    const state = await store.readBusinessState();
    assert.deepEqual(state.entities.map((entity) => entity.id), ["virtec", "pantry-pilot", "voxmachine"]);
  });

  it("refuses a corrupt record rather than starting over", async () => {
    fs.mkdirSync(businessDir, { recursive: true });
    fs.writeFileSync(path.join(businessDir, "state.json"), "{ nope");
    await assert.rejects(store.readBusinessState());
  });

  it("links and unlinks a client's workspace", async () => {
    await store.setClientWorkspace("c1", "acme-site");
    assert.equal((await store.readBusinessState()).clientWorkspaces.c1, "acme-site");
    await store.setClientWorkspace("c1", null);
    assert.equal((await store.readBusinessState()).clientWorkspaces.c1, undefined);
  });

  it("rejects an unknown business and de-duplicates workspaces", async () => {
    await assert.rejects(store.setEntityWorkspaces("nope", []), store.BusinessNotFoundError);
    const entity = await store.setEntityWorkspaces("virtec", ["a", "a", "b"]);
    assert.deepEqual(entity.workspaces, ["a", "b"]);
  });
});

describe("buildBusiness", () => {
  it("rolls projects, quotes and follow-ups up per client", async () => {
    const state = await store.readBusinessState();
    state.clientWorkspaces.c1 = "ada-site";
    const data = buildBusiness(snapshot, state, false);

    const ada = data.clients.find((client) => client.id === "c1");
    assert.equal(ada?.activeProjectCount, 1, "a Completed project is not live work");
    assert.equal(ada?.pendingQuoteValue, 500, "only pending quotes count");
    assert.equal(ada?.openFollowUps, 1);
    assert.equal(ada?.workspace, "ada-site");
    assert.equal(data.clients.find((client) => client.id === "c2")?.active, false);
  });

  it("attributes Virtec clients to Virtec only", async () => {
    const data = buildBusiness(snapshot, await store.readBusinessState(), true);
    const byId = Object.fromEntries(data.entities.map((entity) => [entity.id, entity]));
    assert.equal(byId.virtec.clientCount, 2);
    assert.equal(byId.virtec.maintenanceClientCount, 1);
    assert.equal(byId["pantry-pilot"].clientCount, 0);
    assert.equal(data.virtecWritable, true);
  });

  it("is empty, not broken, when Virtec is not configured", async () => {
    const data = buildBusiness({ configured: false, leads: [], inbound: [], clients: [], quotes: [], projects: [], followUps: [] }, await store.readBusinessState(), false);
    assert.equal(data.virtecConfigured, false);
    assert.equal(data.clients.length, 0);
  });

  it("reports which Virtec sources failed", async () => {
    const data = buildBusiness({ ...snapshot, sources: { quotes: { ok: false, error: "x", skipped: 0 } } } as unknown as VirtecSnapshot, await store.readBusinessState(), false);
    assert.match(data.virtecProblem ?? "", /quotes/);
  });
});

describe("buildBusiness: stage 2 views", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  const rich = {
    configured: true,
    sources: {},
    leads: [],
    inbound: [],
    clients: [{ id: "c1", name: "Ada", companyName: "Ada Law" }],
    quotes: [
      { id: "old", clientId: "c1", status: "pending", totalAmount: 500, createdAt: "2026-10-01T00:00:00.000Z", features: [] },
      { id: "new", clientId: "c1", status: "pending", totalAmount: 100, createdAt: "2026-10-09T00:00:00.000Z", features: [] },
      { id: "won", clientId: "c1", status: "accepted", totalAmount: 900, createdAt: "2026-09-01T00:00:00.000Z", features: [] },
      { id: "undated", clientId: "gone", status: "pending", features: [] },
    ],
    projects: [
      { id: "p1", clientId: "c1", status: "active", agreementStatus: "pending", maintenanceFrequency: "quarterly", maintenanceAmount: 3000 },
      { id: "p2", clientId: "c1", status: "completed", maintenanceFrequency: "monthly", maintenanceAmount: 999 },
      { id: "p3", clientName: "Cash Client", status: "active", maintenanceFrequency: "ad-hoc", maintenanceAmount: 800 },
    ],
    followUps: [
      { id: "late", customerId: "c1", status: "open", dueAt: "2026-10-05T00:00:00.000Z" },
      { id: "soon", customerId: "c1", status: "open", dueAt: "2026-10-20T00:00:00.000Z" },
      { id: "woke", customerId: "c1", status: "snoozed", snoozedUntil: "2026-10-09T00:00:00.000Z", dueAt: "2026-10-01T00:00:00.000Z" },
      { id: "asleep", customerId: "c1", status: "snoozed", snoozedUntil: "2026-10-15T00:00:00.000Z" },
      { id: "done", customerId: "c1", status: "sent" },
    ],
  } as unknown as VirtecSnapshot;

  it("flags only week-old pending quotes as stale, and puts them first", async () => {
    const { quotes } = buildBusiness(rich, await store.readBusinessState(), false, now);
    assert.deepEqual(quotes.map((quote) => quote.id)[0], "old");
    assert.equal(quotes.find((quote) => quote.id === "old")?.stale, true);
    assert.equal(quotes.find((quote) => quote.id === "new")?.stale, false);
    assert.equal(quotes.find((quote) => quote.id === "won")?.stale, false, "an accepted quote is never stale");
    const undated = quotes.find((quote) => quote.id === "undated");
    assert.equal(undated?.ageDays, undefined);
    assert.equal(undated?.stale, false);
    assert.equal(undated?.clientName, "Unknown client");
  });

  it("lists agreements and live retainers, valuing them per month", async () => {
    const data = buildBusiness(rich, await store.readBusinessState(), false, now);
    assert.deepEqual(data.agreements.map((agreement) => [agreement.projectId, agreement.status]), [["p1", "pending"]]);
    assert.deepEqual(data.retainers.map((retainer) => [retainer.projectId, retainer.monthlyEquivalent]), [["p1", 1000], ["p3", 0]]);
    assert.equal(data.retainers.find((retainer) => retainer.projectId === "p3")?.clientName, "Cash Client");
    assert.equal(monthlyEquivalent("annual", 1200), 100);
    assert.equal(monthlyEquivalent("weird", 50), 0);
  });

  it("shows open and woken follow-ups, overdue first", async () => {
    const { followUps } = buildBusiness(rich, await store.readBusinessState(), false, now);
    assert.deepEqual(followUps.map((followUp) => followUp.id), ["woke", "late", "soon"]);
    assert.equal(followUps.find((followUp) => followUp.id === "soon")?.overdue, false);
    assert.equal(followUps.find((followUp) => followUp.id === "late")?.overdue, true);
  });
});
