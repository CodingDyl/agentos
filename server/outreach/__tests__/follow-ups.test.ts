import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OutreachLogEntry, OutreachReply } from "../../../shared/outreach-types";
import { computeFollowUps } from "../follow-ups";

const DAY = 86_400_000;
const NOW = new Date("2026-10-13T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

const prospect = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, company: `Co ${id}`, stage: "contacted", email: `${id}@co.example`, stageChangedAt: at(10), lastTouchAt: at(10), reasons: [], ...over }) as never;
const send = (prospectId: string, daysAgo: number, kind: OutreachLogEntry["kind"] = "manual", extra: Partial<OutreachLogEntry> = {}): OutreachLogEntry => ({
  id: `${prospectId}-${daysAgo}`,
  prospectId,
  kind,
  to: `${prospectId}@co.example`,
  subject: `Subject ${daysAgo}`,
  at: at(daysAgo),
  ...extra,
});
const reply = (prospectId: string, daysAgo: number): OutreachReply => ({ id: `r-${prospectId}`, threadId: "t", prospectId, fromEmail: `${prospectId}@co.example`, subject: "Re", text: "yes", at: at(daysAgo) });

const run = (prospects: unknown[], outreachLog: OutreachLogEntry[] = [], outreachReplies: OutreachReply[] = [], suppressions: { address: string; reason: "unsubscribed" | "bounced" | "stop" | "manual"; at: string }[] = []) =>
  computeFollowUps({ prospects: prospects as never, outreachLog, outreachReplies, suppressions }, NOW);

describe("the follow-up list", () => {
  it("follows the schedule: due 3 days after the first email, 4 after the second", () => {
    const rows = run([prospect("a"), prospect("b"), prospect("c"), prospect("d")], [
      send("a", 2), // first email 2 days ago: waiting
      send("b", 3), // 3 days ago: due
      send("c", 8), send("c", 3), // second 3 days ago: wait is 4, so waiting
      send("d", 9), send("d", 4), // second 4 days ago: due
    ]);
    const by = Object.fromEntries(rows.map((row) => [row.prospectId, row]));
    assert.deepEqual([by.a.state, by.a.nextTouch], ["waiting", 2]);
    assert.deepEqual([by.b.state, by.b.nextTouch], ["due", 2]);
    assert.deepEqual([by.c.state, by.c.nextTouch], ["waiting", 3]);
    assert.deepEqual([by.d.state, by.d.nextTouch], ["due", 3]);
    assert.equal(by.b.dueAt, at(0), "due exactly 3 days after the email");
  });

  it("after the third email they wait, then go quiet", () => {
    const rows = run([prospect("a"), prospect("b")], [send("a", 12), send("a", 8), send("a", 2), send("b", 20), send("b", 14), send("b", 10)]);
    const by = Object.fromEntries(rows.map((row) => [row.prospectId, row]));
    assert.deepEqual([by.a.state, by.a.nextTouch, by.a.dueAt], ["final", undefined, undefined]);
    assert.equal(by.b.state, "quiet");
    assert.equal(by.b.touches, 3);
  });

  it("counts a contacted business with nothing recorded as one email, from when they were contacted", () => {
    const [row] = run([prospect("a", { lastTouchAt: at(5) })]);
    assert.equal(row.touches, 1);
    assert.equal(row.state, "due");
    assert.equal(row.lastAt, at(5));
    assert.equal(row.lastBody, undefined);
  });

  it("keeps the text of the last email when it was recorded, for the follow-up to build on", () => {
    const [row] = run([prospect("a")], [send("a", 3, "manual", { subject: "Your listings", body: "Hi Jane" })]);
    assert.equal(row.lastSubject, "Your listings");
    assert.equal(row.lastBody, "Hi Jane");
  });

  it("leaves out anyone who is not just contacted, and shows anyone who wrote back as replied, not due", () => {
    const rows = run(
      [prospect("t", { stage: "target" }), prospect("c", { stage: "conversation" }), prospect("l", { stage: "lost" }), prospect("r"), prospect("ok")],
      [send("r", 5), send("ok", 5)],
      [reply("r", 2)],
    );
    assert.deepEqual(rows.map((row) => [row.prospectId, row.state]), [["r", "replied"], ["ok", "due"]]);
    assert.equal(rows[0].reply?.source, "outreach");
    assert.equal(rows[0].nextTouch, undefined, "no follow-up is offered to someone who answered");
  });

  it("does not count a reply from before they were first emailed", () => {
    const rows = run([prospect("a")], [send("a", 5)], [reply("a", 20)]);
    assert.deepEqual(rows.map((row) => [row.prospectId, row.state]), [["a", "due"]]);
  });

  const inbox = (prospectId: string, daysAgo: number, threadId = `titan:${prospectId}:${daysAgo}`) => ({
    id: `titan:${threadId}`,
    account: "titan" as const,
    threadId,
    prospectId,
    fromEmail: `${prospectId}@co.example`,
    subject: "Re: your site",
    snippet: "Sounds good, call me",
    at: at(daysAgo),
    seenAt: at(0),
  });

  it("notices a reply found in your Titan inbox, and stops the follow-ups", () => {
    const rows = computeFollowUps({ prospects: [prospect("a")] as never, outreachLog: [send("a", 5)], outreachReplies: [], suppressions: [], inboxReplies: [inbox("a", 1)] }, NOW);
    assert.equal(rows[0].state, "replied");
    assert.deepEqual([rows[0].reply?.source, rows[0].reply?.snippet], ["titan", "Sounds good, call me"]);
  });

  it("puts them back on their follow-ups when you say the message is not theirs", () => {
    const reply = inbox("a", 1);
    const rows = computeFollowUps({ prospects: [prospect("a")] as never, outreachLog: [send("a", 5)], outreachReplies: [], suppressions: [], inboxReplies: [reply], dismissedMail: [reply.threadId] }, NOW);
    assert.equal(rows[0].state, "due");
  });

  it("lists who wrote back first", () => {
    const rows = computeFollowUps({ prospects: [prospect("due"), prospect("wrote")] as never, outreachLog: [send("due", 10), send("wrote", 10)], outreachReplies: [], suppressions: [], inboxReplies: [inbox("wrote", 2)] }, NOW);
    assert.deepEqual(rows.map((row) => row.prospectId), ["wrote", "due"]);
  });

  it("stops anyone who opted out or bounced, with the reason", () => {
    const rows = run([prospect("a"), prospect("b")], [send("a", 5), send("b", 5)], [], [
      { address: "A@co.example", reason: "stop", at: at(1) },
      { address: "b@co.example", reason: "bounced", at: at(1) },
    ]);
    const by = Object.fromEntries(rows.map((row) => [row.prospectId, row]));
    assert.deepEqual([by.a.state, by.a.stoppedReason], ["stopped", "They asked not to be emailed"]);
    assert.deepEqual([by.b.state, by.b.stoppedReason], ["stopped", "The address bounced"]);
  });

  it("orders what is due first, oldest first, then waiting, then the rest", () => {
    const rows = run(
      [prospect("quiet"), prospect("wait"), prospect("late"), prospect("due")],
      [send("quiet", 30), send("quiet", 25), send("quiet", 20), send("wait", 1), send("late", 10), send("due", 4)],
    );
    assert.deepEqual(rows.map((row) => row.prospectId), ["late", "due", "wait", "quiet"]);
  });
});
