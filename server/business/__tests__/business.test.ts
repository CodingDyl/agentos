import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { VirtecSnapshot } from "../../../shared/virtec-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-business-"));
process.env.AGENTOS_UI_DIR = directory;

const store = await import("../store");
const { buildBusiness } = await import("../business");

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
