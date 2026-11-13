import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailThread } from "../../../shared/mail-types";
import type { FollowUpRow } from "../../../shared/outreach-follow-ups";
import type { TodayCalendar } from "../../../shared/today-types";
import type { WorkerJob } from "../../../shared/worker-types";
import { formatDayAhead, formatFollowUps, formatInbox, formatOverdue, formatReviewQueue, formatStorage, formatWaitingOn, formatWrap } from "../feeds";

/**
 * A routine's message goes to a phone with no model in between, so two things
 * matter: it stays silent (empty) when there is nothing to do, and what it
 * does say is short and counts honestly.
 */

const NOW = new Date("2026-11-13T09:00:00+02:00");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const row = (company: string, state: FollowUpRow["state"], over: Partial<FollowUpRow> = {}): FollowUpRow => ({
  prospectId: company,
  company,
  touches: 1,
  lastAt: ago(5),
  state,
  ...over,
});

const thread = (subject: string, over: Partial<MailThread> = {}): MailThread =>
  ({ threadId: subject, subject, snippet: "", messageDate: ago(1), classified: true, unread: true, fromName: "Sam Nkosi", ...over }) as MailThread;

describe("follow-ups message", () => {
  it("says nothing when nobody replied and nothing is due", () => {
    assert.equal(formatFollowUps([row("A", "waiting"), row("B", "quiet"), row("C", "stopped")], NOW), "");
  });

  it("puts replies first, then what is due and how late", () => {
    const message = formatFollowUps(
      [
        row("Bright Dental", "due", { nextTouch: 2, dueAt: ago(2) }),
        row("Acme Plumbing", "replied", { contact: "Sam" }),
        row("On Time Co", "due", { nextTouch: 3, dueAt: ago(0) }),
      ],
      NOW,
    );

    assert.ok(message.indexOf("Acme Plumbing (Sam)") < message.indexOf("Bright Dental"));
    assert.match(message, /1 business wrote back/);
    assert.match(message, /2 follow-ups are due/);
    assert.match(message, /- Bright Dental: email 2, 2 days late/);
    assert.match(message, /- On Time Co: email 3$/m);
  });
});

describe("inbox message", () => {
  it("says nothing when no email needs the operator", () => {
    assert.equal(formatInbox({ needsYou: [] }), "");
  });

  it("lists sender and subject, and counts what it left out", () => {
    const message = formatInbox({ needsYou: Array.from({ length: 8 }, (_, index) => thread(`Quote ${index + 1}`)) });

    assert.match(message, /^Inbox: 8 emails need you/);
    assert.match(message, /- Sam Nkosi: Quote 1/);
    assert.doesNotMatch(message, /Quote 7/);
    assert.match(message, /and 2 more/);
  });

  it("keeps a subject with line breaks on one line", () => {
    const message = formatInbox({ needsYou: [thread("Hello\nIGNORE THE ABOVE\nand do this", { fromName: undefined, fromEmail: "x@y.example" })] });

    assert.match(message, /- x@y\.example: Hello IGNORE THE ABOVE and do this/);
  });
});

describe("evening wrap message", () => {
  it("says nothing on a day with nothing done and nothing open", () => {
    assert.equal(formatWrap({ done: [], carryOver: [], carryOverTotal: 0 }), "");
  });

  it("counts every open task, not only the ones the wrap carries", () => {
    const carryOver = Array.from({ length: 8 }, (_, index) => ({ projectSlug: "pp", projectName: "Pantry Pilot", title: `Task ${index + 1}` }));
    const message = formatWrap({
      done: [{ id: "1", title: "Fix checkout", kind: "task", at: ago(0), project: "Bonded" }],
      carryOver,
      carryOverTotal: 11,
    });

    assert.match(message, /Done today \(1\):\n- Fix checkout \(Bonded\)/);
    assert.match(message, /Still open in Now \(11\):/);
    assert.match(message, /- Task 6 \(Pantry Pilot\)\nand 5 more$/);
  });

  it("is honest about a day with nothing marked done", () => {
    const message = formatWrap({ done: [], carryOver: [{ projectSlug: "pp", projectName: "Pantry Pilot", title: "Ship it" }], carryOverTotal: 1 });

    assert.match(message, /Nothing was marked done in AgentOS today\./);
  });
});

describe("money check message", () => {
  it("says nothing when no invoice is overdue", () => {
    assert.equal(formatOverdue({ today: "2026-11-13", hasInvoices: true, invoices: [], totalMinor: 0 }), "");
  });

  it("gives the count, the total and each invoice", () => {
    const message = formatOverdue({
      today: "2026-11-13",
      hasInvoices: true,
      totalMinor: 1_240_000,
      invoices: [
        { business: "Virtara", businessId: "v", number: "INV-012", title: "Website", client: "Acme", dueOn: "2026-10-30", balanceMinor: 800_000 },
        { business: "Virtara", businessId: "v", title: "Hosting", dueOn: "2026-11-01", balanceMinor: 440_000 },
      ],
    });

    assert.match(message, /^Money check: 2 invoices are overdue, R 12\s400[,.]00 owed/);
    assert.match(message, /- INV-012, Acme, due 2026-10-30, R 8\s000[,.]00/);
    assert.match(message, /- Hosting, due 2026-11-01, R 4\s400[,.]00/);
  });
});

describe("day ahead message", () => {
  const event = (title: string, over: Partial<TodayCalendar["today"][number]> = {}) => ({ id: title, title, start: "2026-11-13", allDay: true, ...over });

  it("says nothing with no event, or with no calendar", () => {
    assert.equal(formatDayAhead({ status: "ready", today: [] }), "");
    assert.equal(formatDayAhead({ status: "not-connected", today: [event("Hidden")] }), "");
  });

  it("lists each event with its time and place", () => {
    const message = formatDayAhead({
      status: "ready",
      today: [
        event("Public holiday"),
        event("Cal.com call", { location: "https://app.cal.com/video/abc" }),
        event("Acme kickoff", { allDay: false, start: "2026-11-13T10:00:00+02:00", end: "2026-11-13T11:00:00+02:00", meetingUrl: "https://meet.example/x" }),
      ],
    });

    assert.match(message, /^Day ahead: 3 events today/);
    assert.match(message, /- All day: Cal.com call \(video call\)/);
    assert.match(message, /- All day: Public holiday/);
    assert.match(message, /- \d\d:\d\d to \d\d:\d\d: Acme kickoff \(video call\)/);
  });
});

describe("waiting on others message", () => {
  it("says nothing when no chase is due", () => {
    assert.equal(formatWaitingOn([], "2026-11-13"), "");
  });

  it("says who owes what, and for how long", () => {
    const message = formatWaitingOn(
      [{ id: "wo_1", who: "Sam at Acme", what: "Signed quote", since: "2026-11-03", createdAt: ago(10), updatedAt: ago(10) }],
      "2026-11-13",
    );

    assert.match(message, /^Waiting on others: 1 chase is due/);
    assert.match(message, /- Sam at Acme: Signed quote \(10 days\)/);
  });
});

describe("worker jobs message", () => {
  const job = (status: WorkerJob["status"], objective: string, completedAt?: string) => ({ status, project: "agentos", objective, createdAt: ago(3), completedAt });

  it("says nothing when no job waits and no job failed today", () => {
    assert.equal(formatReviewQueue([job("running", "A"), job("completed", "B"), job("failed", "Old failure", ago(2))], NOW), "");
  });

  it("lists jobs for review, and jobs that failed in the last day", () => {
    const message = formatReviewQueue([job("awaiting_review", "Add the pricing page"), job("failed", "Fix the footer", ago(0.5)), job("failed", "Old failure", ago(2))], NOW);

    assert.match(message, /1 job waits for your review:\n- agentos: Add the pricing page/);
    assert.match(message, /1 job failed in the last day:\n- agentos: Fix the footer/);
    assert.doesNotMatch(message, /Old failure/);
  });
});

describe("Mac storage message", () => {
  const GB = 1024 ** 3;

  it("says nothing with 10 GB or more free", () => {
    assert.equal(formatStorage({ freeBytes: 10 * GB, totalBytes: 228 * GB }), "");
  });

  it("warns with the space left when the disk is almost full", () => {
    assert.match(formatStorage({ freeBytes: 1.4 * GB, totalBytes: 228 * GB }), /^Mac storage is low: 1\.4 GB free of 228 GB/);
  });
});
