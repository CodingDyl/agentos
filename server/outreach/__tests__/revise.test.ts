import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-revise-"));
process.env.AGENTOS_UI_DIR = directory;

const store = await import("../../traction/store");
const { saveSender, writeCase } = await import("../cases");
const { buildRevisePacket, newFacts, ReviseError, reviseDraft, splitSignature } = await import("../revise");
const { ChatStateError } = await import("../../chat/chat-service");
const { ProspectInputSchema } = await import("../../../shared/traction-types");
const { OutreachCaseSchema } = await import("../../../shared/outreach-case");

const SIGNATURE = 'Dylan, Virtara\nNot for you? Reply "no thanks" and I will not email you again.';
const MESSAGE = "Hi Jane,\n\nYour listing pages have no viewing button on mobile.\n\nWorth a quick look?";
const BODY = `${MESSAGE}\n\n--\n${SIGNATURE}`;

beforeEach(() => {
  fs.rmSync(path.join(directory, "traction"), { recursive: true, force: true });
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));

async function seed() {
  const prospect = await store.createProspect(ProspectInputSchema.parse({ company: "Parkview Realty", contact: "Jane Doe", email: "jane@parkview.example", website: "https://parkview.example" }));
  const sender = await saveSender({ company: "Virtara", fromName: "Dylan at Virtara", about: "Websites for small businesses", website: "virtara.co.za", signature: SIGNATURE, defaultMonthly: "R450 a month", defaultSetup: "", defaultProject: "from R25,000" });
  await writeCase(prospect.id, { hook: "No viewing button on mobile.", path: "cold_pitch", offer: "A new property site", projectPrice: "from R25,000", senderId: sender.id }, "you");
  return prospect;
}

const request = (over: Record<string, unknown> = {}) => ({ agent: "claude" as const, instruction: "Make it shorter", subject: "Your listing pages", body: BODY, ...over });
const answers = (subject: string, body: string) => ({ ask: async () => JSON.stringify({ subject, body }), skill: async () => undefined });

describe("splitting off the signature", () => {
  it("keeps the signature block verbatim and the message clean", () => {
    assert.deepEqual(splitSignature(BODY), { message: MESSAGE, tail: `--\n${SIGNATURE}` });
    assert.deepEqual(splitSignature("No signature."), { message: "No signature.", tail: "" });
  });
});

describe("what the agent is told", () => {
  const prospect = { id: "p", company: "Parkview Realty", contact: "Jane Doe", email: "secret@parkview.example", stage: "target", reasons: [] } as never;
  const entry = OutreachCaseSchema.parse({ prospectId: "p", hook: "No viewing button.", offer: "A new site", path: "cold_pitch", projectPrice: "from R25,000" });

  it("has the instruction, the email without its signature, the notes as the only facts, and no tools", () => {
    const packet = buildRevisePacket({ prospect, entry, touch: 1, subject: "Your listing pages", message: MESSAGE, instruction: "Make it shorter" });
    assert.match(packet, /MY INSTRUCTION: Make it shorter/);
    assert.match(packet, /<<<CURRENT EMAIL\nSubject: Your listing pages\n\nHi Jane,/);
    assert.doesNotMatch(packet, /Not for you\?|Dylan, Virtara/, "the signature never goes to the agent");
    assert.match(packet, /THE NOTES \(the only source of facts\)/);
    assert.match(packet, /PROJECT PRICE: from R25,000/);
    assert.match(packet, /Use no tools/);
    assert.match(packet, /Do not add any fact, number, price, link/);
    assert.doesNotMatch(packet, /secret@parkview\.example/, "their address is never sent");
  });

  it("holds a follow-up to its shorter ceiling, and puts the style guide before the rules that win", () => {
    const packet = buildRevisePacket({ prospect, entry, touch: 2, skill: "BE PLAIN", subject: "s", message: MESSAGE, instruction: "Warmer" });
    assert.match(packet, /under 80 words/);
    assert.ok(packet.indexOf("STYLE GUIDE>>>") > 0);
    assert.match(packet, /tone only; the rules above win/);
  });
});

describe("spotting facts the agent made up", () => {
  const allowed = "Hi Jane. See https://preview.example/jane for it. It is R450 a month, from R25,000. Mail me at dylan@virtara.co.za.";

  it("accepts links, addresses and amounts that were already there, however they are spaced", () => {
    assert.deepEqual(newFacts("Take a look at https://preview.example/jane. R450 a month, or from R25 000, dylan@virtara.co.za", allowed), []);
  });

  it("flags a new link, a new address and a new price", () => {
    assert.deepEqual(newFacts("Try https://other.example/x and mail sam@other.example. Only R299 a month!", allowed).sort(), ["R299", "https://other.example/x", "sam@other.example"].sort());
  });

  it("does not mistake a number after a price for part of it", () => {
    assert.deepEqual(newFacts("R450 20 businesses use it", "It is R450 a month"), []);
  });
});

describe("revising a draft", () => {
  it("rewrites the message, puts the original signature back exactly, and says it changed", async () => {
    const prospect = await seed();
    const result = await reviseDraft(prospect.id, request(), answers("Your listing pages", "Hi Jane,\n\nNo viewing button on your mobile listings. Worth a look?"));
    assert.equal(result.body, `Hi Jane,\n\nNo viewing button on your mobile listings. Worth a look?\n\n--\n${SIGNATURE}`);
    assert.equal(result.changed, true);
    assert.equal(result.agent, "claude");
  });

  it("replaces a signature the agent wrote anyway with the real one", async () => {
    const prospect = await seed();
    const result = await reviseDraft(prospect.id, request(), answers("Your listing pages", "Hi Jane,\n\nShorter.\n\n--\nDylan (invented)\nNot for you? whatever"));
    assert.equal(result.body, `Hi Jane,\n\nShorter.\n\n--\n${SIGNATURE}`);
  });

  it("can change the subject, and reports no change when nothing changed", async () => {
    const prospect = await seed();
    assert.equal((await reviseDraft(prospect.id, request(), answers("A better subject", MESSAGE))).subject, "A better subject");
    assert.equal((await reviseDraft(prospect.id, request(), answers("Your listing pages", MESSAGE))).changed, false);
  });

  it("passes the agent, model and prompt through, and the instruction reaches the prompt", async () => {
    const prospect = await seed();
    let seen: { agent: string; model?: string; prompt: string } | undefined;
    await reviseDraft(prospect.id, request({ agent: "codex", model: "gpt-x", instruction: "Drop the question" }), {
      ask: async (input) => {
        seen = input;
        return JSON.stringify({ subject: "s", body: "Hi" });
      },
      skill: async () => undefined,
    });
    assert.equal(seen?.agent, "codex");
    assert.equal(seen?.model, "gpt-x");
    assert.match(seen?.prompt ?? "", /MY INSTRUCTION: Drop the question/);
  });

  it("refuses an answer that adds a link, an address or a price, and changes nothing", async () => {
    const prospect = await seed();
    for (const added of ["See https://made-up.example for more.", "Mail me at fake@made-up.example.", "It is only R99 a month."]) {
      await assert.rejects(reviseDraft(prospect.id, request(), answers("Your listing pages", `Hi Jane,\n\n${added}`)), (error: unknown) => error instanceof ReviseError && /not in the email or your notes/.test(error.message));
    }
  });

  it("allows a price that is in the notes, and a link that was in the email", async () => {
    const prospect = await seed();
    const withLink = `${MESSAGE}\nSee https://preview.example/jane`;
    const result = await reviseDraft(prospect.id, request({ body: `${withLink}\n\n--\n${SIGNATURE}` }), answers("Your listing pages", `Hi Jane,\n\nFrom R25,000. See https://preview.example/jane`));
    assert.match(result.body, /From R25,000/);
  });

  it("explains an answer it cannot read, an empty one, and an agent that is unavailable", async () => {
    const prospect = await seed();
    await assert.rejects(reviseDraft(prospect.id, request(), { ask: async () => "Sure! Here you go.", skill: async () => undefined }), /not with an email AgentOS could read/);
    await assert.rejects(reviseDraft(prospect.id, request(), answers("s", "\n\n--\nsig")), /empty email/);
    await assert.rejects(
      reviseDraft(prospect.id, request(), {
        ask: async () => {
          throw new ChatStateError("Codex isn't installed.");
        },
        skill: async () => undefined,
      }),
      (error: unknown) => error instanceof ReviseError && error.status === 502 && /Codex isn't installed/.test(error.message),
    );
  });

  it("refuses an unknown prospect, and an email that is only a signature", async () => {
    await assert.rejects(reviseDraft("pr_missing", request(), answers("s", "b")), store.TractionNotFoundError);
    const prospect = await seed();
    await assert.rejects(reviseDraft(prospect.id, request({ body: `--\n${SIGNATURE}` }), answers("s", "b")), ReviseError);
  });
});
