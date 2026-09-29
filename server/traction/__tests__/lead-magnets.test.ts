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

const { leadMagnetBlockers, LeadMagnetFileSchema, slugFromTitle } = await import("../../../shared/lead-magnet-types");
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
    assert.deepEqual(stats.lm_1, { signups: 3, signupsLast7Days: 2, followedUp: 2, conversations: 1 });
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
