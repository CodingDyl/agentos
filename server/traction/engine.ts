import type {
  Experiment,
  ExperimentProgress,
  Icp,
  Offer,
  OutreachGap,
  Pipeline,
  Prospect,
  ProspectStage,
  QueueItem,
  QueueItemKind,
  Snooze,
  TractionAttention,
  TractionEvent,
  WeekProgress,
} from "../../shared/traction-types";

/**
 * The Traction engine: plain code, no I/O, no model.
 *
 * Everything the Traction screen tells a person to do is decided here, from
 * the stored record and today's date, so the same record always produces the
 * same queue. That determinism is what makes the numbers worth trusting and
 * what lets Hermes interpret them without being the source of them.
 */

/** Days of silence before a contacted prospect is due a follow-up. */
export const FOLLOW_UP_AFTER_DAYS = 5;
/** Days of silence before a proposal is due a follow-up. */
export const PROPOSAL_FOLLOW_UP_AFTER_DAYS = 7;
/** A target left alone this long is flagged, not just queued. */
export const UNCONTACTED_TARGET_DAYS = 7;
/** A conversation that has not moved in this long has probably stalled. */
export const STALLED_CONVERSATION_DAYS = 10;
/** New outreach suggested per day — enough to keep going, few enough to do properly. */
export const DAILY_NEW_CONTACTS = 5;
/** The queue is a day's work, not a backlog. */
export const QUEUE_LIMIT = 10;

const OPEN_STAGES: readonly ProspectStage[] = ["target", "contacted", "conversation", "proposal"];

/** A local calendar date. The operator's "today", not UTC's. */
export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return isoDate(new Date(year, month - 1, day + days));
}

/** Whole calendar days from `from` to `to`. Timestamps are reduced to their local date first. */
export function daysBetween(from: string, to: string): number {
  const toDay = (value: string) => {
    const iso = value.length === 10 ? value : isoDate(new Date(value));
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };

  return Math.round((toDay(to) - toDay(from)) / 86_400_000);
}

/** Monday of the week containing `today`. */
export function weekStart(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  // getDay: Sunday is 0. A week here starts on Monday.
  return addDays(today, -((weekday + 6) % 7));
}

function isOpen(prospect: Prospect): boolean {
  return OPEN_STAGES.includes(prospect.stage);
}

/** When they were last reached, falling back to when they entered this stage. */
function quietSince(prospect: Prospect): string {
  return prospect.lastTouchAt ?? prospect.stageChangedAt;
}

function who(prospect: Prospect): string {
  return prospect.contact ? `${prospect.contact} — ${prospect.company}` : prospect.company;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const FIT_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * Today's traction work, in the order it earns money.
 *
 * Existing opportunities before new ones: an overdue promise or a quote gone
 * quiet is worth more than a cold contact, so those lead. Then referrals from
 * people who already trust the work, then new outreach — capped, and best-fit
 * first, so the queue is a morning's work and not a guilt list.
 *
 * One item per prospect. If a prospect is both overdue and due a follow-up,
 * the overdue action is the one that shows.
 */
export function buildQueue(
  prospects: readonly Prospect[],
  snoozes: readonly Snooze[],
  today: string,
): QueueItem[] {
  const snoozed = new Set(snoozes.filter((snooze) => snooze.until > today).map((snooze) => snooze.itemId));
  const claimed = new Set<string>();
  const items: (QueueItem & { rank: number })[] = [];

  const push = (kind: QueueItemKind, prospect: Prospect, title: string, detail: string[], rank: number) => {
    if (claimed.has(prospect.id)) return;
    claimed.add(prospect.id);

    const id = `${kind}:${prospect.id}`;
    if (snoozed.has(id)) return;
    items.push({ id, kind, prospectId: prospect.id, title, detail, rank });
  };

  // 1. Promised actions that are due. The oldest promise first.
  const due = prospects
    .filter((prospect) => isOpen(prospect) && prospect.nextActionDate && prospect.nextActionDate <= today)
    .sort((a, b) => (a.nextActionDate ?? "").localeCompare(b.nextActionDate ?? ""));

  for (const prospect of due) {
    const late = daysBetween(prospect.nextActionDate ?? today, today);
    push(
      "due",
      prospect,
      `${prospect.nextAction ?? "Next step"} — ${prospect.contact ?? prospect.company}`,
      [
        prospect.contact ? prospect.company : STAGE_WORDS[prospect.stage],
        late === 0 ? "Due today" : `Overdue by ${plural(late, "day")}`,
      ],
      0 - late / 1000,
    );
  }

  // 2. Follow-ups: quotes and first messages that went quiet.
  const followUps = prospects
    .filter((prospect) => {
      // A future next action means a person already decided when to return.
      if (prospect.nextActionDate && prospect.nextActionDate > today) return false;
      const quiet = daysBetween(quietSince(prospect), today);
      if (prospect.stage === "proposal") return quiet >= PROPOSAL_FOLLOW_UP_AFTER_DAYS;
      if (prospect.stage === "contacted") return quiet >= FOLLOW_UP_AFTER_DAYS;
      return false;
    })
    .sort((a, b) => quietSince(a).localeCompare(quietSince(b)));

  for (const prospect of followUps) {
    const quiet = daysBetween(quietSince(prospect), today);
    push(
      "follow_up",
      prospect,
      `Follow up with ${who(prospect)}`,
      [prospect.stage === "proposal" ? `Proposal sent ${ago(quiet)}` : `Last outreach ${ago(quiet)}`, "No response"],
      prospect.stage === "proposal" ? 1 : 2,
    );
  }

  // 3. Referral asks from clients who would say yes.
  const referrals = prospects.filter(
    (prospect) =>
      prospect.stage === "won" &&
      !prospect.referralAskedAt &&
      (prospect.relationship === "strong" || prospect.relationship === "active"),
  );

  for (const prospect of referrals) {
    push(
      "referral",
      prospect,
      `Ask ${prospect.company} for a referral`,
      [`Existing client · relationship ${prospect.relationship}`, "Referral not asked yet"],
      prospect.relationship === "strong" ? 3 : 3.5,
    );
  }

  // 4. New outreach. Warm leads first, then best fit, then oldest.
  const fresh = prospects
    .filter((prospect) => prospect.stage === "target" && !prospect.lastTouchAt)
    .sort((a, b) => {
      const warm = Number(b.source === "referral") - Number(a.source === "referral");
      if (warm !== 0) return warm;
      const fit = FIT_RANK[a.fit ?? "medium"] - FIT_RANK[b.fit ?? "medium"];
      if (fit !== 0) return fit;
      return a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, DAILY_NEW_CONTACTS);

  for (const prospect of fresh) {
    push(
      "contact",
      prospect,
      `Contact ${prospect.company}`,
      [prospect.source === "referral" ? "Warm referral" : "Target account", "No outreach yet"],
      prospect.source === "referral" ? 2.5 : 4,
    );
  }

  return items
    .sort((a, b) => a.rank - b.rank)
    .slice(0, QUEUE_LIMIT)
    .map((item): QueueItem => ({ id: item.id, kind: item.kind, prospectId: item.prospectId, title: item.title, detail: item.detail }));
}

const STAGE_WORDS: Record<ProspectStage, string> = {
  target: "Target account",
  contacted: "Contacted",
  conversation: "In conversation",
  proposal: "Proposal out",
  won: "Client",
  lost: "Lost",
};

/**
 * What has been dropped. Counts, not a list — the queue already holds the
 * individual actions; this says where the leaks are.
 */
export function buildAttention(prospects: readonly Prospect[], today: string): TractionAttention[] {
  const flags: TractionAttention[] = [];

  const add = (kind: TractionAttention["kind"], matches: Prospect[], message: (count: number) => string) => {
    if (matches.length === 0) return;
    flags.push({ kind, count: matches.length, message: message(matches.length), prospectIds: matches.map((p) => p.id) });
  };

  add(
    "uncontacted_referrals",
    prospects.filter((p) => p.stage === "target" && p.source === "referral" && !p.lastTouchAt),
    (count) => `${plural(count, "warm referral")} ${count === 1 ? "hasn't" : "haven't"} been contacted`,
  );

  add(
    "stale_proposals",
    prospects.filter((p) => p.stage === "proposal" && daysBetween(quietSince(p), today) >= PROPOSAL_FOLLOW_UP_AFTER_DAYS),
    (count) => `${plural(count, "proposal")} ${count === 1 ? "has" : "have"} had no follow-up in ${PROPOSAL_FOLLOW_UP_AFTER_DAYS} days`,
  );

  add(
    "stalled_conversations",
    prospects.filter((p) => p.stage === "conversation" && daysBetween(quietSince(p), today) >= STALLED_CONVERSATION_DAYS),
    (count) => `${plural(count, "conversation")} ${count === 1 ? "hasn't" : "haven't"} moved in ${STALLED_CONVERSATION_DAYS} days`,
  );

  add(
    "uncontacted_targets",
    prospects.filter(
      (p) => p.stage === "target" && p.source !== "referral" && !p.lastTouchAt && daysBetween(p.createdAt, today) >= UNCONTACTED_TARGET_DAYS,
    ),
    (count) => `${plural(count, "lead")} ${count === 1 ? "hasn't" : "haven't"} been contacted in ${UNCONTACTED_TARGET_DAYS} days`,
  );

  return flags;
}

export function buildPipeline(prospects: readonly Prospect[]): Pipeline {
  const pipeline: Pipeline = { target: 0, contacted: 0, conversation: 0, proposal: 0, won: 0, lost: 0 };
  for (const prospect of prospects) pipeline[prospect.stage] += 1;
  return pipeline;
}

/**
 * This week's behaviour, counted from what happened.
 *
 * Counted from events rather than current stages: a prospect that reached
 * conversation on Tuesday and proposal on Thursday counts toward both.
 */
export function buildWeek(events: readonly TractionEvent[], today: string): WeekProgress {
  const monday = weekStart(today);
  const week: WeekProgress = { weekOf: monday, newProspects: 0, outreach: 0, followUps: 0, conversations: 0, proposals: 0, won: 0 };

  for (const event of events) {
    const day = isoDate(new Date(event.at));
    if (day < monday || day > today) continue;

    if (event.kind === "created") week.newProspects += 1;
    else if (event.kind === "contacted") week.outreach += 1;
    else if (event.kind === "followed_up") week.followUps += 1;
    else if (event.kind === "stage_changed") {
      if (event.to === "conversation") week.conversations += 1;
      else if (event.to === "proposal") week.proposals += 1;
      else if (event.to === "won") week.won += 1;
    }
  }

  return week;
}

export function countDoneToday(events: readonly TractionEvent[], today: string): number {
  return events.filter((event) => event.viaQueue && isoDate(new Date(event.at)) === today).length;
}

const PAST_CONTACT: readonly ProspectStage[] = ["contacted", "conversation", "proposal", "won", "lost"];
const PAST_CONVERSATION: readonly ProspectStage[] = ["conversation", "proposal", "won"];

/** An experiment's progress, counted from the prospects tagged with it. */
export function buildExperimentProgress(
  experiments: readonly Experiment[],
  prospects: readonly Prospect[],
): ExperimentProgress[] {
  return experiments.map((experiment) => {
    const tagged = prospects.filter((prospect) => prospect.experimentId === experiment.id);
    return {
      experimentId: experiment.id,
      prospects: tagged.length,
      contacted: tagged.filter((p) => PAST_CONTACT.includes(p.stage)).length,
      conversations: tagged.filter((p) => PAST_CONVERSATION.includes(p.stage)).length,
    };
  });
}

/**
 * What stands between a prospect and a personalised first message.
 *
 * The brand guard, in code rather than in a prompt: without an ICP, an offer,
 * their website and one genuinely specific observation, there is nothing
 * honest to say — and the answer is "not enough context", never "I came across
 * your amazing company".
 */
export function outreachGaps(prospect: Prospect, icp: Icp | undefined, offers: readonly Offer[]): OutreachGap[] {
  const gaps: OutreachGap[] = [];
  if (!icp) gaps.push("icp");
  if (!prospect.offerId || !offers.some((offer) => offer.id === prospect.offerId)) gaps.push("offer");
  if (!prospect.website) gaps.push("website");
  if (!prospect.observation) gaps.push("observation");
  return gaps;
}
