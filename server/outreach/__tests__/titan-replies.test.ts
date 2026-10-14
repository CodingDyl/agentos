import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-titan-replies-"));
process.env.AGENTOS_UI_DIR = directory;

const store = await import("../../traction/store");
const { replySearchQueries } = await import("../../mail/titan-client");
const { checkTitanReplies, replyWatchStatus, REPLY_LOOKBACK_DAYS, startTitanReplyTimer, titanReplyTimerEnabled } = await import("../titan-replies");
const { latestReply, allReplies } = await import("../replies");
const { computeOutreachStats } = await import("../stats");
const { cleanupEligibility } = await import("../../cleanup/client-cleanup");
const { getTraction } = await import("../../traction/traction");
const { ProspectInputSchema, ProspectPatchSchema, ThreadIdSchema, DismissMailSuggestionSchema } = await import("../../../shared/traction-types");

const DAY = 86_400_000;
beforeEach(() => fs.rmSync(path.join(directory, "traction"), { recursive: true, force: true }));
after(() => fs.rmSync(directory, { recursive: true, force: true }));

async function contacted(company: string, email: string) {
  const created = await store.createProspect(ProspectInputSchema.parse({ company, email }));
  await store.recordManualSend({ prospectId: created.id, subject: "Your site", body: "Hi" });
  return created;
}

/** A message found in Titan, dated `offsetMs` from now: positive is after the first email went out. */
const message = (fromEmail: string, offsetMs: number, threadId = `titan:1:${fromEmail}:${offsetMs}`) => ({
  threadId,
  fromEmail,
  fromName: "Owner",
  subject: "Re: Your site",
  snippet: "Yes please,   send it over",
  messageDate: new Date(Date.now() + offsetMs).toISOString(),
});

describe("what is asked of Titan", () => {
  const since = new Date("2026-09-01T00:00:00Z");

  it("searches only for the given senders, since a date, in groups", () => {
    assert.deepEqual(replySearchQueries(["a@x.co.za"], since), [{ since, from: "a@x.co.za" }]);
    const many = Array.from({ length: 45 }, (_, index) => `owner${index}@biz.example`);
    const queries = replySearchQueries(many, since);
    assert.equal(queries.length, 3, "groups of 20");
    assert.deepEqual((queries[0] as { or: unknown[] }).or.length, 20);
    assert.ok(queries.every((query) => query.since === since));
  });

  it("drops duplicates and anything that is not a plain address, so nothing odd reaches a search", () => {
    const queries = replySearchQueries(["A@x.co.za", "a@x.co.za ", 'evil") OR ALL', "x y@z.com", "", "no-at-sign", "b@y.co.za"], since);
    assert.deepEqual(queries, [{ since, or: [{ from: "a@x.co.za" }, { from: "b@y.co.za" }] }]);
    assert.deepEqual(replySearchQueries(['"quoted"@x.com', "a@b"], since), []);
  });
});

describe("recording replies", () => {
  it("keeps a message from a contacted business's exact address, sent after the first email", async () => {
    const parkview = await contacted("Parkview", "Jane@Parkview.example");
    const added = await store.recordInboxReplies("titan", [message("jane@parkview.example", 1000)]);
    assert.equal(added, 1);
    const [reply] = (await store.readState()).inboxReplies;
    assert.equal(reply.prospectId, parkview.id);
    assert.equal(reply.snippet, "Yes please, send it over");
    assert.equal(reply.account, "titan");
  });

  it("ignores strangers, colleagues at the same firm, businesses never contacted, and mail from before the first email", async () => {
    await contacted("Parkview", "jane@parkview.example");
    await store.createProspect(ProspectInputSchema.parse({ company: "Never Contacted", email: "owner@never.example" }));
    const added = await store.recordInboxReplies("titan", [
      message("stranger@else.example", 1000),
      message("sam@parkview.example", 1000),
      message("owner@never.example", 1000),
      message("jane@parkview.example", -5 * DAY),
    ]);
    assert.equal(added, 0);
  });

  it("keeps each message once", async () => {
    await contacted("Parkview", "jane@parkview.example");
    const found = [message("jane@parkview.example", 1000, "titan:1:42")];
    assert.equal(await store.recordInboxReplies("titan", found), 1);
    assert.equal(await store.recordInboxReplies("titan", found), 0);
    assert.equal((await store.readState()).inboxReplies.length, 1);
  });
});

describe("one answer to 'have they written back?'", () => {
  it("counts the outreach mailbox and your Titan inbox, newest first, minus what you said is not theirs", async () => {
    const parkview = await contacted("Parkview", "jane@parkview.example");
    await store.recordInboxReplies("titan", [message("jane@parkview.example", 1000, "titan:1:old"), message("jane@parkview.example", 2000, "titan:1:new")]);
    const state = await store.readState();
    assert.equal(latestReply(state, parkview)?.threadId, "titan:1:new");
    assert.equal(latestReply({ ...state, dismissedMail: ["titan:1:new"] }, parkview)?.threadId, "titan:1:old");
    assert.equal(latestReply({ ...state, dismissedMail: ["titan:1:new", "titan:1:old"] }, parkview), undefined);
    assert.equal(latestReply(state, parkview, Date.now() + 60_000), undefined, "nothing after a later time");
    assert.equal(allReplies(state).length, 2);
  });

  it("makes a business that replied in Titan not eligible for clean-up", async () => {
    const parkview = await contacted("Parkview", "jane@parkview.example");
    await store.updateProspect(parkview.id, ProspectPatchSchema.parse({ stage: "lost" }));
    const before = await store.readState();
    const prospect = before.prospects[0];
    assert.equal(cleanupEligibility({ prospect, state: before, events: [], now: new Date(), rebuildActive: false }).eligible, true);

    await store.recordInboxReplies("titan", [message("jane@parkview.example", 1000)]);
    const afterReply = await store.readState();
    const verdict = cleanupEligibility({ prospect: afterReply.prospects[0], state: afterReply, events: [], now: new Date(), rebuildActive: false });
    assert.equal(verdict.eligible, false);
    assert.match(verdict.reasons.join(" "), /written back/);
  });

  it("counts a Titan reply in the outreach results and resets the send guard", async () => {
    await contacted("Parkview", "jane@parkview.example");
    await store.recordInboxReplies("titan", [message("jane@parkview.example", 1000)]);
    const state = await store.readState();
    assert.equal(computeOutreachStats(state).overall.replied, 1);
    assert.equal(computeOutreachStats(state).sentEmails[0].status, "replied");
    assert.equal(store.sequenceRefusal(state, "jane@parkview.example", Date.now()), undefined, "a reply starts the sequence over");
  });

  it("raises 'Reply to …' in Next up, even with the Inbox never refreshed", async () => {
    const parkview = await contacted("Parkview", "jane@parkview.example");
    await store.recordInboxReplies("titan", [message("jane@parkview.example", 1000)]);
    const data = await getTraction();
    const item = data.queue.find((entry) => entry.prospectId === parkview.id);
    assert.equal(item?.kind, "reply");
  });
});

describe("the reply check", () => {
  const connected = async () => ({ address: "dylan@virtara.co.za" });

  it("does nothing, and asks Titan nothing, when no Titan mailbox is connected", async () => {
    let asked = false;
    const status = await checkTitanReplies({ account: async () => undefined, find: async () => ((asked = true), []), now: () => new Date() });
    assert.deepEqual(status, { connected: false });
    assert.equal(asked, false);
  });

  it("asks only about contacted businesses with an address, since the first email or 60 days at most", async () => {
    const old = await contacted("Old", "old@old.example");
    await contacted("Recent", "recent@recent.example");
    await store.createProspect(ProspectInputSchema.parse({ company: "Target Only", email: "t@target.example" }));
    await store.createProspect(ProspectInputSchema.parse({ company: "No Address" }));
    const won = await contacted("Won Client", "won@won.example");
    await store.updateProspect(won.id, ProspectPatchSchema.parse({ stage: "won" }));
    // The first email to Old went out 200 days ago.
    const state = await store.readState();
    const statePath = path.join(directory, "traction", "state.json");
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    raw.outreachLog.find((entry: { prospectId: string }) => entry.prospectId === old.id).at = new Date(Date.now() - 200 * DAY).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(raw));
    void state;

    let seen: { addresses: readonly string[]; since: Date } | undefined;
    const now = new Date();
    const status = await checkTitanReplies({ account: connected, find: async (addresses, since) => ((seen = { addresses, since }), []), now: () => now });
    assert.deepEqual([...(seen?.addresses ?? [])].sort(), ["old@old.example", "recent@recent.example"]);
    assert.equal(seen?.since.getTime(), now.getTime() - REPLY_LOOKBACK_DAYS * DAY, "never further back than 60 days");
    assert.deepEqual([status.connected, status.lastFound, status.lastError], [true, 0, undefined]);
  });

  it("records what it finds and says how the check went", async () => {
    await contacted("Parkview", "jane@parkview.example");
    const status = await checkTitanReplies({ account: connected, find: async () => [message("jane@parkview.example", 1000)], now: () => new Date() });
    assert.equal(status.lastFound, 1);
    assert.equal((await store.readState()).inboxReplies.length, 1);
    const shown = await replyWatchStatus({ account: connected });
    assert.equal(shown.address, "dylan@virtara.co.za");
    assert.ok(shown.lastCheckAt);
  });

  it("says why when Titan refuses, and keeps what it found before", async () => {
    await contacted("Parkview", "jane@parkview.example");
    await checkTitanReplies({ account: connected, find: async () => [message("jane@parkview.example", 1000)], now: () => new Date() });
    const status = await checkTitanReplies({
      account: connected,
      find: async () => {
        throw new Error('Titan refused the login. If the password is right, turn on "Enable Titan on other apps" in Titan webmail.');
      },
      now: () => new Date(),
    });
    assert.match(String(status.lastError), /Enable Titan on other apps/);
    assert.equal(status.lastFound, 1);
    assert.equal((await store.readState()).inboxReplies.length, 1, "nothing found before is lost");
  });

  it("runs one check at a time: a second request gets the same answer", async () => {
    await contacted("Parkview", "jane@parkview.example");
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const deps = { account: connected, find: async () => (calls++, await gate, []), now: () => new Date() };
    const first = checkTitanReplies(deps);
    const second = checkTitanReplies(deps);
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });
});

describe("the kill switch", () => {
  it("stops the automatic check when AGENTOS_TITAN_REPLY_WATCH is off, and only then", () => {
    for (const value of ["off", "OFF", "0", "false", "no", " off "]) assert.equal(titanReplyTimerEnabled({ AGENTOS_TITAN_REPLY_WATCH: value }), false, value);
    for (const value of [undefined, "", "on", "1"]) assert.equal(titanReplyTimerEnabled({ AGENTOS_TITAN_REPLY_WATCH: value }), true, String(value));
    assert.equal(startTitanReplyTimer(1000, { AGENTOS_TITAN_REPLY_WATCH: "off" }), undefined);
    const timer = startTitanReplyTimer(1000, {});
    assert.ok(timer);
    clearInterval(timer);
  });
});

describe("thread ids a person can act on", () => {
  it("accepts Gmail and Titan thread ids (so Not theirs works on a Titan reply) and nothing odd", () => {
    for (const ok of ["18c4f2a9b1", "abc_DEF-12", "titan:1700000000:42"]) assert.equal(ThreadIdSchema.safeParse(ok).success, true, ok);
    for (const bad of ["", "titan:1", "titan:1:2:3", "titan:a:b", "../etc", "x y", "titan:1:42/../x", "a".repeat(129)]) assert.equal(ThreadIdSchema.safeParse(bad).success, false, bad);
    assert.equal(DismissMailSuggestionSchema.safeParse({ threadId: "titan:1:42" }).success, true);
  });
});
