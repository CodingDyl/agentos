import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftGaps, OutreachCaseSchema, SenderSchema, type OutreachCase, type Sender } from "@shared/outreach-case";
import { planPitchDraft, suggestedSender, type PitchDraftInput } from "../traction-pitch-model";

const sender = (id: string, company: string): Sender =>
  SenderSchema.parse({ id, company, fromName: `Dylan at ${company}`, signature: `Dylan, ${company}`, createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z" });
const VIRTARA = sender("snd_virtara", "Virtara");
const VIRTEC = sender("snd_virtec", "Virtec");

const entry = (fields: Partial<OutreachCase> = {}): OutreachCase =>
  ({ ...OutreachCaseSchema.parse({ prospectId: "p1" }), path: "build_first", offer: "A new site.", findings: ["No booking button."], ...fields }) as OutreachCase;

const plan = (fields: Partial<PitchDraftInput> = {}) =>
  planPitchDraft({ entry: entry(), senders: [VIRTARA, VIRTEC], previewUrl: "https://preview.example", findings: [], quoteCompany: undefined, ...fields });

describe("suggestedSender", () => {
  it("offers your only company", () => {
    assert.equal(suggestedSender([VIRTARA], undefined)?.id, VIRTARA.id);
  });

  it("does not guess between companies", () => {
    assert.equal(suggestedSender([VIRTARA, VIRTEC], undefined), undefined);
    assert.equal(suggestedSender([], undefined), undefined);
  });

  it("offers the company the quote is in, whatever the case of its name", () => {
    assert.equal(suggestedSender([VIRTARA, VIRTEC], " virtec ")?.id, VIRTEC.id);
  });

  it("offers nothing when the quote is in a company you do not send as, even with only one company", () => {
    assert.equal(suggestedSender([VIRTARA], "Virtec"), undefined);
  });
});

describe("planPitchDraft", () => {
  it("is not ready without a company, and says so in the server's words", () => {
    const result = plan();
    assert.equal(result.ready, false);
    assert.equal(result.needsSender, true);
    assert.deepEqual(result.gaps, ["which company it is from"]);
    assert.deepEqual(result.patch, {});
  });

  it("is ready once a company is chosen, and saves it", () => {
    const result = plan({ chosenSenderId: VIRTEC.id });
    assert.equal(result.ready, true);
    assert.deepEqual(result.patch, { senderId: VIRTEC.id });
  });

  it("saves an offered company on the same press", () => {
    const result = plan({ senders: [VIRTARA] });
    assert.equal(result.ready, true);
    assert.deepEqual(result.patch, { senderId: VIRTARA.id });
  });

  it("saves nothing when the case already has what it needs", () => {
    const result = plan({ entry: entry({ senderId: VIRTARA.id }) });
    assert.equal(result.ready, true);
    assert.deepEqual(result.patch, {});
  });

  it("lets a new choice replace the company on the case", () => {
    assert.deepEqual(plan({ entry: entry({ senderId: VIRTARA.id }), chosenSenderId: VIRTEC.id }).patch, { senderId: VIRTEC.id });
  });

  it("treats a company that has been removed as no company", () => {
    const result = plan({ entry: entry({ senderId: "snd_gone" }) });
    assert.equal(result.needsSender, true);
    assert.equal(result.ready, false);
  });

  it("uses the findings on the card as the opening when the case has none", () => {
    const result = plan({ entry: entry({ findings: [], senderId: VIRTARA.id }), findings: ["The copyright says 2021."] });
    assert.equal(result.ready, true);
    assert.equal(result.asksHook, false);
    assert.deepEqual(result.patch, { findings: ["The copyright says 2021."] });
  });

  it("never replaces an opening you wrote", () => {
    const result = plan({ entry: entry({ findings: [], hook: "Saw your phone number is hard to find.", senderId: VIRTARA.id }), findings: ["Something else."] });
    assert.deepEqual(result.patch, {});
  });

  it("asks for an opening when there is nothing to use", () => {
    const result = plan({ entry: entry({ findings: [], senderId: VIRTARA.id }) });
    assert.equal(result.asksHook, true);
    assert.deepEqual(result.gaps, ["an opening line or something you noticed"]);
    const typed = plan({ entry: entry({ findings: [], senderId: VIRTARA.id }), hook: "  No booking.  " });
    assert.equal(typed.ready, true);
    assert.deepEqual(typed.patch, { hook: "No booking." });
  });

  it("asks for the offer when there is none, and saves what you type", () => {
    const result = plan({ entry: entry({ offer: "", senderId: VIRTARA.id }) });
    assert.equal(result.asksOffer, true);
    assert.deepEqual(result.gaps, ["the offer"]);
    const typed = plan({ entry: entry({ offer: "", senderId: VIRTARA.id }), offer: "A new site." });
    assert.equal(typed.ready, true);
    assert.deepEqual(typed.patch, { offer: "A new site." });
  });

  it("does not count the preview as a gap: the server copies it from the rebuild", () => {
    const result = plan({ entry: entry({ previewUrl: "", senderId: VIRTARA.id }) });
    assert.deepEqual(result.gaps, []);
  });

  it("when it says ready, the server's own check on the saved case agrees", () => {
    const start = entry({ findings: [], offer: "", previewUrl: "" });
    const result = plan({ entry: start, findings: ["Finding."], offer: "An offer.", chosenSenderId: VIRTEC.id });
    assert.equal(result.ready, true);
    const saved = { ...start, ...result.patch, previewUrl: "https://preview.example" } as OutreachCase;
    assert.deepEqual(draftGaps(saved, VIRTEC), []);
  });
});
