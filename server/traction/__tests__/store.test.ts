import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-traction-"));
process.env.AGENTOS_UI_DIR = directory;

const store = await import("../store");
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

    const done = await store.completeQueueItem(`contact:${created.id}`);
    assert.equal(done.stage, "contacted");

    const afterwards = await getTraction();
    assert.equal(afterwards.queue.length, 0);
    assert.equal(afterwards.doneToday, 1);
  });

  it("counts a completed due action as a follow-up past target, and clears it", async () => {
    const created = await store.createProspect(input("Vaja", { stage: "proposal", nextAction: "Follow up on quote", nextActionDate: "2020-01-01" }));
    const done = await store.completeQueueItem(`due:${created.id}`);

    assert.equal(done.stage, "proposal");
    assert.equal(done.nextAction, undefined);
    assert.equal(done.nextActionDate, undefined);
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

describe("website validation", () => {
  it("accepts http(s) and refuses script and data urls", () => {
    assert.equal(WebsiteSchema.safeParse("https://parkview.co.za").success, true);
    assert.equal(WebsiteSchema.safeParse("javascript:alert(1)").success, false);
    assert.equal(WebsiteSchema.safeParse("data:text/html,hi").success, false);
    assert.equal(WebsiteSchema.safeParse("parkview").success, false);
  });
});
