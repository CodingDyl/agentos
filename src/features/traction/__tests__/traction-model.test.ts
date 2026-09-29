import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prospect } from "@shared/traction-types";
import { hermesPrompt, NO_GENERIC_OUTREACH_RULE, portalViewPrompt, queueProgress, toList } from "../traction-model";

const base: Prospect = {
  id: "pr_abc12345",
  company: "Parkview Realty",
  contact: "John Smith",
  stage: "target",
  source: "outbound",
  reasons: ["Independent agency"],
  stageChangedAt: "2026-09-20T10:00:00.000Z",
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:00.000Z",
};

const icp = { name: "Real estate agencies", offer: "Websites", idealProspect: [], updatedAt: "" };
const offer = { id: "of_1", name: "Real estate website", offer: "Conversion-focused site", upsells: [], createdAt: "", updatedAt: "" };

describe("hermesPrompt", () => {
  it("asks for research, not a message, when nothing specific is known", () => {
    const result = hermesPrompt({ prospect: base, icp, offers: [offer], gaps: ["offer", "website", "observation"] });

    assert.equal(result.kind, "research");
    assert.match(result.prompt, /find their website first/);
    assert.match(result.prompt, /exactly 3 concrete/);
    assert.ok(result.prompt.includes(NO_GENERIC_OUTREACH_RULE));
  });

  it("asks for a draft once the specifics exist, and carries them", () => {
    const ready: Prospect = {
      ...base,
      website: "https://parkview.example",
      offerId: "of_1",
      observation: "Property pages have no viewing-enquiry CTA on mobile",
    };
    const result = hermesPrompt({ prospect: ready, icp, offers: [offer], gaps: [], item: { id: "contact:pr_abc12345", kind: "contact", prospectId: ready.id, title: "", detail: [] } });

    assert.equal(result.kind, "draft");
    assert.match(result.prompt, /first outreach/);
    assert.match(result.prompt, /viewing-enquiry CTA on mobile/);
    assert.match(result.prompt, /Conversion-focused site/);
    assert.match(result.prompt, /never send/i);
  });

  it("drafts a follow-up for a follow-up item", () => {
    const ready: Prospect = { ...base, stage: "contacted", website: "https://x.example", offerId: "of_1", observation: "o" };
    const result = hermesPrompt({
      prospect: ready,
      icp,
      offers: [offer],
      gaps: [],
      item: { id: "follow_up:pr_abc12345", kind: "follow_up", prospectId: ready.id, title: "", detail: [] },
    });
    assert.match(result.prompt, /follow-up/);
  });

  it("prepares a referral ask for a referral item, regardless of gaps", () => {
    const result = hermesPrompt({
      prospect: { ...base, stage: "won" },
      icp,
      offers: [],
      gaps: ["offer", "website", "observation"],
      item: { id: "referral:pr_abc12345", kind: "referral", prospectId: base.id, title: "", detail: [] },
    });
    assert.equal(result.kind, "referral");
  });
});

describe("helpers", () => {
  it("counts done over done plus open", () => {
    assert.deepEqual(queueProgress({ doneToday: 2, queue: [{ id: "a", kind: "contact", prospectId: "p", title: "", detail: [] }] }), {
      done: 2,
      total: 3,
    });
  });

  it("turns a textarea into a clean list", () => {
    assert.deepEqual(toList("- One\n\n• Two \n  Three"), ["One", "Two", "Three"]);
  });
});

describe("portalViewPrompt", () => {
  it("drafts a light note about what is waiting, and never hands over that they opened it", () => {
    const prompt = portalViewPrompt("Acme Corp", ["Quote R 25 000 waiting"]);
    assert.match(prompt, /Acme Corp has a quote or agreement/);
    assert.match(prompt, /- Quote R 25 000 waiting/);
    assert.match(prompt, /Do NOT say or hint that you know they opened anything/);
    assert.match(prompt, /never send/i);
    assert.equal(/opened yesterday|opened today/i.test(prompt), false);
  });
});
