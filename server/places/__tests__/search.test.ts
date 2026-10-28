import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import express from "express";

process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-places-"));

const { PlacesError } = await import("../client");
const { placesRouter } = await import("../routes");
const { runSearch } = await import("../search");
const { monthlyCap, placesBudget, reserveRequests } = await import("../usage");
const { setConnectorEnabled } = await import("../../connectors/policy");

const realFetch = globalThis.fetch;
const usageFile = () => path.join(process.env.AGENTOS_UI_DIR as string, "places-usage.json");

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "k";
  process.env.AGENTOS_PLACES_MONTHLY_REQUEST_CAP = "10";
  fs.rmSync(usageFile(), { force: true });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.AGENTOS_PLACES_MONTHLY_REQUEST_CAP;
  setConnectorEnabled("googleplaces", true);
});

/** A Google that answers every request with one dentist near Sandton, and counts the requests. */
function google() {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls += 1;
    return new Response(
      JSON.stringify({
        places: [{ id: "p1", displayName: { text: "Smile Dental" }, location: { latitude: -26.1076, longitude: 28.0567 }, businessStatus: "OPERATIONAL" }],
      }),
    );
  }) as typeof fetch;
  return state;
}

const request = { area: "Sandton", nicheId: "dentists", radiusKm: 10 };

describe("the monthly cap", () => {
  it("reads a whole number from 1 to 5000, and treats anything else as unset", () => {
    for (const [value, cap] of [["200", 200], ["9999", 5000], ["0", 0], ["-5", 0], ["abc", 0], ["", 0]] as const) {
      process.env.AGENTOS_PLACES_MONTHLY_REQUEST_CAP = value;
      assert.equal(monthlyCap(), cap, value);
    }
  });

  it("counts reserved requests and stops at the cap, counting nothing on a refusal", () => {
    assert.equal(reserveRequests(4).remaining, 6);
    assert.equal(reserveRequests(6).remaining, 0);
    assert.throws(() => reserveRequests(1), (e: unknown) => e instanceof PlacesError && e.reason === "quota");
    assert.equal(placesBudget().used, 10);
  });

  it("refuses when no cap is set", () => {
    delete process.env.AGENTOS_PLACES_MONTHLY_REQUEST_CAP;
    assert.throws(() => reserveRequests(1), (e: unknown) => e instanceof PlacesError && e.reason === "no-cap");
    assert.equal(placesBudget().used, 0);
  });

  it("starts a new month at zero and survives a damaged file", () => {
    reserveRequests(3, new Date("2026-10-31T23:00:00Z"));
    assert.equal(placesBudget(new Date("2026-10-31T23:30:00Z")).used, 3);
    assert.equal(placesBudget(new Date("2026-11-01T00:30:00Z")).used, 0);
    fs.writeFileSync(usageFile(), "{not json");
    assert.equal(placesBudget().used, 0);
  });
});

describe("runSearch", () => {
  it("spends the requests it makes and reports the budget", async () => {
    const state = google();
    const { result, budget } = await runSearch(request);
    assert.equal(state.calls, 2);
    assert.equal(result.candidates.length, 1);
    assert.deepEqual({ used: budget.used, remaining: budget.remaining }, { used: 2, remaining: 8 });
  });

  it("spends nothing on a bad request, a switched-off connector, or a spent cap", async () => {
    const state = google();

    await assert.rejects(runSearch({ ...request, radiusKm: 99 }), (e: unknown) => e instanceof PlacesError && e.reason === "invalid");

    setConnectorEnabled("googleplaces", false);
    await assert.rejects(runSearch(request), (e: unknown) => e instanceof PlacesError && e.reason === "off");
    setConnectorEnabled("googleplaces", true);

    reserveRequests(9);
    await assert.rejects(runSearch(request), (e: unknown) => e instanceof PlacesError && e.reason === "quota");

    assert.equal(state.calls, 0);
    assert.equal(placesBudget().used, 9);
  });

  it("still counts a search whose Google call fails", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    await assert.rejects(runSearch(request), (e: unknown) => e instanceof PlacesError && e.reason === "failed");
    assert.equal(placesBudget().used, 2);
  });
});

describe("the routes", () => {
  let server: Server;
  let base = "";

  beforeEach(() => {
    const app = express();
    app.use(express.json());
    app.use("/api/traction/places", placesRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/traction/places`;
  });
  afterEach(() => server.close());

  interface Reply {
    niches: unknown[];
    radius: { min: number; max: number };
    configured: boolean;
    budget: { cap: number; used: number };
    result: { candidates: { name: string }[] };
    error?: string;
    reason?: string;
  }

  // The test talks to the router with the real fetch, so globalThis.fetch stays the Google stub the handler uses.
  const call = async (route: string, body?: unknown) => {
    const response = await realFetch(`${base}${route}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Reply };
  };

  it("lists the niches, the radius limits and the budget without spending anything", async () => {
    const { status, body } = await call("/niches");
    assert.equal(status, 200);
    assert.equal(body.niches.length, 7);
    assert.deepEqual(body.radius, { min: 5, max: 15 });
    assert.equal(body.configured, true);
    assert.equal(body.budget.cap, 10);
    assert.equal(body.budget.used, 0);
  });

  it("searches, and maps a refusal to a status and a reason", async () => {
    google();
    const ok = await call("/search", request);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.result.candidates[0].name, "Smile Dental");
    assert.equal(ok.body.budget.used, 2);
  });

  it("answers 400 for a malformed body and 422 for a search that is not allowed", async () => {
    assert.equal((await call("/search", { area: 5 })).status, 400);
    const tooWide = await call("/search", { ...request, radiusKm: 50 });
    assert.deepEqual([tooWide.status, tooWide.body.reason], [422, "invalid"]);
  });

  it("answers 409 with no cap set and 429 when it is spent, never leaking the key", async () => {
    delete process.env.AGENTOS_PLACES_MONTHLY_REQUEST_CAP;
    const noCap = await call("/search", request);
    assert.deepEqual([noCap.status, noCap.body.reason], [409, "no-cap"]);

    process.env.AGENTOS_PLACES_MONTHLY_REQUEST_CAP = "1";
    const spent = await call("/search", request);
    assert.deepEqual([spent.status, spent.body.reason], [429, "quota"]);
    assert.ok(!JSON.stringify([noCap.body, spent.body]).includes('"k"'));
  });
});
