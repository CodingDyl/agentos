import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-traction-"));
process.env.AGENTOS_UI_DIR = directory;

const store = await import("../store");
const mailStore = await import("../../mail/store");
const { getTraction } = await import("../traction");
const { ProspectInputSchema, ProspectPatchSchema, WebsiteSchema } = await import("../../../shared/traction-types");

const tractionDir = path.join(directory, "traction");

beforeEach(() => {
  fs.rmSync(tractionDir, { recursive: true, force: true });
});

after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function input(company: string, extra: Record<string, unknown> = {}) {
  return ProspectInputSchema.parse({ company, ...extra });
}

describe("traction store", () => {
  it("starts empty when nothing has been recorded", async () => {
    const data = await getTraction();
    assert.equal(data.prospects.length, 0);
    assert.equal(data.provider, "local");
    assert.equal(data.targets.conversations, 5);
  });

  it("refuses to read a corrupt record rather than starting over", async () => {
    fs.mkdirSync(tractionDir, { recursive: true });
    fs.writeFileSync(path.join(tractionDir, "state.json"), "{ not json");
    await assert.rejects(store.readState());
  });

  it("records creation and the first contact as events", async () => {
    const created = await store.createProspect(input("ABC Realty"));
    await store.updateProspect(created.id, ProspectPatchSchema.parse({ stage: "conversation" }));

    const events = await store.readEvents();
    assert.deepEqual(
      events.map((event) => [event.kind, event.to]),
      [
        ["created", undefined],
        ["contacted", undefined],
        ["stage_changed", "conversation"],
      ],
    );

    const data = await getTraction();
    assert.equal(data.week.newProspects, 1);
    assert.equal(data.week.outreach, 1);
    assert.equal(data.week.conversations, 1);
    assert.ok(data.prospects[0].lastTouchAt);
  });

  it("clears a field with null and leaves an absent one alone", async () => {
    const created = await store.createProspect(input("XYZ", { contact: "Jane", nextAction: "Call", nextActionDate: "2026-10-01" }));
    const next = await store.updateProspect(created.id, ProspectPatchSchema.parse({ nextAction: null, nextActionDate: null }));

    assert.equal(next.contact, "Jane");
    assert.equal(next.nextAction, undefined);
    assert.equal(next.nextActionDate, undefined);
  });

  it("completing a contact item marks the prospect contacted and counts toward today", async () => {
    const created = await store.createProspect(input("Parkview Realty"));
    const before = await getTraction();
    assert.equal(before.queue[0].id, `contact:${created.id}`);

    const { prospect: done } = await store.completeQueueItem(`contact:${created.id}`);
    assert.equal(done?.stage, "contacted");

    const afterwards = await getTraction();
    assert.equal(afterwards.queue.length, 0);
    assert.equal(afterwards.doneToday, 1);
  });

  it("counts a completed due action as a follow-up past target, and clears it", async () => {
    const created = await store.createProspect(input("Vaja", { stage: "proposal", nextAction: "Follow up on quote", nextActionDate: "2020-01-01" }));
    const { prospect: done } = await store.completeQueueItem(`due:${created.id}`);

    assert.equal(done?.stage, "proposal");
    assert.equal(done?.nextAction, undefined);
    assert.equal(done?.nextActionDate, undefined);
    assert.equal((await getTraction()).week.followUps, 1);
  });

  it("snoozes an item until tomorrow", async () => {
    const created = await store.createProspect(input("BlueStone"));
    const today = (await getTraction()).today;
    await store.snoozeQueueItem(`contact:${created.id}`, today);

    assert.equal((await getTraction()).queue.length, 0);
  });

  it("rejects queue ids it would not have produced", async () => {
    await assert.rejects(store.completeQueueItem("../../etc/passwd"), store.TractionNotFoundError);
    await assert.rejects(store.completeQueueItem("contact:pr_doesnotexist"), store.TractionNotFoundError);
  });

  it("does not lose a write when two land together", async () => {
    await Promise.all([store.createProspect(input("One")), store.createProspect(input("Two")), store.createProspect(input("Three"))]);
    assert.equal((await store.readState()).prospects.length, 3);
  });

  it("unlinks prospects from a removed offer", async () => {
    const offer = await store.createOffer({ name: "Website", offer: "A website", upsells: [] });
    const created = await store.createProspect(input("Linked", { offerId: offer.id }));
    await store.deleteOffer(offer.id);

    const [prospect] = (await store.readState()).prospects;
    assert.equal(prospect.id, created.id);
    assert.equal(prospect.offerId, undefined);
  });
});

describe("waiting on", () => {
  it("chases, reschedules, and resolves — counting the chase as done today", async () => {
    const created = await store.createProspect(input("Story Keeper", { stage: "won" }));
    const item = await store.createWaiting({ who: "Story Keeper", what: "Deposit", since: "2020-01-01", prospectId: created.id });

    const before = await getTraction();
    assert.ok(before.queue.some((entry) => entry.id === `waiting:${item.id}`));

    const { waiting } = await store.completeQueueItem(`waiting:${item.id}`, before.today);
    assert.ok(waiting?.nextFollowUp && waiting.nextFollowUp > before.today);

    const after = await getTraction();
    assert.equal(after.queue.some((entry) => entry.id === `waiting:${item.id}`), false);
    assert.equal(after.doneToday, 1);
    assert.equal(after.week.followUps, 1);

    await store.resolveWaiting(item.id);
    assert.equal((await getTraction()).waiting.length, 0);
  });

  it("refuses a link to a prospect that does not exist", async () => {
    await assert.rejects(
      store.createWaiting({ who: "X", what: "Y", since: "2026-09-01", prospectId: "pr_missing123" }),
      store.TractionNotFoundError,
    );
  });
});

describe("mail links", () => {
  it("suggests a reply, and moves the stage only when confirmed", async () => {
    const created = await store.createProspect(input("XYZ Realty", { stage: "contacted", email: "jane@xyzrealty.co.za" }));
    mailStore.insertThreadIfNew({
      threadId: "thread-xyz-1",
      fromName: "Jane",
      fromEmail: "jane@xyzrealty.co.za",
      subject: "Re: your website",
      snippet: "Sounds interesting",
      messageDate: new Date(Date.now() + 60_000).toISOString(),
    });

    const [suggestion] = (await getTraction()).mailSuggestions;
    assert.equal(suggestion.prospectId, created.id);
    assert.equal(suggestion.moveTo, "conversation");
    // A suggestion changes nothing on its own.
    assert.equal((await store.readState()).prospects[0].stage, "contacted");

    const moved = await store.confirmMailLink({ threadId: "thread-xyz-1", prospectId: created.id, moveTo: "conversation" });
    assert.equal(moved.stage, "conversation");

    const after = await getTraction();
    assert.equal(after.mailSuggestions.length, 0);
    assert.equal(after.mailThreads[created.id][0].subject, "Re: your website");
    assert.equal(after.week.conversations, 1);
  });
});

describe("virtec", () => {
  it("handling a CRM follow-up counts as a follow-up and holds it off the queue", async () => {
    const today = (await getTraction()).today;
    await store.completeQueueItem("crm:followup123", today);

    const state = await store.readState();
    assert.ok(state.snoozes.some((snooze) => snooze.itemId === "crm:followup123" && snooze.until > today));
    const data = await getTraction();
    assert.equal(data.week.followUps, 1);
    assert.equal(data.doneToday, 1);
  });

  it("answering a reply records a touch, so it stops asking", async () => {
    const created = await store.createProspect({ ...input("Reply Co", { stage: "contacted" }), stage: "contacted" });
    assert.equal(store.parseQueueItemId(`reply:${created.id}`)?.kind, "reply");

    const before = (await store.readState()).prospects[0];
    const { prospect } = await store.completeQueueItem(`reply:${created.id}`);
    assert.ok(prospect?.lastTouchAt && prospect.lastTouchAt >= (before.lastTouchAt ?? before.createdAt));
    assert.equal(prospect?.stage, "contacted", "answering never moves the stage");
    assert.equal((await getTraction()).week.followUps, 1);
  });

  it("marks a portal view handled for a week, and a later view on another day is new", async () => {
    const parsed = store.parseQueueItemId("viewed:p1:20260927");
    assert.deepEqual(parsed, { kind: "viewed", projectId: "p1", day: "20260927" });
    assert.equal(store.parseQueueItemId("viewed:p1:notaday"), undefined);

    const today = new Date().toISOString().slice(0, 10);
    await store.completeQueueItem("viewed:p1:20260927", today);
    const state = await store.readState();
    assert.ok(state.snoozes.some((snooze) => snooze.itemId === "viewed:p1:20260927" && snooze.until > today));
    assert.equal((await getTraction()).week.followUps, 1, "counted as a follow-up");
    await store.snoozeQueueItem("viewed:p1:20260928", today, 1);
  });

  it("imports a CRM record once", async () => {
    const input = ProspectInputSchema.parse({ company: "Acme", stage: "won", crmId: "virtec:client:c1" });
    await store.importCrmProspect({ ...input, crmId: "virtec:client:c1" });
    await assert.rejects(store.importCrmProspect({ ...input, crmId: "virtec:client:c1" }), store.TractionConflictError);
    assert.equal((await store.readState()).prospects.length, 1);
  });

  it("turns a replied website lead into a prospect in conversation, counted as a follow-up", async () => {
    const { inboundToProspect } = await import("../crm");
    const mapped = ProspectInputSchema.parse(
      inboundToProspect({ id: "in1", name: "Jane", company: "Smith Inc", email: "jane@smith.test", source: "demo-request", track: "jurivo", details: {} }, "2026-09-28", true),
    );
    await store.snoozeQueueItem("inbound:in1", "2026-09-28", 1);

    const first = await store.replyToInboundLead({ ...mapped, crmId: "virtec:inbound:in1" }, "inbound:in1");
    assert.equal(first.stage, "conversation");
    assert.equal(first.source, "website");
    assert.ok(first.lastTouchAt);

    // A second reply reuses the prospect rather than creating another.
    const second = await store.replyToInboundLead({ ...mapped, crmId: "virtec:inbound:in1" }, "inbound:in1");
    assert.equal(second.id, first.id);

    const state = await store.readState();
    assert.equal(state.prospects.length, 1);
    assert.equal(state.snoozes.some((snooze) => snooze.itemId === "inbound:in1"), false);
    assert.equal((await getTraction()).doneToday, 2);
  });

  it("will not complete a website lead without its Virtec details", async () => {
    await assert.rejects(store.completeQueueItem("inbound:in1"), store.TractionNotFoundError);
  });

  it("reports Virtec as not configured without contacting anything", async () => {
    const data = await getTraction();
    assert.equal(data.crm.configured, false);
    assert.match(data.crm.problem ?? "", /VIRTEC_BASE_URL/);
  });
});

describe("case studies", () => {
  it("starts one per source, and a second start returns the first", async () => {
    const first = await store.startCaseStudy({ title: "Vaja — Configurator", client: "Vaja", source: "virtec:project:p1" }, { autoTitle: true });
    const again = await store.startCaseStudy({ title: "Other", client: "Vaja", source: "virtec:project:p1" });
    assert.equal(again.id, first.id);
    assert.equal((await store.readState()).caseStudies.length, 1);
  });

  it("fills only empty sections, and replaces the title only while it is automatic", async () => {
    const study = await store.startCaseStudy({ title: "Vaja — Configurator", client: "Vaja", source: "virtec:project:p2" }, { autoTitle: true });
    await store.replaceCaseStudy(study.id, { title: study.title, client: "Vaja", problem: "Written by Dylan", missing: [] });

    const drafted = await store.applyCaseStudyDraft(study.id, {
      title: "A 3D configurator that sells",
      problem: "Hermes problem",
      solution: "Hermes solution",
      missing: ["Conversion before and after"],
    });

    assert.equal(drafted.problem, "Written by Dylan");
    assert.equal(drafted.solution, "Hermes solution");
    assert.equal(drafted.title, "A 3D configurator that sells");
    assert.deepEqual(drafted.missing, ["Conversion before and after"]);

    await store.replaceCaseStudy(study.id, { ...drafted, title: "My own title", missing: [] });
    const redrafted = await store.applyCaseStudyDraft(study.id, { title: "Hermes again", missing: [] });
    assert.equal(redrafted.title, "My own title");
  });

  it("refuses to mark a study ready while data is missing", async () => {
    const study = await store.startCaseStudy({ title: "T", client: "C", result: "Enquiries up [NEEDS DATA: numbers]" });
    await assert.rejects(
      store.replaceCaseStudy(study.id, { title: "T", client: "C", result: study.result, status: "ready", missing: [] }),
      store.TractionConflictError,
    );
    await assert.rejects(
      store.replaceCaseStudy(study.id, { title: "T", client: "C", result: "Enquiries doubled", status: "ready", missing: ["Screenshots"] }),
      store.TractionConflictError,
    );
    const ready = await store.replaceCaseStudy(study.id, { title: "T", client: "C", result: "Enquiries doubled", status: "ready", missing: [] });
    assert.equal(ready.status, "ready");
  });

  it("will not draft from nothing, and never calls Hermes to find out", async () => {
    const { draftCaseStudy, CaseStudyDraftError } = await import("../case-study-draft");
    const study = await store.startCaseStudy({ title: "Empty", client: "Nobody" });
    await assert.rejects(draftCaseStudy(study.id), CaseStudyDraftError);
  });
});

describe("website validation", () => {
  it("accepts http(s) and refuses script and data urls", () => {
    assert.equal(WebsiteSchema.safeParse("https://parkview.co.za").success, true);
    assert.equal(WebsiteSchema.safeParse("javascript:alert(1)").success, false);
    assert.equal(WebsiteSchema.safeParse("data:text/html,hi").success, false);
    assert.equal(WebsiteSchema.safeParse("parkview").success, false);
  });
});
