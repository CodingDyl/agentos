import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { LeadMagnet } from "../../../shared/lead-magnet-types";
import type { Prospect } from "../../../shared/traction-types";
import type { VirtecInboundLead } from "../../../shared/virtec-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-magnets-"));
process.env.AGENTOS_UI_DIR = directory;

const { emailChangedSincePublish, leadMagnetBlockers, leadMagnetEmailBlockers, LeadMagnetFileSchema, leadMagnetReadUrl, slugFromTitle } = await import(
  "../../../shared/lead-magnet-types"
);
const { buildLeadMagnetPacket, leadMagnetFiles, leadMagnetStats, LeadMagnetNotReadyError, magnetForLead, readLeadMagnetDraft } = await import("../lead-magnets");
const magnetStore = await import("../lead-magnet-store");
const store = await import("../store");
const { inboundQueueItems, inboundToProspect } = await import("../crm");

beforeEach(() => {
  fs.rmSync(path.join(directory, "traction"), { recursive: true, force: true });
});

after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const NOW = new Date(2026, 8, 29, 12);

function magnet(overrides: Partial<LeadMagnet> = {}): LeadMagnet {
  return {
    id: "lm_1",
    slug: "after-hours-intake",
    track: "jurivo",
    format: "checklist",
    status: "draft",
    title: "The after-hours intake checklist",
    bullets: [],
    sections: [],
    missing: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

const complete: Partial<LeadMagnet> = {
  promise: "Stop losing enquiries that arrive after 5pm",
  headline: "Catch every after-hours enquiry",
  bullets: ["Twelve checks you can run this week"],
  cta: "Get the checklist",
  seoTitle: "After-hours intake checklist for law firms",
  seoDescription: "A practical checklist for catching and answering enquiries that arrive after hours.",
  sections: [
    { heading: "Before 5pm", body: "- [ ] Someone owns the inbox tonight" },
    { heading: "After 5pm", body: "- [ ] The website form answers within a minute" },
  ],
};

function lead(overrides: Partial<VirtecInboundLead> = {}): VirtecInboundLead {
  return { id: "in1", name: "Jane", email: "jane@firm.test", source: "magnet-after-hours-intake", track: "jurivo", status: "new", details: {}, createdAt: NOW.toISOString(), ...overrides };
}

describe("lead magnet rules", () => {
  it("makes a slug that fits the magnet- source", () => {
    assert.equal(slugFromTitle("The After-Hours Intake Checklist!"), "after-hours-intake-checklist");
    assert.ok(slugFromTitle("A".repeat(80)).length <= 32);
    assert.equal(slugFromTitle("!!!"), "lead-magnet");
  });

  it("names every blocker, and none for a complete magnet", () => {
    assert.ok(leadMagnetBlockers(magnet()).length >= 5);
    assert.deepEqual(leadMagnetBlockers(magnet(complete)), []);
    assert.deepEqual(leadMagnetBlockers(magnet({ ...complete, sections: [{ heading: "A", body: "[NEEDS DATA: average reply time]" }, complete.sections![1]] })), [
      "Resolve every [NEEDS DATA] marker",
    ]);
    assert.deepEqual(leadMagnetBlockers(magnet({ ...complete, missing: ["x"] })), ["Clear the missing-facts list"]);
  });
});

describe("stats", () => {
  it("counts a magnet's signups and what became of them", () => {
    const prospects = [
      { id: "pr_1", crmId: "virtec:inbound:in2", stage: "conversation" },
      { id: "pr_2", crmId: "virtec:inbound:in3", stage: "contacted" },
    ] as Prospect[];
    const stats = leadMagnetStats(
      [magnet()],
      [
        lead(),
        lead({ id: "in2", status: "reviewing" }),
        lead({ id: "in3", status: "replied", createdAt: new Date(2026, 7, 1).toISOString() }),
        lead({ id: "in4", source: "contact" }),
      ],
      prospects,
      NOW,
    );
    assert.deepEqual(stats.lm_1, { emailed: 0, emailFailed: 0, signups: 3, signupsLast7Days: 2, followedUp: 2, conversations: 1 });
  });

  it("finds the magnet a lead came from, and none for an ordinary form", () => {
    assert.equal(magnetForLead([magnet()], lead())?.id, "lm_1");
    assert.equal(magnetForLead([magnet()], lead({ source: "contact" })), undefined);
  });
});

describe("Hermes", () => {
  it("tells Hermes the site, the format and the no-invention rule", () => {
    const packet = buildLeadMagnetPacket({ magnet: magnet({ promise: "Kept promise" }) });
    assert.match(packet, /legal intake software/);
    assert.match(packet, /- \[ \] /);
    assert.match(packet, /Never invent statistics/);
    assert.match(packet, /Kept promise/);
  });

  it("reads a draft defensively, and refuses one without sections", () => {
    assert.equal(readLeadMagnetDraft({ headline: "x", sections: [] }), undefined);
    assert.equal(readLeadMagnetDraft("nope"), undefined);
    const draft = readLeadMagnetDraft({
      headline: "H",
      bullets: ["a", 3, "b"],
      sections: [{ heading: "One", body: "Body" }, { heading: "", body: "dropped" }, "junk"],
      missing: ["avg reply time"],
      status: "live",
    });
    assert.deepEqual(draft?.bullets, ["a", "b"]);
    assert.equal(draft?.sections.length, 1);
    assert.equal((draft as Record<string, unknown>).status, undefined);
  });
});

describe("export", () => {
  it("refuses a magnet that is not ready", async () => {
    await assert.rejects(leadMagnetFiles(magnet()), LeadMagnetNotReadyError);
  });

  it("writes a valid site file and a README naming where it goes", async () => {
    const { file, entries } = await leadMagnetFiles(magnet(complete));
    assert.ok(LeadMagnetFileSchema.safeParse(file).success);
    assert.deepEqual(entries.map((entry) => entry.name), ["after-hours-intake.json", "README.md"]);
    assert.match(entries[1].data.toString(), /content\/lead-magnets/);
    assert.match(entries[1].data.toString(), /magnet-after-hours-intake/);
  });
});

describe("lead magnet store", () => {
  it("keeps slugs unique across sites", async () => {
    const first = await magnetStore.createLeadMagnet({ track: "jurivo", format: "checklist", title: "Intake checklist" });
    const second = await magnetStore.createLeadMagnet({ track: "virtara", format: "guide", title: "Intake checklist" });
    assert.equal(first.slug, "intake-checklist");
    assert.equal(second.slug, "intake-checklist-2");
  });

  it("will not mark a magnet ready while anything blocks it, and fixes the slug once live", async () => {
    const created = await magnetStore.createLeadMagnet({ track: "jurivo", format: "checklist", title: "Intake" });
    const base = { ...created, ...complete };
    await assert.rejects(magnetStore.replaceLeadMagnet(created.id, { ...created, status: "ready" }), store.TractionConflictError);

    const live = await magnetStore.replaceLeadMagnet(created.id, { ...base, status: "live", liveUrl: "https://jurivo.test/guides/intake" });
    assert.equal(live.status, "live");
    await assert.rejects(magnetStore.replaceLeadMagnet(created.id, { ...base, status: "live", slug: "renamed" }), store.TractionConflictError);
    await assert.rejects(magnetStore.deleteLeadMagnet(created.id), store.TractionConflictError);
  });

  it("fills only empty fields from a draft", async () => {
    const created = await magnetStore.createLeadMagnet({ track: "virtara", format: "guide", title: "Guide" });
    await magnetStore.replaceLeadMagnet(created.id, { ...created, headline: "Mine" });
    const drafted = await magnetStore.applyLeadMagnetDraft(created.id, {
      headline: "Theirs",
      promise: "Drafted promise",
      bullets: ["b"],
      sections: [{ heading: "S", body: "B" }],
      missing: ["m"],
    });
    assert.equal(drafted.headline, "Mine");
    assert.equal(drafted.promise, "Drafted promise");
    assert.deepEqual(drafted.missing, ["m"]);
    assert.ok(drafted.draftedAt);
  });

  it("starts one experiment and links it, and tags signups with it", async () => {
    const created = await magnetStore.createLeadMagnet({ track: "jurivo", format: "checklist", title: "After hours intake" });
    const { magnet: linked, experiment } = await magnetStore.startLeadMagnetExperiment(created.id);
    const again = await magnetStore.startLeadMagnetExperiment(created.id);
    assert.equal(linked.experimentId, experiment.id);
    assert.equal(again.experiment.id, experiment.id);
    assert.equal((await store.readState()).experiments.length, 1);
    assert.equal(experiment.channel, "content");

    const signup = lead({ source: `magnet-${linked.slug}` });
    const prospect = inboundToProspect(signup, "2026-09-29", false, linked);
    assert.equal(prospect.experimentId, experiment.id);
    assert.deepEqual(prospect.reasons, ['Downloaded "After hours intake"']);

    const [item] = inboundQueueItems([signup], [], "2026-09-29", [linked]);
    assert.match(item.detail[0], /^Jurivo "After hours intake"/);
  });
});

describe("signup email", () => {
  it("links to the read page next to the live page, https only", () => {
    assert.equal(leadMagnetReadUrl("https://jurivo.test/guides/intake/"), "https://jurivo.test/guides/intake/read");
    assert.equal(leadMagnetReadUrl("https://jurivo.test/guides/intake?utm=x#top"), "https://jurivo.test/guides/intake/read");
    assert.equal(leadMagnetReadUrl("http://jurivo.test/guides/intake"), undefined);
    assert.equal(leadMagnetReadUrl(undefined), undefined);
  });

  it("will not go out without a subject, a {{link}}, and a live https page", () => {
    assert.deepEqual(leadMagnetEmailBlockers({}), ["Add the email subject", "Write the email", "Add the https address it is live at"]);
    assert.deepEqual(leadMagnetEmailBlockers({ emailSubject: "Here it is", emailBody: "Hi", liveUrl: "https://x.test/guides/a" }), [
      "Put {{link}} in the email where the link goes",
    ]);
    assert.deepEqual(leadMagnetEmailBlockers({ emailSubject: "Here it is", emailBody: "Hi {{link}}", liveUrl: "https://x.test/guides/a" }), []);
  });

  it("notices when what Virtec sends differs from what is written", () => {
    const base = { emailSubject: "S", emailBody: "B {{link}}", liveUrl: "https://x.test/guides/a" };
    const published = { subject: "S", body: "B {{link}}", readUrl: "https://x.test/guides/a/read", enabled: true, at: NOW.toISOString() };
    assert.equal(emailChangedSincePublish({ ...base, emailPublished: published }), false);
    assert.equal(emailChangedSincePublish({ ...base, emailBody: "New {{link}}", emailPublished: published }), true);
    assert.equal(emailChangedSincePublish(base), false);
  });

  it("drops a drafted email with no link placeholder, and counts emails sent", () => {
    const draft = readLeadMagnetDraft({ sections: [{ heading: "A", body: "B" }], emailSubject: "Your\nchecklist", emailBody: "No link here" });
    assert.equal(draft?.emailBody, undefined);
    assert.equal(draft?.emailSubject, "Your checklist");

    const stats = leadMagnetStats(
      [magnet()],
      [lead({ nurtureSentAt: NOW.toISOString() }), lead({ id: "in2", nurtureError: "domain not verified" }), lead({ id: "in3" })],
      [],
      NOW,
    );
    assert.equal(stats.lm_1.emailed, 1);
    assert.equal(stats.lm_1.emailFailed, 1);
  });

  it("keeps what was published across edits, and blocks deleting while it is on", async () => {
    const created = await magnetStore.createLeadMagnet({ track: "jurivo", format: "checklist", title: "Email test" });
    await magnetStore.recordEmailPublished(created.id, { subject: "S", body: "B {{link}}", readUrl: "https://x.test/guides/a/read", enabled: true, at: NOW.toISOString() });
    const edited = await magnetStore.replaceLeadMagnet(created.id, { ...created, emailSubject: "New subject" });
    assert.equal(edited.emailPublished?.subject, "S");
    await assert.rejects(magnetStore.deleteLeadMagnet(created.id), /Switch its email off/);
  });
});

describe("second touch", () => {
  const TODAY = "2026-09-29";
  const daysAgo = (days: number) => new Date(2026, 8, 29 - days, 9).toISOString();
  const thread = (overrides: Record<string, unknown> = {}) =>
    ({ threadId: "t1", fromEmail: "Jane@Firm.test", subject: "Re: your checklist", snippet: "", messageDate: daysAgo(0), classified: false, ...overrides }) as never;

  it("waits after the guide email, then asks for a personal note", () => {
    const early = inboundQueueItems([lead({ nurtureSentAt: daysAgo(2), createdAt: daysAgo(2) })], [], TODAY, [magnet()]);
    assert.deepEqual(early, []);

    const [item] = inboundQueueItems([lead({ nurtureSentAt: daysAgo(3), createdAt: daysAgo(3) })], [], TODAY, [magnet()]);
    assert.equal(item.id, "second_touch:in1");
    assert.equal(item.kind, "second_touch");
    assert.match(item.detail[0], /guide emailed 3 days ago/);
    assert.ok(item.rank > 1 && item.rank < 1.5, "after due actions, before chases");
  });

  it("asks for a reply at once when the guide email failed", () => {
    const [item] = inboundQueueItems([lead({ nurtureError: "domain not verified" })], [], TODAY, [magnet()]);
    assert.equal(item.kind, "inbound");
    assert.equal(item.detail[1], "The guide email did not send; send it yourself");
  });

  it("puts a signup who wrote back at the very top, and ignores mail from before they signed up", () => {
    const signup = lead({ nurtureSentAt: daysAgo(5), createdAt: daysAgo(5) });
    const [item] = inboundQueueItems([signup], [], TODAY, [magnet()], [thread({ messageDate: daysAgo(1) })]);
    assert.equal(item.id, "inbound:in1");
    assert.equal(item.rank, -1.5);
    assert.deepEqual(item.detail, ['Jurivo "The after-hours intake checklist" · they wrote back 1 day ago', "Re: your checklist"]);

    const [stale] = inboundQueueItems([signup], [], TODAY, [magnet()], [thread({ messageDate: daysAgo(9) })]);
    assert.equal(stale.kind, "second_touch");
  });

  it("makes a second-touch signup a contacted prospect, counted as outreach", async () => {
    const { getTraction } = await import("../traction");
    const mapped = inboundToProspect(lead({ id: "in9" }), TODAY, true, magnet());
    const prospect = await store.replyToInboundLead({ ...mapped, crmId: "virtec:inbound:in9" } as never, "second_touch:in9", "second_touch");
    assert.equal(prospect.stage, "contacted");
    const data = await getTraction();
    assert.equal(data.week.outreach, 1);
    assert.equal(data.doneToday, 1);
  });

  it("moves an imported target to contacted rather than adding a prospect", async () => {
    const imported = await store.importCrmProspect({ company: "Firm", stage: "target", source: "website", reasons: [], crmId: "virtec:inbound:in8" });
    const touched = await store.replyToInboundLead({ company: "Firm", source: "website", reasons: [], crmId: "virtec:inbound:in8" }, "second_touch:in8", "second_touch");
    assert.equal(touched.id, imported.id);
    assert.equal(touched.stage, "contacted");
    assert.equal((await store.readState()).prospects.filter((entry) => entry.crmId === "virtec:inbound:in8").length, 1);
  });

  it("parses the queue id, and refuses to complete it without Virtec's copy", async () => {
    assert.deepEqual(store.parseQueueItemId("second_touch:abc"), { kind: "second_touch", inboundLeadId: "abc" });
    await assert.rejects(store.completeQueueItem("second_touch:abc"), store.TractionNotFoundError);
  });
});
