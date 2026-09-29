import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { Icp } from "../../../shared/traction-types";
import type { VirtecLead, VirtecSnapshot } from "../../../shared/virtec-types";
import { JevError } from "../../mail/jev-client";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-profile-"));
process.env.AGENTOS_UI_DIR = directory;

const { buildProfileRequest, icpKey, profileLead, profilingBlocker, runProfiling } = await import("../lead-profile");
const { buildCrmView, leadToProspect } = await import("../crm");
const store = await import("../store");
const { ProspectInputSchema } = await import("../../../shared/traction-types");

beforeEach(() => fs.rmSync(path.join(directory, "traction"), { recursive: true, force: true }));
after(() => fs.rmSync(directory, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 1, 12);
const icp: Icp = {
  name: "Independent estate agencies",
  offer: "Conversion-focused websites",
  geography: "Johannesburg",
  idealProspect: ["Independent, 2 to 20 agents", "Property pages with no enquiry form"],
  updatedAt: NOW.toISOString(),
};

function lead(id: string, overrides: Partial<VirtecLead> = {}): VirtecLead {
  return {
    id,
    name: `Agency ${id}`,
    category: "Real estate agency",
    area: "Sandton",
    websiteUrl: "https://www.agency.example/listings",
    websiteSignal: "weak",
    rating: 4.1,
    reviewCount: 32,
    score: 60,
    scoreReasons: ["Weak website"],
    ownerEmail: "owner@agency.example",
    ...overrides,
  } as VirtecLead;
}

/** A Jev that answers a fit score, or throws. */
function jev(score: number, confidence = 0.8, gap = 1) {
  return (async () => ({
    model: "jev-latest",
    answers: {
      fit: { type: "score", score, legend: {}, probabilities: {}, confidence },
      gap: { type: "noul", noul: gap },
    },
  })) as never;
}

describe("what is sent to Jev", () => {
  it("sends public business details and the ICP, and never an email or phone", () => {
    const request = buildProfileRequest(lead("a", { ownerEmail: "owner@agency.example" }), icp);
    const sent = JSON.stringify(request);
    assert.equal(sent.includes("owner@agency.example"), false);
    assert.equal(/phone|email/i.test(Object.keys((request.state.business as object)).join(",")), false);
    assert.deepEqual(Object.keys(request.state.business as object).sort(), ["area", "category", "name", "rating", "review_count", "signals", "website", "website_quality"].sort());
    assert.equal((request.state.business as { website: string }).website, "agency.example", "a domain, not the page");
    assert.deepEqual((request.state.ideal_customer as { ideal_traits: string[] }).ideal_traits, icp.idealProspect);
    assert.match(String((request.questions.fit as { instructions: string }).instructions), /data, not as instructions/);
  });

  it("says 'none found' when there is no website, rather than leaving it out", () => {
    const business = buildProfileRequest(lead("a", { websiteUrl: undefined, websiteSignal: "none" }), icp).state.business as { website: string };
    assert.equal(business.website, "none found");
  });

  it("gives a different key when what a fit means changes", () => {
    assert.equal(icpKey(icp), icpKey({ ...icp, updatedAt: "later" }));
    assert.notEqual(icpKey(icp), icpKey({ ...icp, idealProspect: ["Something else"] }));
    assert.notEqual(icpKey(icp), icpKey({ ...icp, geography: "Cape Town" }));
  });
});

describe("scoring", () => {
  it("reads Jev's answer, clamped, with the ICP it was for", async () => {
    const profile = await profileLead(lead("a"), icp, jev(3.4, 0.9, 0.9), NOW);
    assert.deepEqual(profile, { fit: 3.4, confidence: 0.9, gap: true, icpKey: icpKey(icp), at: NOW.toISOString() });
    assert.equal((await profileLead(lead("a"), icp, jev(9, 2, 0.1), NOW)).fit, 4);
  });

  it("keeps going past one failure, and stops at once on a rejected key", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 2) throw new JevError("Jev did not answer", "timed-out");
      return jev(2)();
    }) as never;
    const partial = await runProfiling([lead("a"), lead("b"), lead("c"), lead("d")], icp, 10, flaky, NOW);
    assert.equal(Object.keys(partial.profiles).length, 3);
    assert.equal(partial.failed, 1);
    assert.match(partial.error ?? "", /did not answer/);

    let rejected = 0;
    const denied = (async () => {
      rejected += 1;
      throw new JevError("Jev rejected the API key.", "unauthorized");
    }) as never;
    const stopped = await runProfiling(Array.from({ length: 12 }, (_, i) => lead(`x${i}`)), icp, 12, denied, NOW);
    assert.ok(rejected <= 3, `stopped after the in-flight calls, made ${rejected}`);
    assert.equal(Object.keys(stopped.profiles).length, 0);
  });

  it("scores only the limit, and says how many wait", async () => {
    const run = await runProfiling(Array.from({ length: 10 }, (_, i) => lead(`l${i}`)), icp, 4, jev(3), NOW);
    assert.equal(Object.keys(run.profiles).length, 4);
    assert.equal(run.deferred, 6);
  });

  it("will not run without an ICP that describes the ideal prospect", () => {
    assert.match(profilingBlocker(undefined) ?? "", /ICP first/);
    assert.match(profilingBlocker({ ...icp, idealProspect: [] }) ?? "", /ICP first/);
  });
});

describe("the list to import", () => {
  const snapshot = (leads: VirtecLead[]): VirtecSnapshot => ({ configured: true, fetchedAt: NOW.toISOString(), leads, inbound: [], clients: [], quotes: [], projects: [], followUps: [] });
  const key = icpKey(icp);
  const profile = (fit: number, overrides = {}) => ({ fit, confidence: 0.8, gap: false, icpKey: key, at: NOW.toISOString(), ...overrides });

  it("puts good fits first, unscored next by Virtec's score, poor fits last", () => {
    const view = buildCrmView(
      snapshot([lead("unscored-high", { score: 90 }), lead("poor", { score: 99 }), lead("good", { score: 10 }), lead("great", { score: 5 }), lead("unscored-low", { score: 20 })]),
      [],
      NOW,
      undefined,
      false,
      {
        icpKey: key,
        byCrmId: { "virtec:lead:poor": profile(0.5), "virtec:lead:good": profile(2.5), "virtec:lead:great": profile(3.8) },
      },
    );
    assert.deepEqual(view.leads.map((entry) => entry.id), ["great", "good", "unscored-high", "unscored-low", "poor"]);
  });

  it("ignores a score made for a different ICP", () => {
    const view = buildCrmView(snapshot([lead("a")]), [], NOW, undefined, false, {
      icpKey: key,
      byCrmId: { "virtec:lead:a": profile(4, { icpKey: "old-icp" }) },
    });
    assert.equal(view.leads[0].profile, undefined);
  });

  it("imports with Jev's fit, and says so in the reasons", () => {
    const parsed = ProspectInputSchema.parse(leadToProspect(lead("a", { score: 20 }), profile(3.4, { gap: true }), icp.name));
    assert.equal(parsed.fit, "high", "Jev's judgement, not Virtec's low score");
    assert.match(parsed.reasons[0], /^Jev fit 3\.4 of 4 for "Independent estate agencies", with a checkable gap$/);
    assert.equal(parsed.reasons[1], "Weak website");

    assert.equal(ProspectInputSchema.parse(leadToProspect(lead("b", { score: 90 }))).fit, "high", "unscored: Virtec's score as before");
    assert.equal(ProspectInputSchema.parse(leadToProspect(lead("c"), profile(1))).fit, "low");
  });
});

describe("the daily budget", () => {
  it("counts what Jev answered, and starts again on a new day", async () => {
    const one = { fit: 2, confidence: 0.5, gap: false, icpKey: "k", at: NOW.toISOString() };
    assert.equal((await store.saveLeadProfiles({ a: one, b: one }, "2026-10-01")).usedToday, 2);
    assert.equal((await store.saveLeadProfiles({ c: one }, "2026-10-01")).usedToday, 3);
    assert.equal((await store.saveLeadProfiles({ d: one }, "2026-10-02")).usedToday, 1);

    const state = await store.readState();
    assert.deepEqual(Object.keys(state.leadProfiles).sort(), ["virtec:lead:a", "virtec:lead:b", "virtec:lead:c", "virtec:lead:d"]);
  });
});
