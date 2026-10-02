import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefGaps, OutreachBriefSchema, recommendPlay } from "../../../shared/outreach-plays";
import type { OutreachLogEntry, OutreachReply } from "../../../shared/outreach-types";
import { sequenceRefusal } from "../../traction/store";
import { buildEmailPacket, offerForBrief } from "../draft";
import { markupObservations, readResearchReply, signalsFrom } from "../research";
import { computeOutreachStats } from "../stats";

const DAY = 86_400_000;
const at = (daysAgo: number, now = Date.parse("2026-10-01T12:00:00Z")) => new Date(now - daysAgo * DAY).toISOString();
const NOW = new Date("2026-10-01T12:00:00Z");

function sent(prospectId: string, to: string, daysAgo: number, play?: string): OutreachLogEntry {
  return { id: `${prospectId}-${daysAgo}`, prospectId, kind: "sent", to, subject: "s", at: at(daysAgo), play: play as OutreachLogEntry["play"] };
}
function reply(prospectId: string, from: string, daysAgo: number): OutreachReply {
  return { id: `r-${prospectId}-${daysAgo}`, threadId: "t", prospectId, fromEmail: from, subject: "Re", text: "yes", at: at(daysAgo) };
}

describe("the follow-up sequence", () => {
  it("allows the first email, then waits 3 days, then 4, then stops at three", () => {
    const to = "a@shop.co.za";
    assert.equal(sequenceRefusal({ outreachLog: [], outreachReplies: [] }, to, NOW.getTime()), undefined);
    const one = [sent("p", to, 2)];
    assert.match(String(sequenceRefusal({ outreachLog: one, outreachReplies: [] }, to, NOW.getTime())), /due on/);
    assert.equal(sequenceRefusal({ outreachLog: [sent("p", to, 3)], outreachReplies: [] }, to, NOW.getTime()), undefined);
    const two = [sent("p", to, 7), sent("p", to, 3)];
    assert.match(String(sequenceRefusal({ outreachLog: two, outreachReplies: [] }, to, NOW.getTime())), /due on/);
    const three = [sent("p", to, 20), sent("p", to, 15), sent("p", to, 10)];
    assert.match(String(sequenceRefusal({ outreachLog: three, outreachReplies: [] }, to, NOW.getTime())), /stops there/);
  });

  it("starts over once they reply, and counts the address not the record", () => {
    const to = "a@shop.co.za";
    const three = [sent("p", to, 20), sent("p", to, 15), sent("p", to, 10)];
    assert.equal(sequenceRefusal({ outreachLog: three, outreachReplies: [reply("p", "A@Shop.co.za", 5)] }, to, NOW.getTime()), undefined);
    assert.match(String(sequenceRefusal({ outreachLog: [sent("other", to, 1)], outreachReplies: [] }, "A@shop.co.za", NOW.getTime())), /due on/);
  });
});

describe("plays", () => {
  it("recommends a preview without a working site, bookings for a service business, a refresh for an old one", () => {
    assert.equal(recommendPlay({ reachable: false }).play, "website_preview");
    assert.equal(recommendPlay({ reachable: true, socialOnly: true }).play, "website_preview");
    assert.equal(recommendPlay({ reachable: true, mobileViewport: false }).play, "website_preview");
    assert.equal(recommendPlay({ reachable: true, mobileViewport: true, hasForm: false, mentionsBooking: false }, "salon").play, "bookings");
    assert.equal(recommendPlay({ reachable: true, mobileViewport: true, hasForm: true, copyrightYear: 2019 }).play, "refresh");
    assert.equal(recommendPlay({ reachable: true, mobileViewport: true, hasForm: true }).play, "quick_fixes");
  });

  it("will not draft a preview email without the preview link", () => {
    const brief = OutreachBriefSchema.parse({ play: "website_preview", cta: "see_preview" });
    assert.ok(briefGaps(brief).length > 0);
    const ready = OutreachBriefSchema.parse({ play: "website_preview", cta: "see_preview", previewUrl: "https://preview.example/glam" });
    assert.deepEqual(briefGaps(ready), []);
  });

  it("puts the link, the exact price and the call to action in what Hermes is told", () => {
    const brief = OutreachBriefSchema.parse({ play: "website_preview", cta: "see_preview", previewUrl: "https://preview.example/glam", price: "R4,500 once-off" });
    const offer = offerForBrief(brief, []);
    assert.ok(offer);
    const packet = buildEmailPacket({
      prospect: { id: "p", company: "Glam", stage: "target", source: "outbound", reasons: [], observation: "No website", stageChangedAt: "", createdAt: "", updatedAt: "" },
      icp: { name: "Small businesses", offer: "Websites", idealProspect: [] } as never,
      offer,
      brief,
    });
    assert.match(packet, /https:\/\/preview\.example\/glam/);
    assert.match(packet, /R4,500 once-off/);
    assert.match(packet, /preview link/i);
    assert.match(packet, /none: they have no website/);
  });
});

describe("the website review", () => {
  it("reads the copyright year and missing booking from the markup", () => {
    const html = '<html><meta name="viewport" content="w"><body><p>Call us</p><footer>© 2018 Glam</footer></body></html>';
    const signals = signalsFrom({ html, url: "https://glam.co.za" }, {
      url: "https://glam.co.za", fetchedAt: "", headings: [], text: "Call us",
      signals: { https: true, mobileViewport: true, hasForm: false, hasPhoneOrWhatsApp: false, images: 0 },
    });
    assert.equal(signals.copyrightYear, 2018);
    assert.equal(signals.mentionsBooking, false);
    const notes = markupObservations(signals, "https://glam.co.za").map((entry) => entry.text).join(" ");
    assert.match(notes, /book or send an enquiry/);
    assert.match(notes, /2018/);
  });

  it("keeps at most three of Hermes' observations and drops empty ones", () => {
    const found = readResearchReply(JSON.stringify({ observations: [{ text: "a" }, { text: "The booking button on the home page leads to a 404 page.", evidence: "Book now" }, { text: "x".repeat(20) }, { text: "y".repeat(20) }, { text: "z".repeat(20) }] }));
    assert.equal(found.length, 3);
    assert.equal(found[0].by, "hermes");
  });
});

describe("outreach results", () => {
  it("counts reply rate per prospect and per play, and lists follow-ups due", () => {
    const prospects = [
      { id: "a", company: "A", stage: "contacted" },
      { id: "b", company: "B", stage: "conversation" },
      { id: "c", company: "C", stage: "contacted" },
    ] as never;
    const stats = computeOutreachStats(
      {
        prospects,
        outreachLog: [sent("a", "a@a.co", 10, "website_preview"), sent("b", "b@b.co", 8, "website_preview"), sent("b", "b@b.co", 5, "website_preview"), sent("c", "c@c.co", 1, "quick_fixes")],
        outreachReplies: [reply("b", "b@b.co", 4)],
        suppressions: [],
      },
      NOW,
    );
    assert.equal(stats.sent.all, 4);
    assert.equal(stats.overall.contacted, 3);
    assert.equal(stats.overall.replied, 1);
    assert.equal(stats.overall.positive, 1);
    const preview = stats.byPlay.find((entry) => entry.play === "website_preview");
    assert.equal(preview?.replyRate, 0.5);
    assert.deepEqual(stats.followUpsDue.map((entry) => entry.prospectId), ["a"]);
    assert.equal(stats.sentEmails.find((entry) => entry.prospectId === "b" && entry.touch === 1)?.status, "replied");
  });
});

describe("brief findings", () => {
  it("drops an AgentOS check that repeats a Hermes finding", async () => {
    const { saysTheSame } = await import("../cases");
    assert.equal(saysTheSame("There is no tap-to-call or WhatsApp button on www.shop.co.za.", ["Your number has no tap-to-call, and there is no WhatsApp link."]), true);
    assert.equal(saysTheSame("The footer of shop.co.za still says 2018.", ["Your number has no tap-to-call, and there is no WhatsApp link."]), false);
  });
});
