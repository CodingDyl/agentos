import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-library-"));
process.env.AGENTOS_UI_DIR = directory;

const { MemoryService } = await import("../../memory/service");
const { exampleLines, listLibrary, LibraryError, pickExamples, redactForLibrary, saveToLibrary, stripSignature } = await import("../library");
const { buildCaseDraftPacket } = await import("../cases");
const { loadOutreachSkill } = await import("../style");
const { OutreachCaseSchema } = await import("../../../shared/outreach-case");

const FACTS = { company: "Parkview Properties", contact: "Jane Dlamini", website: "https://www.parkview.example/home" };

describe("making an email safe to reuse", () => {
  it("replaces the business's details with placeholders", () => {
    const text = "Hi Jane,\n\nParkview Properties has no viewing button. See parkview.example or https://x.example/preview and jane@parkview.example. Jane Dlamini agreed.";
    const out = redactForLibrary(text, FACTS);
    assert.doesNotMatch(out, /Parkview|Jane|Dlamini|parkview\.example|x\.example/i);
    assert.match(out, /Hi \[Name\],/);
    assert.match(out, /\[Company\] has no viewing button/);
    assert.match(out, /\[link\]/);
    assert.match(out, /\[email\]/);
  });

  it("leaves unrelated words alone and survives regex characters in a name", () => {
    assert.equal(redactForLibrary("Hello there", { company: "A+B (Pty) Ltd" }), "Hello there");
    assert.equal(redactForLibrary("A+B (Pty) Ltd is great", { company: "A+B (Pty) Ltd" }), "[Company] is great");
    // A short first name must not be cut out of longer words.
    assert.equal(redactForLibrary("Anna and Annabel", { contact: "Al Smith" }), "Anna and Annabel");
  });

  it("cuts the signature, which AgentOS adds at send time", () => {
    assert.equal(stripSignature("Hi\n\nBody.\n\n--\nDylan, Virtara\nNot for you? Reply no thanks."), "Hi\n\nBody.");
    assert.equal(stripSignature("No signature here"), "No signature here");
  });
});

describe("the library in the vault", () => {
  let root: string;
  let service: InstanceType<typeof MemoryService>;

  before(async () => {
    root = fs.mkdtempSync(path.join(directory, "vault-"));
    fs.writeFileSync(path.join(root, "Home.md"), "# Home\n");
    service = new MemoryService({ root, cacheFile: path.join(directory, "cache.json"), probeMs: 60_000, reconcileMs: 60_000 });
    await service.start();
  });

  after(() => service.stop());

  const base = { touch: 1 as const, gotReply: false, note: "", facts: FACTS };

  it("saves a redacted note, readable in Obsidian, and lists it back", async () => {
    const saved = await saveToLibrary(
      service,
      {
        ...base,
        subject: "Parkview Properties and mobile viewings",
        body: "Hi Jane,\n\nNo viewing button on mobile for Parkview Properties.\n\nWorth a look?\n\n--\nDylan, Virtara\nNot for you? Reply no thanks.",
        path: "cold_pitch",
        gotReply: true,
        note: "Jane replied the same day",
      },
      new Date(2026, 9, 13, 9, 30),
    );
    assert.match(saved.id, /^Outreach\/Email library\/First email - .* - 2026-10-13\.md$/);

    const onDisk = fs.readFileSync(path.join(root, saved.id), "utf8");
    assert.doesNotMatch(onDisk, /Parkview|Jane|Dylan|Not for you/);
    assert.match(onDisk, /tags: \[email-library, touch-1, cold-pitch, got-a-reply\]/);

    const [email] = listLibrary(service);
    assert.equal(email.id, saved.id);
    assert.equal(email.subject, "[Company] and mobile viewings");
    assert.equal(email.body, "Hi [Name],\n\nNo viewing button on mobile for [Company].\n\nWorth a look?");
    assert.equal(email.touch, 1);
    assert.equal(email.path, "cold_pitch");
    assert.equal(email.gotReply, true);
    assert.equal(email.note, "[Name] replied the same day");
  });

  it("keeps two emails with the same subject on the same day", async () => {
    const input = { ...base, subject: "Same subject", body: "Body one." };
    const first = await saveToLibrary(service, input, new Date(2026, 9, 14, 9, 30));
    const second = await saveToLibrary(service, { ...input, body: "Body two." }, new Date(2026, 9, 14, 9, 31));
    assert.notEqual(first.id, second.id);
    assert.match(second.id, /2026-10-14 0931\.md$/);
  });

  it("refuses an empty email and ignores notes in the folder that are not library emails", async () => {
    await assert.rejects(saveToLibrary(service, { ...base, subject: "https://only.example/link", body: "   " }), LibraryError);
    fs.writeFileSync(path.join(root, "Outreach/Email library/Stray.md"), "# Just a stray note\n");
    await service.reindex();
    assert.ok(listLibrary(service).every((email) => email.title !== "Just a stray note"));
  });
});

describe("choosing examples", () => {
  const make = (id: string, over: Partial<ReturnType<typeof listLibrary>[number]>) => ({
    id,
    title: id,
    subject: `Subject ${id}`,
    body: `Body ${id}`,
    touch: 1 as const,
    gotReply: false,
    note: "",
    savedAt: "2026-10-01T00:00:00Z",
    ...over,
  });
  const library = [
    make("old-first", { savedAt: "2026-09-01T00:00:00Z" }),
    make("new-first", { savedAt: "2026-10-10T00:00:00Z" }),
    make("replied-first", { gotReply: true, savedAt: "2026-08-01T00:00:00Z" }),
    make("pitch-first", { path: "cold_pitch" }),
    make("follow", { touch: 2 }),
    make("last", { touch: 3 }),
  ];

  it("uses only the same step of the sequence, replied ones first, then the same approach, then the newest", () => {
    assert.deepEqual(pickExamples(library, { touch: 1, path: "cold_pitch" }).map((email) => email.id), ["replied-first", "pitch-first", "new-first"]);
    assert.deepEqual(pickExamples(library, { touch: 2 }).map((email) => email.id), ["follow"]);
    assert.deepEqual(pickExamples(library, { touch: 7 }).map((email) => email.id), ["last"], "a fourth email is modelled on the last follow-up");
  });

  it("uses a chosen example alone, and falls back when it is gone", () => {
    assert.deepEqual(pickExamples(library, { touch: 2, chosenId: "old-first" }).map((email) => email.id), ["old-first"]);
    assert.deepEqual(pickExamples(library, { touch: 2, chosenId: "deleted" }).map((email) => email.id), ["follow"]);
  });

  it("shows examples fenced as data, and nothing when there are none", () => {
    assert.deepEqual(exampleLines([]), []);
    const text = exampleLines([library[2]]).join("\n");
    assert.match(text, /<<<EXAMPLES[\s\S]*Example 1 \(got a reply\)[\s\S]*EXAMPLES>>>/);
    assert.match(text, /never reuse a sentence or a detail/);
  });
});

describe("the client-outreach skill", () => {
  it("is bundled, valid and covers all three emails", async () => {
    const skill = await loadOutreachSkill();
    assert.ok(skill);
    assert.match(skill, /Email 1/);
    assert.match(skill, /Email 2/);
    assert.match(skill, /Email 3/);
  });

  it("is skipped when switched off on the Connectors page", async () => {
    const file = path.join(directory, "skills.json");
    fs.writeFileSync(file, JSON.stringify({ enabled: { "client-outreach": false } }));
    assert.equal(await loadOutreachSkill(), undefined);
    fs.writeFileSync(file, JSON.stringify({ enabled: { "client-outreach": true } }));
    assert.ok(await loadOutreachSkill());
    fs.rmSync(file);
  });
});

describe("the draft packet", () => {
  const prospect = { id: "p1", company: "Parkview", contact: "Jane", stage: "target", reasons: [] } as never;
  const entry = OutreachCaseSchema.parse({ prospectId: "p1", hook: "No viewing button.", path: "cold_pitch", offer: "A new site", findings: [] });
  const sender = { id: "s1", company: "Virtara", fromName: "Dylan", about: "", website: "", signature: "Sig", defaultMonthly: "", defaultSetup: "", defaultProject: "" } as never;

  it("puts the style guide first and the hard rules after it, so the rules win", () => {
    const packet = buildCaseDraftPacket({ prospect, entry, sender, followUp: false, skill: "BE FRIENDLY" });
    assert.ok(packet.indexOf("BE FRIENDLY") > 0);
    assert.ok(packet.indexOf("STYLE GUIDE>>>") < packet.indexOf("Rules:"));
    assert.match(packet, /Never invent numbers, clients, results or compliments/);
    assert.match(packet, /do not add an opt-out line/);
    assert.match(packet, /Under 120 words/);
    assert.match(packet, /first email they will get/);
  });

  it("asks for a shorter email at each step, and builds on the one already sent", () => {
    const second = buildCaseDraftPacket({ prospect, entry, sender, followUp: true, touch: 2, previous: { subject: "Your listings", body: "Original body" } });
    assert.match(second, /DRAFT A FOLLOW-UP EMAIL/);
    assert.match(second, /Under 80 words/);
    assert.match(second, /Subject: Your listings/);
    assert.match(second, /<<<EARLIER EMAIL\nOriginal body\nEARLIER EMAIL>>>/);

    const last = buildCaseDraftPacket({ prospect, entry, sender, followUp: true, touch: 3 });
    assert.match(last, /DRAFT THE LAST FOLLOW-UP EMAIL/);
    assert.match(last, /Under 60 words/);
    assert.match(last, /This is the last email/);

    const fifth = buildCaseDraftPacket({ prospect, entry, sender, followUp: true, touch: 5 });
    assert.match(fifth, /Under 60 words/, "never longer than the last follow-up");
  });

  it("still works with no skill and no examples", () => {
    const packet = buildCaseDraftPacket({ prospect, entry, sender, followUp: false });
    assert.doesNotMatch(packet, /STYLE GUIDE|EXAMPLES/);
    assert.match(packet, /Rules:/);
  });
});

after(() => fs.rmSync(directory, { recursive: true, force: true }));
