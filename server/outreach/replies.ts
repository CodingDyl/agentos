import type { InboxReply, OutreachReply } from "../../shared/outreach-types";
import type { Prospect } from "../../shared/traction-types";

/**
 * The one answer to "have they written back?", used by Follow-ups, Clean up,
 * the outreach results and the send guard, so they cannot disagree.
 *
 * Two places a reply can be: the connected outreach mailbox (Gmail), and your
 * own Virtara mailbox on Titan, checked for messages from the business's exact
 * address. A message you marked "Not theirs" does not count.
 */

export interface ReplyEvidence {
  source: "outreach" | InboxReply["account"];
  threadId: string;
  fromEmail: string;
  subject: string;
  snippet?: string;
  /** When they sent it, ISO. */
  at: string;
}

export interface ReplySources {
  outreachReplies: readonly OutreachReply[];
  inboxReplies?: readonly InboxReply[];
  dismissedMail?: readonly string[];
}

const lower = (value: string) => value.trim().toLowerCase();

/** Every reply, from both places, minus the ones marked "Not theirs". */
export function allReplies(state: ReplySources): ReplyEvidence[] {
  const dismissed = new Set(state.dismissedMail ?? []);
  return [
    ...state.outreachReplies.map((reply): ReplyEvidence & { prospectId: string } => ({ source: "outreach", prospectId: reply.prospectId, threadId: reply.threadId, fromEmail: lower(reply.fromEmail), subject: reply.subject, snippet: reply.text.replace(/\s+/g, " ").trim().slice(0, 300), at: reply.at })),
    ...(state.inboxReplies ?? []).map((reply): ReplyEvidence & { prospectId: string } => ({ source: reply.account, prospectId: reply.prospectId, threadId: reply.threadId, fromEmail: lower(reply.fromEmail), subject: reply.subject, snippet: reply.snippet, at: reply.at })),
  ].filter((reply) => !dismissed.has(reply.threadId));
}

/** Their newest reply sent after `afterMs`, matched by the business or by its address. */
export function latestReply(state: ReplySources, prospect: Pick<Prospect, "id" | "email">, afterMs = Number.NEGATIVE_INFINITY): ReplyEvidence | undefined {
  const address = prospect.email ? lower(prospect.email) : undefined;
  const dismissed = new Set(state.dismissedMail ?? []);
  const candidates: ReplyEvidence[] = [];
  for (const reply of state.outreachReplies) {
    if (dismissed.has(reply.threadId)) continue;
    if (reply.prospectId !== prospect.id && (!address || lower(reply.fromEmail) !== address)) continue;
    candidates.push({ source: "outreach", threadId: reply.threadId, fromEmail: lower(reply.fromEmail), subject: reply.subject, snippet: reply.text.replace(/\s+/g, " ").trim().slice(0, 300), at: reply.at });
  }
  for (const reply of state.inboxReplies ?? []) {
    if (dismissed.has(reply.threadId)) continue;
    if (reply.prospectId !== prospect.id && (!address || lower(reply.fromEmail) !== address)) continue;
    candidates.push({ source: reply.account, threadId: reply.threadId, fromEmail: lower(reply.fromEmail), subject: reply.subject, snippet: reply.snippet, at: reply.at });
  }
  return candidates.filter((reply) => Date.parse(reply.at) > afterMs).sort((a, b) => b.at.localeCompare(a.at))[0];
}
