import { FollowUpRowSchema, type FollowUpRow, type FollowUpState } from "../../shared/outreach-follow-ups";
import { followUpWait, GONE_QUIET_AFTER_DAYS } from "../../shared/outreach-plays";
import type { TractionState } from "../traction/store";

/**
 * Who is in the follow-up sequence and what is due, from the record alone.
 *
 * The same schedule as the Next up queue and the send guardrail
 * (`followUpWait`): 3 days after the first email, 4 after the second, and
 * after the third they go quiet. Only businesses still in "contacted" are
 * here: a reply moves them to Conversation and out of this list.
 */

const DAY = 86_400_000;
const lower = (value: string) => value.trim().toLowerCase();
const ORDER: Record<FollowUpState, number> = { due: 0, waiting: 1, final: 2, quiet: 3, stopped: 4 };

type State = Pick<TractionState, "prospects" | "outreachLog" | "outreachReplies" | "suppressions">;

export function computeFollowUps(state: State, now: Date = new Date()): FollowUpRow[] {
  const nowMs = now.getTime();
  const rows: FollowUpRow[] = [];

  for (const prospect of state.prospects) {
    if (prospect.stage !== "contacted") continue;

    const sends = state.outreachLog
      .filter((entry) => entry.prospectId === prospect.id && (entry.kind === "sent" || entry.kind === "unconfirmed" || entry.kind === "manual"))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const last = sends.at(-1);
    const touches = Math.max(sends.length, 1);
    const lastAt = last?.at ?? prospect.lastTouchAt ?? prospect.stageChangedAt;
    const address = lower(prospect.email ?? last?.to ?? "");

    // An answer in the outreach mailbox is the "They replied" queue item's, not a follow-up.
    const firstAt = Date.parse(sends[0]?.at ?? lastAt);
    if (address && state.outreachReplies.some((reply) => lower(reply.fromEmail) === address && Date.parse(reply.at) > firstAt)) continue;

    const base = { prospectId: prospect.id, company: prospect.company, contact: prospect.contact, touches, lastAt, lastSubject: last?.subject, lastBody: last?.body };
    const stop = address ? state.suppressions.find((entry) => lower(entry.address) === address) : undefined;
    if (stop) {
      rows.push({ ...base, state: "stopped", stoppedReason: stop.reason === "bounced" ? "The address bounced" : stop.reason === "manual" ? "On your do-not-contact list" : "They asked not to be emailed" });
      continue;
    }

    const wait = followUpWait(touches);
    if (wait !== undefined) {
      const dueAt = Date.parse(lastAt) + wait * DAY;
      rows.push({ ...base, nextTouch: touches + 1, dueAt: new Date(dueAt).toISOString(), state: dueAt <= nowMs ? "due" : "waiting" });
    } else {
      const quietAt = Date.parse(lastAt) + GONE_QUIET_AFTER_DAYS * DAY;
      rows.push({ ...base, state: quietAt <= nowMs ? "quiet" : "final" });
    }
  }

  return rows
    .map((row) => FollowUpRowSchema.parse(row))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.dueAt ?? a.lastAt).localeCompare(b.dueAt ?? b.lastAt));
}
