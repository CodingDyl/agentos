import {
  FOLLOW_UP_DAYS,
  MAX_TOUCHES,
  type OutreachStats,
  type Rate,
  type SentEmail,
} from "../../shared/outreach-plays";
import { SEND_KINDS, type OutreachLogEntry } from "../../shared/outreach-types";
import type { TractionState } from "../traction/store";

/**
 * What outreach has done: emails sent, who replied, and which plays work.
 *
 * Counted from what AgentOS itself recorded (its send log, the replies read
 * from the outreach mailbox, the do-not-contact list, and prospect stages),
 * so every number can be traced to a row. Rates are per prospect, not per
 * email: three emails to one person who replies once is one reply.
 */

const DAY = 86_400_000;
const POSITIVE = new Set(["conversation", "proposal", "won"]);

type State = Pick<TractionState, "outreachLog" | "outreachReplies" | "suppressions" | "prospects">;

const lower = (value: string) => value.trim().toLowerCase();

export function computeOutreachStats(state: State, now: Date = new Date()): OutreachStats {
  const nowMs = now.getTime();
  const company = new Map(state.prospects.map((prospect) => [prospect.id, prospect.company]));
  const stage = new Map(state.prospects.map((prospect) => [prospect.id, prospect.stage]));
  const suppressed = new Map(state.suppressions.map((entry) => [lower(entry.address), entry.reason]));

  const sends = state.outreachLog
    .filter((entry) => entry.kind === "sent" || entry.kind === "unconfirmed")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  /** First reply per address, after a given time. */
  const replyAfter = (address: string, after: number): string | undefined =>
    state.outreachReplies
      .filter((reply) => lower(reply.fromEmail) === lower(address) && Date.parse(reply.at) > after)
      .map((reply) => reply.at)
      .sort()[0];

  // Per prospect: their sends in order, and what became of them.
  const byProspect = new Map<string, OutreachLogEntry[]>();
  for (const entry of sends) byProspect.set(entry.prospectId, [...(byProspect.get(entry.prospectId) ?? []), entry]);

  interface Outcome {
    prospectId: string;
    firstAt: number;
    play?: string;
    replied?: string;
    positive: boolean;
    bounced: boolean;
    optedOut: boolean;
  }
  const outcomes: Outcome[] = [...byProspect].map(([prospectId, list]) => {
    const first = list[0];
    const reason = suppressed.get(lower(first.to));
    return {
      prospectId,
      firstAt: Date.parse(first.at),
      play: list.find((entry) => entry.play)?.play,
      replied: replyAfter(first.to, Date.parse(first.at) - 1),
      positive: POSITIVE.has(stage.get(prospectId) ?? ""),
      bounced: reason === "bounced",
      optedOut: reason === "unsubscribed" || reason === "stop",
    };
  });

  const rate = (list: Outcome[]): Rate => {
    const replied = list.filter((entry) => entry.replied).length;
    return {
      contacted: list.length,
      replied,
      positive: list.filter((entry) => entry.positive).length,
      bounced: list.filter((entry) => entry.bounced).length,
      optedOut: list.filter((entry) => entry.optedOut).length,
      replyRate: list.length > 0 ? replied / list.length : undefined,
    };
  };

  const plays = new Map<string, Outcome[]>();
  for (const outcome of outcomes) {
    const key = outcome.play ?? "unlabelled";
    plays.set(key, [...(plays.get(key) ?? []), outcome]);
  }

  const replyDays = outcomes
    .filter((entry) => entry.replied)
    .map((entry) => (Date.parse(entry.replied as string) - entry.firstAt) / DAY)
    .sort((a, b) => a - b);

  // Follow-ups due: still unanswered, not stopped, under the touch limit, and past the wait.
  const followUpsDue: OutreachStats["followUpsDue"] = [];
  for (const [prospectId, list] of byProspect) {
    const last = list[list.length - 1];
    const lastReply = replyAfter(last.to, Date.parse(list[0].at) - 1);
    if (lastReply || suppressed.has(lower(last.to))) continue;
    if (stage.get(prospectId) !== "contacted") continue;
    if (list.length >= MAX_TOUCHES) continue;
    const dueAt = Date.parse(last.at) + FOLLOW_UP_DAYS[list.length - 1] * DAY;
    if (dueAt <= nowMs) {
      followUpsDue.push({
        prospectId,
        company: company.get(prospectId) ?? "A prospect",
        touch: list.length + 1,
        lastAt: last.at,
        dueAt: new Date(dueAt).toISOString(),
      });
    }
  }

  const touchOf = new Map<string, number>();
  for (const list of byProspect.values()) list.forEach((entry, index) => touchOf.set(entry.id, index + 1));

  const sentEmails: SentEmail[] = state.outreachLog
    .filter((entry) => entry.kind !== "sending")
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 200)
    .map((entry) => {
      const reason = suppressed.get(lower(entry.to));
      const replied = entry.kind === "draft" ? undefined : replyAfter(entry.to, Date.parse(entry.at));
      const status: SentEmail["status"] =
        entry.kind === "draft"
          ? "draft"
          : reason === "bounced"
            ? "bounced"
            : reason === "unsubscribed" || reason === "stop"
              ? "opted_out"
              : replied
                ? "replied"
                : "awaiting";
      return {
        id: entry.id,
        prospectId: entry.prospectId,
        company: company.get(entry.prospectId) ?? "Removed prospect",
        to: entry.to,
        subject: entry.subject,
        play: entry.play,
        at: entry.at,
        touch: touchOf.get(entry.id) ?? 0,
        status,
        repliedAt: replied,
      };
    });

  const within = (days: number) => sends.filter((entry) => nowMs - Date.parse(entry.at) <= days * DAY).length;

  return {
    sent: { all: sends.filter((entry) => SEND_KINDS.includes(entry.kind)).length, last30: within(30), last7: within(7) },
    overall: rate(outcomes),
    last30: rate(outcomes.filter((entry) => nowMs - entry.firstAt <= 30 * DAY)),
    byPlay: [...plays].map(([play, list]) => ({ play, ...rate(list) })).sort((a, b) => b.contacted - a.contacted),
    medianReplyDays: replyDays.length > 0 ? Math.round(replyDays[Math.floor(replyDays.length / 2)] * 10) / 10 : undefined,
    followUpsDue: followUpsDue.sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    sentEmails,
  };
}
