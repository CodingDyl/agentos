import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { distanceKm, PlacesError, searchNiche, SEARCH_REQUESTS } from "../client";
import { NICHES, nicheById } from "../niches";

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
});

const SANDTON = { latitude: -26.1076, longitude: 28.0567 };

function place(overrides: Record<string, unknown>) {
  return {
    id: "p1",
    displayName: { text: "Smile Dental" },
    formattedAddress: "1 Rivonia Rd, Sandton",
    location: { latitude: -26.11, longitude: 28.06 },
    businessStatus: "OPERATIONAL",
    ...overrides,
  };
}

/** Answers the area lookup first, then the niche search; records every request. */
function fakeGoogle(nicheReply: { status?: number; places?: unknown[] }, areaReply: { status?: number; places?: unknown[] } = { places: [{ displayName: { text: "Sandton" }, location: SANDTON }] }) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const reply = calls.length === 1 ? areaReply : nicheReply;
    return new Response(JSON.stringify({ places: reply.places ?? [] }), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const request = { area: "Sandton", nicheId: "dentists", radiusKm: 10 };

describe("places niches", () => {
  it("gives every niche a query, a reason and a unique id", () => {
    assert.equal(new Set(NICHES.map((niche) => niche.id)).size, NICHES.length);
    for (const niche of NICHES) assert.ok(niche.query && niche.why && niche.label, niche.id);
  });

  it("warns on the regulated niches", () => {
    assert.match(nicheById("law_firms")?.caveat ?? "", /Legal Practice Council/);
    assert.match(nicheById("financial_advisers")?.caveat ?? "", /FSCA/);
    assert.equal(nicheById("nope"), undefined);
  });
});

describe("distanceKm", () => {
  it("is zero for the same point and about right across Johannesburg", () => {
    assert.equal(distanceKm(-26.1, 28.0, -26.1, 28.0), 0);
    // Sandton to Rosebank is roughly 8 km.
    const km = distanceKm(-26.1076, 28.0567, -26.1467, 28.0436);
    assert.ok(km > 3 && km < 6, `${km}`);
  });
});

describe("searchNiche", () => {
  it("refuses without a key, before any request", async () => {
    const { fetcher, calls } = fakeGoogle({});
    await assert.rejects(searchNiche(request, fetcher), (e: unknown) => e instanceof PlacesError && e.reason === "not-configured");
    assert.equal(calls.length, 0);
  });

  it("rejects a bad radius, niche or area before any request", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    const { fetcher, calls } = fakeGoogle({});
    for (const bad of [{ radiusKm: 4 }, { radiusKm: 16 }, { radiusKm: Number.NaN }, { nicheId: "plumbers" }, { area: " x " }, { area: "x".repeat(81) }]) {
      await assert.rejects(searchNiche({ ...request, ...bad }, fetcher), (e: unknown) => e instanceof PlacesError && e.reason === "invalid");
    }
    assert.equal(calls.length, 0);
  });

  it("looks up the area, then searches the niche around it with the key in a header", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "secret";
    const { fetcher, calls } = fakeGoogle({ places: [place({})] });
    const result = await searchNiche(request, fetcher);

    assert.equal(calls.length, SEARCH_REQUESTS);
    assert.equal(result.requests, SEARCH_REQUESTS);
    assert.equal(calls[0].body.textQuery, "Sandton");
    assert.equal(calls[1].body.textQuery, "dentist");
    assert.deepEqual(calls[1].body.locationBias, { circle: { center: SANDTON, radius: 10_000 } });
    assert.equal(calls[1].headers["X-Goog-Api-Key"], "secret");
    assert.ok(!calls[1].url.includes("secret"), "the key must not be in the URL");
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.equal(result.candidates[0].name, "Smile Dental");
  });

  it("drops places outside the radius, closed ones and duplicates, and sorts nearest first", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    const { fetcher } = fakeGoogle({
      places: [
        place({ id: "far", displayName: { text: "Pretoria Dental" }, location: { latitude: -25.75, longitude: 28.19 } }),
        place({ id: "mid", displayName: { text: "Mid Dental" }, location: { latitude: -26.14, longitude: 28.06 } }),
        place({ id: "near", displayName: { text: "Near Dental" }, location: { latitude: -26.108, longitude: 28.057 } }),
        place({ id: "near", displayName: { text: "Near Dental again" } }),
        place({ id: "shut", displayName: { text: "Closed Dental" }, businessStatus: "CLOSED_PERMANENTLY" }),
        place({ id: "", displayName: { text: "No id" } }),
      ],
    });
    const result = await searchNiche(request, fetcher);
    assert.deepEqual(result.candidates.map((c) => c.placeId), ["near", "mid"]);
  });

  it("tells a business's own site from a social page from no site", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    const { fetcher } = fakeGoogle({
      places: [
        place({ id: "a", websiteUri: "https://www.smile.co.za/contact" }),
        place({ id: "b", websiteUri: "https://www.facebook.com/SmileDental" }),
        place({ id: "c" }),
      ],
    });
    const kinds = Object.fromEntries((await searchNiche(request, fetcher)).candidates.map((c) => [c.placeId, c.websiteKind]));
    assert.deepEqual(kinds, { a: "own", b: "social", c: "none" });
  });

  it("explains an unknown area", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    const { fetcher, calls } = fakeGoogle({}, { places: [] });
    await assert.rejects(searchNiche({ ...request, area: "Nowhereville" }, fetcher), (e: unknown) => e instanceof PlacesError && e.reason === "bad-area");
    assert.equal(calls.length, 1, "no niche search is paid for after a failed area lookup");
  });

  it("explains a refused key, a used-up quota and a bad request", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    for (const [status, reason] of [[403, "unauthorized"], [429, "quota"], [400, "invalid"], [500, "failed"]] as const) {
      const { fetcher } = fakeGoogle({}, { status });
      await assert.rejects(searchNiche(request, fetcher), (e: unknown) => e instanceof PlacesError && e.reason === reason, String(status));
    }
  });

  it("reports an unreachable Google plainly", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    const fetcher = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    await assert.rejects(searchNiche(request, fetcher), (e: unknown) => e instanceof PlacesError && e.reason === "failed");
  });
});
