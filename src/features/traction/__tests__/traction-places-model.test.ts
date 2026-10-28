import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlaceCandidate, PlaceNiche } from "@shared/places-types";
import { ProspectInputSchema, type Prospect } from "@shared/traction-types";
import { alreadyListed, orderCandidates, prospectFromCandidate, searchBlocker } from "../traction-places-model";

const niche: PlaceNiche = { id: "law_firms", label: "Law firms", query: "attorneys law firm", why: "Referral-heavy", caveat: "Advertising claims are limited." };

function candidate(overrides: Partial<PlaceCandidate>): PlaceCandidate {
  return { placeId: "p1", name: "Smit & Partners", address: "1 Rivonia Rd, Sandton", websiteKind: "none", lat: -26.1, lng: 28.05, distanceKm: 3, ...overrides };
}

function prospect(overrides: Partial<Prospect>): Prospect {
  return {
    id: "pr_1",
    company: "Someone Else",
    stage: "target",
    source: "outbound",
    reasons: [],
    stageChangedAt: "",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("orderCandidates", () => {
  it("puts no website first, then a social page, then their own site, nearest first within each", () => {
    const ordered = orderCandidates([
      candidate({ placeId: "own-near", websiteKind: "own", distanceKm: 1 }),
      candidate({ placeId: "none-far", websiteKind: "none", distanceKm: 9 }),
      candidate({ placeId: "social", websiteKind: "social", distanceKm: 2 }),
      candidate({ placeId: "none-near", websiteKind: "none", distanceKm: 4 }),
    ]);
    assert.deepEqual(ordered.map((c) => c.placeId), ["none-near", "none-far", "social", "own-near"]);
  });

  it("does not change the list it was given", () => {
    const input = [candidate({ placeId: "a", websiteKind: "own" }), candidate({ placeId: "b", websiteKind: "none" })];
    orderCandidates(input);
    assert.deepEqual(input.map((c) => c.placeId), ["a", "b"]);
  });
});

describe("alreadyListed", () => {
  it("matches on a name that differs only in case, spacing, punctuation or & versus and", () => {
    assert.equal(alreadyListed(candidate({ name: "Smit & Partners" }), [prospect({ company: "SMIT and partners" })]), true);
    assert.equal(alreadyListed(candidate({ name: "Smit & Partners" }), [prospect({ company: "Smit  &  Partners Inc." })]), false);
    assert.equal(alreadyListed(candidate({ name: "Smit & Partners" }), [prospect({ company: "Jones Attorneys" })]), false);
  });

  it("matches on the website host, ignoring www and the path", () => {
    const known = [prospect({ website: "https://www.smit.co.za/contact" })];
    assert.equal(alreadyListed(candidate({ websiteKind: "own", website: "https://smit.co.za/" }), known), true);
  });

  it("does not treat a shared social host as the same business", () => {
    const known = [prospect({ company: "Other", website: "https://www.facebook.com/other" })];
    assert.equal(alreadyListed(candidate({ websiteKind: "social", website: "https://www.facebook.com/smit" }), known), false);
  });
});

describe("prospectFromCandidate", () => {
  it("makes a valid prospect that has no verdict, so it lands in To check", () => {
    const input = prospectFromCandidate(candidate({ rating: 4.6, ratingCount: 31, phone: "011 555 0100", mapsUrl: "https://maps.google.com/?cid=1" }), niche, "Sandton");
    const parsed = ProspectInputSchema.parse(input);
    assert.equal(parsed.vetting, undefined);
    assert.equal(parsed.stage, "target");
    assert.equal(parsed.segment, "Law firms");
    assert.deepEqual(parsed.reasons.slice(0, 1), ["No website on Google Maps"]);
    assert.ok(parsed.reasons.includes("4.6 stars from 31 Google reviews"));
    assert.match(parsed.notes ?? "", /Phone: 011 555 0100/);
    assert.match(parsed.notes ?? "", /Note for this niche: Advertising claims are limited\./);
  });

  it("keeps a social page as the website (the rebuild accepts one) but nothing for no site", () => {
    assert.equal(prospectFromCandidate(candidate({ websiteKind: "none" }), niche, "Sandton").website, undefined);
    assert.equal(
      prospectFromCandidate(candidate({ websiteKind: "social", website: "https://www.facebook.com/smit" }), niche, "Sandton").website,
      "https://www.facebook.com/smit",
    );
  });

  it("keeps long values inside the prospect's own limits", () => {
    const input = prospectFromCandidate(candidate({ name: "A".repeat(300), address: "B".repeat(5000) }), niche, "Sandton");
    assert.doesNotThrow(() => ProspectInputSchema.parse(input));
  });
});

describe("searchBlocker", () => {
  const ready = { configured: true, budget: { cap: 10, remaining: 10 } };

  it("says nothing before the first read, and nothing when searching can work", () => {
    assert.equal(searchBlocker(undefined, 2), undefined);
    assert.equal(searchBlocker(ready, 2), undefined);
  });

  it("names what is missing", () => {
    assert.match(searchBlocker({ ...ready, configured: false }, 2) ?? "", /GOOGLE_PLACES_API_KEY/);
    assert.match(searchBlocker({ configured: true, budget: { cap: 0, remaining: 0 } }, 2) ?? "", /AGENTOS_PLACES_MONTHLY_REQUEST_CAP/);
    assert.match(searchBlocker({ configured: true, budget: { cap: 10, remaining: 1 } }, 2) ?? "", /used up/);
  });
});
