import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailThread } from "../../../shared/mail-types";
import type { Prospect, TractionEvent, WaitingOn } from "../../../shared/traction-types";
import {
  addDays,
  buildAttention,
  buildExperimentProgress,
  buildPipeline,
  buildQueue,
  buildReview,
  buildWeek,
  chasesDue,
  countDoneToday,
  daysBetween,
  DAILY_NEW_CONTACTS,
  linkedThreads,
  outreachGaps,
  suggestMailLinks,
  weekStart,
} from "../engine";

const TODAY = "2026-09-28"; // a Monday

/** Noon local time, `days` before today — clear of any timezone edge. */
function daysAgo(days: number): string {
  const [year, month, day] = addDays(TODAY, -days).split("-").map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
}

let counter = 0;

function prospect(overrides: Partial<Prospect> = {}): Prospect {
  counter += 1;
  return {
    id: `pr_test${String(counter).padStart(4, "0")}`,
    company: `Company ${counter}`,
    stage: "target",
    source: "outbound",
    reasons: [],
    stageChangedAt: daysAgo(1),
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ...overrides,
  };
}

describe("dates", () => {
  it("counts whole calendar days", () => {
    assert.equal(daysBetween("2026-09-20", TODAY), 8);
    assert.equal(daysBetween(daysAgo(3), TODAY), 3);
  });

  it("starts the week on Monday", () => {
    assert.equal(weekStart("2026-09-28"), "2026-09-28");
    assert.equal(weekStart("2026-10-04"), "2026-09-28"); // Sunday
    assert.equal(weekStart("2026-10-01"), "2026-09-28");
  });

  it("adds days across a month boundary", () => {
    assert.equal(addDays("2026-09-30", 1), "2026-10-01");
    assert.equal(addDays("2026-10-01", -1), "2026-09-30");
  });
});

describe("buildQueue", () => {
  it("surfaces a quiet proposal as a follow-up, with how long it has been", () => {
    const quiet = prospect({ stage: "proposal", contact: "Sarah", company: "Vaja", stageChangedAt: daysAgo(8), lastTouchAt: daysAgo(8) });
    const [item] = buildQueue([quiet], [], TODAY);

    assert.equal(item.kind, "follow_up");
    assert.equal(item.title, "Follow up with Sarah (Vaja)");
    assert.deepEqual(item.detail, ["Proposal sent 8 days ago", "No response"]);
  });

  it("does not chase a contacted prospect before the follow-up window", () => {
    const recent = prospect({ stage: "contacted", lastTouchAt: daysAgo(2) });
    assert.deepEqual(buildQueue([recent], [], TODAY), []);
  });

  it("respects a future next action over the silence rule", () => {
    const planned = prospect({ stage: "contacted", lastTouchAt: daysAgo(9), nextActionDate: addDays(TODAY, 2) });
    assert.deepEqual(buildQueue([planned], [], TODAY), []);
  });

  it("puts overdue promises first, and shows one item per prospect", () => {
    const overdue = prospect({ stage: "proposal", lastTouchAt: daysAgo(10), nextAction: "Call", nextActionDate: addDays(TODAY, -3) });
    const fresh = prospect();
    const queue = buildQueue([fresh, overdue], [], TODAY);

    assert.equal(queue.length, 2);
    assert.equal(queue[0].kind, "due");
    assert.equal(queue[0].prospectId, overdue.id);
    assert.ok(queue[0].detail.includes("Overdue by 3 days"));
    assert.equal(queue[1].kind, "contact");
  });

  it("asks existing clients with a good relationship for referrals, once", () => {
    const client = prospect({ stage: "won", relationship: "strong" });
    const asked = prospect({ stage: "won", relationship: "strong", referralAskedAt: daysAgo(3) });
    const cold = prospect({ stage: "won", relationship: "cold" });
    const queue = buildQueue([client, asked, cold], [], TODAY);

    assert.deepEqual(queue.map((item) => item.id), [`referral:${client.id}`]);
  });

  it("caps new outreach, warm referrals first, then best fit", () => {
    const cold = Array.from({ length: 8 }, () => prospect({ fit: "low" }));
    const good = prospect({ fit: "high" });
    const warm = prospect({ source: "referral", fit: "low" });
    const queue = buildQueue([...cold, good, warm], [], TODAY);

    assert.equal(queue.length, DAILY_NEW_CONTACTS);
    assert.equal(queue[0].prospectId, warm.id);
    assert.equal(queue[1].prospectId, good.id);
  });

  it("hides a snoozed item until its date", () => {
    const quiet = prospect({ stage: "contacted", lastTouchAt: daysAgo(6) });
    const id = `follow_up:${quiet.id}`;

    assert.deepEqual(buildQueue([quiet], [{ itemId: id, until: addDays(TODAY, 1) }], TODAY), []);
    assert.equal(buildQueue([quiet], [{ itemId: id, until: TODAY }], TODAY).length, 1);
  });

  it("never queues won or lost prospects for outreach", () => {
    const lost = prospect({ stage: "lost", nextActionDate: addDays(TODAY, -1) });
    assert.deepEqual(buildQueue([lost], [], TODAY), []);
  });
});

describe("buildAttention", () => {
  it("flags old uncontacted targets, stale proposals and untouched referrals", () => {
    const flags = buildAttention(
      [
        prospect({ createdAt: daysAgo(9) }),
        prospect({ createdAt: daysAgo(2) }),
        prospect({ stage: "proposal", lastTouchAt: daysAgo(8) }),
        prospect({ source: "referral" }),
      ],
      TODAY,
    );

    assert.deepEqual(
      flags.map((flag) => [flag.kind, flag.count]),
      [
        ["uncontacted_referrals", 1],
        ["stale_proposals", 1],
        ["uncontacted_targets", 1],
      ],
    );
    assert.equal(flags[2].message, "1 lead hasn't been contacted in 7 days");
  });

  it("says nothing on a good day", () => {
    assert.deepEqual(buildAttention([prospect({ stage: "contacted", lastTouchAt: daysAgo(1) })], TODAY), []);
  });
});

describe("buildWeek", () => {
  const at = (days: number, kind: TractionEvent["kind"], to?: TractionEvent["to"]): TractionEvent => ({
    id: `ev_${Math.random()}`,
    at: daysAgo(days),
    prospectId: "pr_x",
    kind,
    to,
    viaQueue: kind === "followed_up" ? true : undefined,
  });

  it("counts this week's behaviour from events, not current stages", () => {
    const week = buildWeek(
      [
        at(0, "created"),
        at(0, "contacted"),
        at(0, "stage_changed", "conversation"),
        at(0, "stage_changed", "proposal"),
        at(0, "followed_up"),
        // Last week's Sunday — excluded.
        at(1, "contacted"),
      ],
      TODAY,
    );

    assert.deepEqual(week, {
      weekOf: TODAY,
      newProspects: 1,
      outreach: 1,
      followUps: 1,
      conversations: 1,
      proposals: 1,
      won: 0,
      lost: 0,
      referralsAsked: 0,
    });
  });

  it("counts only today's queue completions as done today", () => {
    assert.equal(countDoneToday([at(0, "followed_up"), at(1, "followed_up"), at(0, "created")], TODAY), 1);
  });
});

describe("pipeline and experiments", () => {
  it("counts every stage", () => {
    const pipeline = buildPipeline([prospect(), prospect({ stage: "won" }), prospect({ stage: "won" })]);
    assert.equal(pipeline.target, 1);
    assert.equal(pipeline.won, 2);
  });

  it("counts an experiment's progress from its tagged prospects", () => {
    const experiment = {
      id: "ex_1",
      name: "LinkedIn",
      channel: "linkedin" as const,
      hypothesis: "h",
      status: "running" as const,
      createdAt: "",
      updatedAt: "",
    };
    const [progress] = buildExperimentProgress(
      [experiment],
      [
        prospect({ experimentId: "ex_1" }),
        prospect({ experimentId: "ex_1", stage: "contacted" }),
        prospect({ experimentId: "ex_1", stage: "proposal" }),
        prospect({ stage: "proposal" }),
      ],
    );

    assert.deepEqual(progress, { experimentId: "ex_1", prospects: 3, contacted: 2, conversations: 1 });
  });
});

describe("outreachGaps", () => {
  const icp = { name: "Estate agencies", offer: "Websites", idealProspect: [], updatedAt: "" };
  const offer = { id: "of_1", name: "Site", offer: "A site", upsells: [], createdAt: "", updatedAt: "" };

  it("refuses to draft without something specific to say", () => {
    assert.deepEqual(outreachGaps(prospect(), undefined, []), ["icp", "offer", "website", "observation"]);
  });

  it("is clear once the ICP, offer, website and an observation exist", () => {
    const ready = prospect({
      offerId: "of_1",
      website: "https://example.com",
      observation: "Property pages have no viewing-enquiry CTA on mobile",
    });
    assert.deepEqual(outreachGaps(ready, icp, [offer]), []);
  });

  it("treats a removed offer as no offer", () => {
    const stale = prospect({ offerId: "of_gone", website: "https://example.com", observation: "x" });
    assert.deepEqual(outreachGaps(stale, icp, [offer]), ["offer"]);
  });
});

function waiting(overrides: Partial<WaitingOn> = {}): WaitingOn {
  counter += 1;
  return {
    id: `wo_test${String(counter).padStart(4, "0")}`,
    who: "Story Keeper",
    what: "Deposit",
    since: addDays(TODAY, -6),
    createdAt: daysAgo(6),
    updatedAt: daysAgo(6),
    ...overrides,
  };
}

describe("waiting on", () => {
  it("chases after the default wait, or on the chosen date", () => {
    const old = waiting();
    const fresh = waiting({ since: addDays(TODAY, -1) });
    const scheduled = waiting({ since: addDays(TODAY, -1), nextFollowUp: TODAY });
    const resolved = waiting({ resolvedAt: daysAgo(1) });

    assert.deepEqual(
      chasesDue([old, fresh, scheduled, resolved], TODAY).map((item) => item.id),
      [old.id, scheduled.id],
    );
  });

  it("puts a due chase in the queue and lets it claim its prospect", () => {
    const quiet = prospect({ stage: "proposal", lastTouchAt: daysAgo(9) });
    const owed = waiting({ prospectId: quiet.id, what: "Reply to proposal" });
    const queue = buildQueue([quiet], [], TODAY, [owed]);

    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, `waiting:${owed.id}`);
    assert.equal(queue[0].title, "Chase Story Keeper: Reply to proposal");
    assert.equal(queue[0].waitingId, owed.id);
  });

  it("queues a chase with no prospect at all", () => {
    const [item] = buildQueue([], [], TODAY, [waiting()]);
    assert.equal(item.kind, "waiting");
    assert.equal(item.prospectId, undefined);
  });
});

function thread(overrides: Partial<MailThread>): MailThread {
  return { threadId: "t1", subject: "Re: your website", snippet: "", messageDate: daysAgo(0), classified: false, ...overrides };
}

describe("suggestMailLinks", () => {
  const xyz = prospect({ company: "XYZ Realty", stage: "contacted", email: "jane@xyzrealty.co.za", website: "https://www.xyzrealty.co.za", stageChangedAt: daysAgo(5) });

  it("matches on the prospect's address and offers contacted → conversation", () => {
    const [suggestion] = suggestMailLinks([thread({ fromEmail: "Jane@XYZRealty.co.za" })], [xyz], [], []);
    assert.equal(suggestion.match, "email");
    assert.equal(suggestion.moveFrom, "contacted");
    assert.equal(suggestion.moveTo, "conversation");
  });

  it("matches a colleague on the website's domain", () => {
    const [suggestion] = suggestMailLinks([thread({ fromEmail: "sam@xyzrealty.co.za" })], [xyz], [], []);
    assert.equal(suggestion.match, "domain");
  });

  it("never matches on a free-mail domain", () => {
    const gmailer = prospect({ website: "https://gmail.com" });
    assert.deepEqual(suggestMailLinks([thread({ fromEmail: "someone@gmail.com" })], [gmailer], [], []), []);
  });

  it("does not offer a stage move for a thread older than the current stage", () => {
    const [suggestion] = suggestMailLinks([thread({ fromEmail: "jane@xyzrealty.co.za", messageDate: daysAgo(9) })], [xyz], [], []);
    assert.equal(suggestion.moveTo, undefined);
  });

  it("does not suggest a linked or dismissed thread again", () => {
    const threads = [thread({ threadId: "a", fromEmail: "jane@xyzrealty.co.za" }), thread({ threadId: "b", fromEmail: "jane@xyzrealty.co.za" })];
    const result = suggestMailLinks(threads, [xyz], [{ threadId: "a", prospectId: xyz.id, linkedAt: "" }], ["b"]);
    assert.deepEqual(result, []);
  });

  it("lists linked threads per prospect, surviving removal from the cache", () => {
    const links = linkedThreads([{ threadId: "gone", prospectId: xyz.id, linkedAt: daysAgo(1) }], []);
    assert.equal(links[xyz.id][0].subject, "Thread no longer in the Inbox cache");
  });
});

describe("buildReview", () => {
  it("names the best source from at least two leads, and leaves rates undefined when nobody was contacted", () => {
    const review = buildReview(
      [],
      [
        prospect({ source: "referral", stage: "proposal" }),
        prospect({ source: "referral", stage: "contacted" }),
        prospect({ source: "outbound", stage: "conversation" }),
        prospect({ source: "outbound", stage: "contacted" }),
        prospect({ source: "outbound", stage: "contacted" }),
        prospect({ source: "linkedin", stage: "won" }),
        prospect({ experimentId: "ex_1" }),
      ],
      [{ id: "ex_1", name: "Cold email", channel: "cold_email", hypothesis: "h", status: "running", createdAt: "", updatedAt: "" }],
      TODAY,
    );

    assert.equal(review.bestSource, "referral");
    assert.equal(review.experiments[0].conversationRate, undefined);
    assert.equal(review.week.weekOf, TODAY);
  });
});
