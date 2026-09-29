import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import express from "express";
import type { Icp, Offer, Prospect } from "../../../shared/traction-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-outreach-routes-"));
process.env.AGENTOS_UI_DIR = directory;
process.env.GOOGLE_CLIENT_ID = "client-id";
process.env.GOOGLE_CLIENT_SECRET = "client-secret";
process.env.HERMES_API_KEY = "hermes-key";

const { buildEmailPacket, draftingBlocker, NOT_ENOUGH_CONTEXT, readEmailDraft, recipientBlocker, withSignature } = await import("../draft");
const { outreachRouter } = await import("../routes");
const { COMPOSE_SCOPE, READ_SCOPE, completeOutreachConnection, disconnectOutreach, resetOutreachTokenCache } = await import("../auth");
const store = await import("../../traction/store");
const { ProspectInputSchema } = await import("../../../shared/traction-types");

const realFetch = globalThis.fetch;
const SIGNATURE = 'Dylan, Virtara (virtara.co.za)\nNot for you? Reply "no thanks" and I will not email you again.';

const icp: Icp = { name: "Independent estate agencies", offer: "Conversion-focused websites", idealProspect: ["2 to 20 agents"], updatedAt: "2026-10-01T00:00:00Z" };
const offer: Offer = { id: "of_1", name: "Real estate website", offer: "A site that turns listing views into viewing requests", problem: "Enquiries leak on mobile", upsells: [], createdAt: "", updatedAt: "" };

function prospect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: "pr_test0001",
    company: "Parkview Realty",
    contact: "Jane Doe",
    email: "jane@parkview.example",
    website: "https://parkview.example",
    stage: "target",
    source: "outbound",
    reasons: ["Independent agency"],
    observation: "Property pages have no viewing-enquiry button on mobile",
    offerId: "of_1",
    notes: "PRIVATE: she mentioned a divorce, phone 082 111 2222",
    phone: "082 111 2222",
    stageChangedAt: "2026-10-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  } as Prospect;
}

describe("what Hermes is told", () => {
  it("carries the public facts and the guard, and never an address, phone or private note", () => {
    const packet = buildEmailPacket({ prospect: prospect(), icp, offer });
    assert.match(packet, /DRAFT A FIRST OUTREACH EMAIL/);
    assert.match(packet, /Property pages have no viewing-enquiry button on mobile/);
    assert.match(packet, /A site that turns listing views into viewing requests/);
    assert.match(packet, new RegExp(NOT_ENOUGH_CONTEXT));
    assert.match(packet, /Never invent numbers, clients, results or compliments/);
    for (const private_ of ["jane@parkview.example", "082 111 2222", "PRIVATE", "divorce"]) assert.equal(packet.includes(private_), false, private_);
  });

  it("asks for a follow-up once there has been contact", () => {
    assert.match(buildEmailPacket({ prospect: prospect({ stage: "contacted" }), icp, offer }), /DRAFT A FOLLOW-UP EMAIL/);
    assert.match(buildEmailPacket({ prospect: prospect({ lastTouchAt: "2026-10-02T00:00:00Z" }), icp, offer }), /DRAFT A FOLLOW-UP EMAIL/);
  });
});

describe("reading Hermes' answer", () => {
  it("reads a JSON email, tidies the subject, and adds the signature last", () => {
    const draft = readEmailDraft('```json\n{ "subject": "Your listing\\npages", "body": "Hi Jane,\\n\\nOne thing." }\n```');
    assert.equal(draft.subject, "Your listing pages");
    assert.equal(withSignature(draft.body, SIGNATURE), `Hi Jane,\n\nOne thing.\n\n--\n${SIGNATURE}`);
  });

  it("surfaces 'not enough context' as the reason, and refuses anything unreadable", () => {
    assert.throws(() => readEmailDraft(`${NOT_ENOUGH_CONTEXT}\nMissing: what they sell`), /Hermes needs more to go on: Missing: what they sell/);
    assert.throws(() => readEmailDraft("Sure! Here is a draft: Hi Jane"), /not with an email/);
    assert.throws(() => readEmailDraft('{ "subject": "", "body": "x" }'), /without a subject or a body/);
  });
});

describe("who can be written to", () => {
  it("needs a valid address, an open prospect and a signature", () => {
    assert.equal(recipientBlocker(prospect(), SIGNATURE), undefined);
    assert.match(recipientBlocker(prospect({ email: undefined }), SIGNATURE) ?? "", /valid email address/);
    assert.match(recipientBlocker(prospect({ email: "jane@x.co\r\nBcc: e@evil.co" }), SIGNATURE) ?? "", /valid email address/);
    assert.match(recipientBlocker(prospect({ stage: "won" }), SIGNATURE) ?? "", /closed/);
    assert.match(recipientBlocker(prospect(), "  ") ?? "", /signature/);
  });

  it("will not have Hermes draft without something specific to say", () => {
    assert.equal(draftingBlocker(prospect(), icp, [offer], SIGNATURE), undefined);
    assert.match(draftingBlocker(prospect({ observation: undefined, website: undefined }), icp, [offer], SIGNATURE) ?? "", /their website, one specific thing/);
    assert.match(draftingBlocker(prospect(), undefined, [offer], SIGNATURE) ?? "", /an ICP/);
  });
});

// ─── The routes, over HTTP, with Google and Hermes faked ───────────────────

let server: ReturnType<express.Express["listen"]>;
let base = "";
let hermesReply = '{ "subject": "Your listing pages", "body": "Hi Jane,\\n\\nSaw your mobile listing pages have no viewing button." }';
const googleCalls: { url: string; body?: string }[] = [];
let draftBody: { message: { raw: string; threadId?: string } } | undefined;

function fakeExternal(url: string, init?: RequestInit): Response | undefined {
  if (url.includes("oauth2.googleapis.com/token")) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    return body.get("grant_type") === "refresh_token"
      ? Response.json({ access_token: "outreach-token", expires_in: 3600 })
      : Response.json({ access_token: "outreach-token", expires_in: 3600, refresh_token: "outreach-refresh", scope: `${COMPOSE_SCOPE} ${READ_SCOPE}` });
  }
  if (url.includes("/users/me/profile")) return Response.json({ emailAddress: "outreach@virtara-mail.co.za" });
  if (url.includes("/users/me/drafts")) {
    googleCalls.push({ url, body: String(init?.body) });
    draftBody = JSON.parse(String(init?.body));
    return Response.json({ id: "r-draft-1", message: { id: "msg-1", threadId: "thr-1" } });
  }
  if (url.includes("/chat/completions")) return Response.json({ choices: [{ message: { content: hermesReply } }] });
  return undefined;
}

beforeEach(async () => {
  fs.rmSync(path.join(directory, "traction"), { recursive: true, force: true });
  await disconnectOutreach();
  resetOutreachTokenCache();
  googleCalls.length = 0;
  draftBody = undefined;
  hermesReply = '{ "subject": "Your listing pages", "body": "Hi Jane,\\n\\nSaw your mobile listing pages have no viewing button." }';
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => fakeExternal(String(url), init) ?? realFetch(url as string, init)) as typeof fetch;
});

after(() => {
  server?.close();
  globalThis.fetch = realFetch;
  fs.rmSync(directory, { recursive: true, force: true });
});

async function api(pathname: string, init?: RequestInit) {
  const response = await realFetch(`${base}${pathname}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function seed(overrides: Partial<Prospect> = {}, signature = SIGNATURE) {
  await store.saveIcp({ name: icp.name, offer: icp.offer, idealProspect: icp.idealProspect });
  const created = await store.createOffer({ name: offer.name, offer: offer.offer, problem: offer.problem, upsells: [] } as never);
  const input = ProspectInputSchema.parse({ company: "Parkview Realty", contact: "Jane Doe", email: "jane@parkview.example", website: "https://parkview.example", stage: "target", observation: "Property pages have no viewing-enquiry button on mobile", offerId: created.id, ...overrides });
  const made = await store.createProspect({ ...input, stage: input.stage ?? "target" });
  await store.saveOutreachSignature(signature);
  return made;
}

describe("the routes", () => {
  it("starts up", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/outreach", outreachRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/outreach`;
    const { body } = await api("/status");
    assert.deepEqual({ configured: body.configured, connected: body.connected }, { configured: true, connected: false });
  });

  it("drafts with Hermes only when there is enough, and adds the signature", async () => {
    const made = await seed();
    const { status, body } = await api(`/prospects/${made.id}/draft`, { method: "POST" });
    assert.equal(status, 200);
    assert.equal(body.subject, "Your listing pages");
    assert.ok(String(body.body).endsWith(`--\n${SIGNATURE}`));

    const thin = await store.createProspect({ ...ProspectInputSchema.parse({ company: "Thin Co", email: "x@thin.example" }), stage: "target" });
    const refused = await api(`/prospects/${thin.id}/draft`, { method: "POST" });
    assert.equal(refused.status, 422);
    assert.match(String(refused.body.error), /Not enough to personalise/);

    hermesReply = NOT_ENOUGH_CONTEXT;
    assert.equal((await api(`/prospects/${made.id}/draft`, { method: "POST" })).status, 422);
  });

  it("needs the mailbox connected before it makes a Gmail draft", async () => {
    const made = await seed();
    const { status, body } = await api(`/prospects/${made.id}/gmail-draft`, { method: "POST", body: JSON.stringify({ subject: "s", body: `b\n\n--\n${SIGNATURE}` }) });
    assert.equal(status, 409);
    assert.match(String(body.error), /Connect the outreach mailbox/);
    assert.equal(googleCalls.length, 0);
  });

  it("creates a draft addressed to the prospect's stored address, logs it, and sends nothing", async () => {
    const made = await seed();
    await completeOutreachConnection("code");
    const content = { subject: "Your listing pages", body: `Hi Jane,\n\nOne thing.\n\n--\n${SIGNATURE}` };
    const { status, body } = await api(`/prospects/${made.id}/gmail-draft`, { method: "POST", body: JSON.stringify(content) });

    assert.equal(status, 201);
    assert.equal(body.draftId, "r-draft-1");
    assert.match(String(body.openUrl), /authuser=outreach%40virtara-mail\.co\.za#drafts\?compose=msg-1/);
    assert.equal(googleCalls.length, 1);
    assert.match(googleCalls[0].url, /\/drafts$/, "a draft, not /messages/send");
    const raw = Buffer.from(draftBody?.message.raw ?? "", "base64url").toString("utf8");
    assert.match(raw, /^To: jane@parkview\.example\r\n/);
    assert.match(raw, /Subject: Your listing pages/);

    const log = (await store.readState()).outreachLog;
    assert.equal(log.length, 1);
    assert.deepEqual({ kind: log[0].kind, to: log[0].to, prospectId: log[0].prospectId }, { kind: "draft", to: "jane@parkview.example", prospectId: made.id });
    assert.equal((await store.readState()).prospects[0].stage, "target", "a draft is not contact: nothing moves");
  });

  it("cannot be told who to write to: a recipient in the request is refused", async () => {
    const made = await seed();
    await completeOutreachConnection("code");
    const { status } = await api(`/prospects/${made.id}/gmail-draft`, { method: "POST", body: JSON.stringify({ subject: "s", body: `b\n\n--\n${SIGNATURE}`, to: "victim@example.com" }) });
    assert.equal(status, 400, "the schema is strict");
    assert.equal(googleCalls.length, 0);
  });

  it("keeps the signature on an email to someone who has not replied, but not to someone in conversation", async () => {
    const cold = await seed();
    await completeOutreachConnection("code");
    const stripped = await api(`/prospects/${cold.id}/gmail-draft`, { method: "POST", body: JSON.stringify({ subject: "s", body: "No opt-out here." }) });
    assert.equal(stripped.status, 422);
    assert.match(String(stripped.body.error), /signature and opt-out line must stay/);
    assert.equal(googleCalls.length, 0);

    await store.updateProspect(cold.id, { stage: "conversation" });
    const warm = await api(`/prospects/${cold.id}/gmail-draft`, { method: "POST", body: JSON.stringify({ subject: "Re: pricing", body: "Sure, here is the quote." }) });
    assert.equal(warm.status, 201);
  });

  it("refuses a subject with a newline, a missing address, and a closed prospect", async () => {
    const made = await seed();
    await completeOutreachConnection("code");
    const send = (id: string, subject = "s") => api(`/prospects/${id}/gmail-draft`, { method: "POST", body: JSON.stringify({ subject, body: `b\n\n--\n${SIGNATURE}` }) });

    assert.equal((await send(made.id, "Hi\r\nBcc: x@evil.co")).status, 400);
    const noEmail = await store.createProspect({ ...ProspectInputSchema.parse({ company: "No Email Co" }), stage: "target" });
    assert.match(String((await send(noEmail.id)).body.error), /valid email address/);
    await store.updateProspect(made.id, { stage: "lost" });
    assert.match(String((await send(made.id)).body.error), /closed/);
    assert.equal(googleCalls.length, 0);
  });
});
