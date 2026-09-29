import { isPlainAddress } from "./mime";

/**
 * What a message in the outreach inbox is. Pure: no network, no store, so the
 * rules can be tested one by one.
 *
 * Everything here reads text a stranger wrote, so it only ever decides
 * between four labelled outcomes; it never follows what the text says. The
 * outcomes that suppress an address (a bounce, a stop) are the safe
 * direction: a wrong one costs a click to undo, a missed one costs trust.
 */

export interface InboundMessage {
  fromEmail: string;
  fromName?: string;
  subject: string;
  /** Plain text of the message, or Gmail's snippet when there is no text part. */
  text: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
}

export type InboundKind =
  | { kind: "bounce"; address: string }
  | { kind: "auto" }
  | { kind: "stop"; address: string }
  | { kind: "reply"; address: string }
  /** From a known address, but the mail did not pass SPF or DKIM: it may be someone pretending to be them. */
  | { kind: "unverified"; address: string }
  | { kind: "ignore" };

const REPLY_LIMIT = 2000;

/** The sender's own words: the quoted email under a reply, and signatures' "On … wrote:" lines, are cut. */
export function ownWords(text: string): string {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*On .{5,120}wrote:\s*$/i.test(line) || /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^\s*From:\s.+/.test(line) && lines.length > 0) break;
    lines.push(line);
  }
  return lines.join("\n").trim().slice(0, REPLY_LIMIT);
}

const MAILER = /^(mailer-daemon|postmaster)@/i;
const HARD_BOUNCE = /\b5\.\d{1,3}\.\d{1,3}\b|\b550\b|user unknown|no such user|does not exist|address not found|recipient address rejected|unknown recipient|mailbox unavailable|couldn'?t be found/i;

/** Addresses named in a bounce, in the order they appear. */
function addressesIn(text: string): string[] {
  return [...text.matchAll(/[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}/g)].map((match) => match[0].toLowerCase());
}

/**
 * Gmail records whether the sender's domain vouches for the message. When it
 * says so and neither SPF nor DKIM passed, the "From" is not to be trusted:
 * a forged one could plant text in front of Hermes or trigger a suppression.
 * With no such header there is nothing to judge, and the message is let through.
 */
function passesAuthentication(header: string | undefined): boolean {
  if (!header) return true;
  return /\b(?:spf|dkim)=pass\b/i.test(header);
}

const AUTO_SUBJECT = /^\s*(automatic reply|auto(?:matic)?[- ]?reply|out of (?:the )?office|autosvar)/i;

/** "Stop", "no thanks", "unsubscribe": at the very start of what they wrote. */
const STOP =
  /^\W*(?:please\s+)?(?:(?:stop)(?:\s+(?:emailing|contacting|sending|mailing|messaging)\b|\s*[.!,]|\s*$)|unsubscribe|remove\s+me|take\s+me\s+off|no\s+thanks|no\s+thank\s+you|not\s+interested|do\s+not\s+(?:contact|email)|don'?t\s+(?:contact|email))/i;

export function isStopRequest(text: string): boolean {
  return STOP.test(ownWords(text).slice(0, 400));
}

/**
 * @param sentTo Addresses that have been emailed from this mailbox, lower-case. A bounce only counts for one of these.
 * @param prospectAddresses Addresses of prospects, lower-case. A reply only counts from one of these, or one in `sentTo`.
 * @param ownAddress The outreach mailbox itself, never a bounced recipient.
 */
export function classifyInbound(message: InboundMessage, context: { sentTo: ReadonlySet<string>; prospectAddresses: ReadonlySet<string>; ownAddress: string }): InboundKind {
  const from = message.fromEmail.trim().toLowerCase();
  const headers = message.headers;

  const isReport = /multipart\/report/i.test(headers["content-type"] ?? "") && /delivery-status/i.test(headers["content-type"] ?? "");
  if (MAILER.test(from) || isReport) {
    if (!HARD_BOUNCE.test(message.text) && !HARD_BOUNCE.test(message.subject)) return { kind: "ignore" };

    const failed = (headers["x-failed-recipients"] ?? "")
      .split(/[,;\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const candidates = [...failed, ...addressesIn(message.text)];
    const address = candidates.find((candidate) => candidate !== context.ownAddress.toLowerCase() && context.sentTo.has(candidate));
    return address ? { kind: "bounce", address } : { kind: "ignore" };
  }

  const auto = headers["auto-submitted"];
  if ((auto && auto.toLowerCase() !== "no") || /^(bulk|auto_reply|junk)$/i.test(headers.precedence ?? "") || AUTO_SUBJECT.test(message.subject)) {
    return { kind: "auto" };
  }

  if (!isPlainAddress(from) || (!context.sentTo.has(from) && !context.prospectAddresses.has(from))) return { kind: "ignore" };
  if (!passesAuthentication(headers["authentication-results"])) return { kind: "unverified", address: from };
  return isStopRequest(message.text) ? { kind: "stop", address: from } : { kind: "reply", address: from };
}
