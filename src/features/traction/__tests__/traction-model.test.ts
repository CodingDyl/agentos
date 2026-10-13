import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prospect } from "@shared/traction-types";
import { followUpsHref, hermesPrompt, isTractionTab, mailtoHref, MORE_TABS, NO_GENERIC_OUTREACH_RULE, portalViewPrompt, PRIMARY_TABS, queueItemHref, queueProgress, toList } from "../traction-model";

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

describe("mailtoHref", () => {
  it("leaves an ordinary address readable", () => {
    assert.equal(mailtoHref("jane@firm.co.za"), "mailto:jane@firm.co.za");
  });

  it("cannot be made to carry a hidden recipient or subject", () => {
    for (const hostile of ["jane?bcc=evil@attacker.example", "jane?subject=Hi&cc=x@y.co@attacker.example", "a&bcc=x@evil.co"]) {
      const link = mailtoHref(hostile);
      assert.equal(link.includes("?"), false, link);
      assert.equal(link.includes("&"), false, link);
      assert.equal(link.split("@").length, 2, "one real @");
    }
  });
});

describe("the tabs", () => {
  it("leads with the four steps, in order, and keeps everything else under More", () => {
    assert.deepEqual(PRIMARY_TABS.map((tab) => tab.label), ["Next up", "Find", "Outreach", "Follow-ups"]);
    assert.ok(MORE_TABS.length >= 10);
    const all = [...PRIMARY_TABS, ...MORE_TABS].map((tab) => tab.value);
    assert.equal(new Set(all).size, all.length, "no tab twice");
  });

  it("still opens every old link", () => {
    for (const old of ["overview", "prospects", "pipeline", "waiting", "clients", "case-studies", "lead-magnets", "crm", "offers", "experiments", "review"]) {
      assert.equal(isTractionTab(old), true, old);
    }
    assert.equal(isTractionTab("nonsense"), false);
    assert.equal(isTractionTab(null), false);
  });
});

describe("where a queue item opens", () => {
  const item = (kind: string, prospectId = "pr_abc12345") => ({ id: `${kind}:${prospectId}`, kind, prospectId, title: "", detail: [] }) as never;

  it("sends a follow-up for someone already emailed to Follow-ups, and a proposal to the prospect", () => {
    assert.equal(queueItemHref(item("follow_up"), { stage: "contacted" }), followUpsHref("pr_abc12345"));
    assert.equal(queueItemHref(item("follow_up"), { stage: "proposal" }), "/traction?tab=prospects&prospect=pr_abc12345");
  });

  it("sends new outreach to the email, and keeps the other destinations", () => {
    assert.equal(queueItemHref(item("contact"), { stage: "target" }), "/traction?tab=outreach&prospect=pr_abc12345");
    assert.equal(queueItemHref(item("crm", "")), "/traction?tab=crm");
    assert.equal(queueItemHref({ id: "waiting:wo_1", kind: "waiting", title: "", detail: [] } as never), "/traction?tab=waiting");
  });
});

