import type { MailThread } from "../../shared/mail-types";
import type {
  Experiment,
  ExperimentProgress,
  ExperimentReview,
  Icp,
  LinkedThread,
  MailLink,
  MailSuggestion,
  Offer,
  OutreachGap,
  Pipeline,
  Prospect,
  ProspectStage,
  QueueItem,
  ProspectSource,
  QueueItemKind,
  Snooze,
  SourceResult,
  TractionAttention,
  TractionEvent,
  WaitingOn,
  WeekProgress,
  WeeklyReview,
} from "../../shared/traction-types";
import { addDays, chaseDate, daysBetween, isoDate, weekStart } from "../../shared/traction-dates";

// The date rules are shared with the screen, so both count days the same way.
export { addDays, chaseDate, daysBetween, isoDate, weekStart, WAITING_CHASE_AFTER_DAYS, WAITING_RECHASE_DAYS } from "../../shared/traction-dates";

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
  waiting: readonly WaitingOn[] = [],
): QueueItem[] {
  const snoozed = new Set(snoozes.filter((snooze) => snooze.until > today).map((snooze) => snooze.itemId));
  const claimed = new Set<string>();
  const items: (QueueItem & { rank: number })[] = [];

  const push = (kind: Exclude<QueueItemKind, "waiting">, prospect: Prospect, title: string, detail: string[], rank: number) => {
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

  // 2. Things owed to us whose chase date has come. More specific than a
  // prospect's silence, so it claims the prospect before the follow-up rule.
  for (const item of chasesDue(waiting, today)) {
    if (item.prospectId) {
      if (claimed.has(item.prospectId)) continue;
      claimed.add(item.prospectId);
    }

    const id = `waiting:${item.id}`;
    if (snoozed.has(id)) continue;

    const waited = daysBetween(item.since, today);
    items.push({
      id,
      kind: "waiting",
      prospectId: item.prospectId,
      waitingId: item.id,
      title: `Chase ${item.who} — ${item.what}`,
      detail: [`Waiting ${waited <= 0 ? "since today" : plural(waited, "day")}`, item.workspace ? `Workspace ${item.workspace}` : "No reply yet"],
      rank: 1.5,
    });
  }

  // 3. Follow-ups: quotes and first messages that went quiet.
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

  // 4. Referral asks from clients who would say yes.
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

  // 5. New outreach. Warm leads first, then best fit, then oldest.
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
    .map(({ rank, ...item }) => {
      void rank;
      return item;
    });
}

/** Open items whose chase date has arrived, the longest-overdue first. */
export function chasesDue(waiting: readonly WaitingOn[], today: string): WaitingOn[] {
  return waiting
    .filter((item) => !item.resolvedAt && chaseDate(item) <= today)
    .sort((a, b) => chaseDate(a).localeCompare(chaseDate(b)));
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
  const week: WeekProgress = {
    weekOf: monday,
    newProspects: 0,
    outreach: 0,
    followUps: 0,
    conversations: 0,
    proposals: 0,
    won: 0,
    lost: 0,
    referralsAsked: 0,
  };

  for (const event of events) {
    const day = isoDate(new Date(event.at));
    if (day < monday || day > today) continue;

    if (event.kind === "created") week.newProspects += 1;
    else if (event.kind === "contacted") week.outreach += 1;
    else if (event.kind === "followed_up") week.followUps += 1;
    else if (event.kind === "referral_asked") week.referralsAsked += 1;
    else if (event.kind === "stage_changed") {
      if (event.to === "conversation") week.conversations += 1;
      else if (event.to === "proposal") week.proposals += 1;
      else if (event.to === "won") week.won += 1;
      else if (event.to === "lost") week.lost += 1;
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

const REACHED_PROPOSAL: readonly ProspectStage[] = ["proposal", "won"];

/** The share, or undefined when there is nothing to divide by — never a made-up zero. */
function rate(part: number, whole: number): number | undefined {
  return whole > 0 ? part / whole : undefined;
}

/**
 * The weekly review for the week containing `day`.
 *
 * The week's figures come from events. Sources look back four weeks of
 * leads, because a single week rarely holds enough of any one source to
 * compare; the best source needs at least two leads before it is named.
 */
export function buildReview(
  events: readonly TractionEvent[],
  prospects: readonly Prospect[],
  experiments: readonly Experiment[],
  day: string,
): WeeklyReview {
  const monday = weekStart(day);
  const sunday = addDays(monday, 6);
  const week = buildWeek(events, sunday);
  const windowStart = addDays(monday, -21);

  const bySource = new Map<ProspectSource, SourceResult>();
  for (const prospect of prospects) {
    const created = isoDate(new Date(prospect.createdAt));
    if (created < windowStart || created > sunday) continue;

    const result = bySource.get(prospect.source) ?? { source: prospect.source, leads: 0, conversations: 0, proposals: 0 };
    result.leads += 1;
    if (PAST_CONVERSATION.includes(prospect.stage)) result.conversations += 1;
    if (REACHED_PROPOSAL.includes(prospect.stage)) result.proposals += 1;
    bySource.set(prospect.source, result);
  }

  const sources = [...bySource.values()].sort((a, b) => b.leads - a.leads);
  const best = sources
    .filter((source) => source.leads >= 2 && source.conversations > 0)
    .sort((a, b) => b.conversations / b.leads - a.conversations / a.leads || b.leads - a.leads)[0];

  const reviews: ExperimentReview[] = experiments
    .filter((experiment) => experiment.status !== "planned")
    .map((experiment) => {
      const tagged = prospects.filter((prospect) => prospect.experimentId === experiment.id);
      const contacted = tagged.filter((p) => PAST_CONTACT.includes(p.stage)).length;
      const conversations = tagged.filter((p) => PAST_CONVERSATION.includes(p.stage)).length;
      const proposals = tagged.filter((p) => REACHED_PROPOSAL.includes(p.stage)).length;
      return {
        experimentId: experiment.id,
        name: experiment.name,
        contacted,
        conversations,
        proposals,
        conversationRate: rate(conversations, contacted),
        proposalRate: rate(proposals, contacted),
      };
    });

  return { week, sources, bestSource: best?.source, experiments: reviews };
}

/**
 * Domains that say nothing about who someone works for. A match on one of
 * these would link every Gmail user to every prospect with a Gmail address.
 */
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mweb.co.za",
  "telkomsa.net",
  "webmail.co.za",
  "vodamail.co.za",
  "absamail.co.za",
]);

function emailDomain(email: string | undefined): string | undefined {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  return domain && !FREE_MAIL.has(domain) ? domain : undefined;
}

function websiteDomain(website: string | undefined): string | undefined {
  if (!website) return undefined;
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Stages from which a reply means the conversation has started. */
const REPLY_MOVES: Partial<Record<ProspectStage, ProspectStage>> = {
  target: "conversation",
  contacted: "conversation",
};

/**
 * Gmail threads that look like they belong to a prospect.
 *
 * Matched on the prospect's own address first, then on their website's
 * domain (never a free-mail domain). A thread already linked or dismissed is
 * not suggested again. A stage move is offered only when the thread arrived
 * after the prospect reached their current stage, so an old thread cannot
 * suggest undoing progress.
 */
export function suggestMailLinks(
  threads: readonly MailThread[],
  prospects: readonly Prospect[],
  links: readonly MailLink[],
  dismissed: readonly string[],
): MailSuggestion[] {
  const settled = new Set([...links.map((link) => link.threadId), ...dismissed]);
  const open = prospects.filter((prospect) => prospect.stage !== "lost");
  const suggestions: MailSuggestion[] = [];

  for (const thread of threads) {
    if (settled.has(thread.threadId) || !thread.fromEmail) continue;
    const from = thread.fromEmail.trim().toLowerCase();
    const domain = emailDomain(from);

    const byEmail = open.find((prospect) => prospect.email?.toLowerCase() === from);
    const byDomain = byEmail ? undefined : domain ? open.find((prospect) => websiteDomain(prospect.website) === domain) : undefined;
    const prospect = byEmail ?? byDomain;
    if (!prospect) continue;

    const moveTo = thread.messageDate >= prospect.stageChangedAt ? REPLY_MOVES[prospect.stage] : undefined;

    suggestions.push({
      threadId: thread.threadId,
      prospectId: prospect.id,
      company: prospect.company,
      subject: thread.subject,
      fromName: thread.fromName,
      fromEmail: thread.fromEmail,
      messageDate: thread.messageDate,
      match: byEmail ? "email" : "domain",
      moveFrom: moveTo ? prospect.stage : undefined,
      moveTo,
    });
  }

  return suggestions.sort((a, b) => b.messageDate.localeCompare(a.messageDate));
}

/** Per prospect, the confirmed threads — newest first, with what the cache still knows about them. */
export function linkedThreads(links: readonly MailLink[], threads: readonly MailThread[]): Record<string, LinkedThread[]> {
  const byId = new Map(threads.map((thread) => [thread.threadId, thread]));
  const result: Record<string, LinkedThread[]> = {};

  for (const link of links) {
    const thread = byId.get(link.threadId);
    (result[link.prospectId] ??= []).push({
      threadId: link.threadId,
      // A thread removed from the Mail cache is still linked; it just has less to show.
      subject: thread?.subject ?? "Thread no longer in the Inbox cache",
      messageDate: thread?.messageDate ?? link.linkedAt,
      fromName: thread?.fromName,
    });
  }

  for (const list of Object.values(result)) list.sort((a, b) => b.messageDate.localeCompare(a.messageDate));
  return result;
}
