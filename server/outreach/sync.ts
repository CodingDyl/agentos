import type { OutreachSyncResult } from "../../shared/outreach-types";
import { addSuppression, markOutreachSynced, readState, recordOutreachReply } from "../traction/store";
import { getOutreachAccessToken, outreachAddress } from "./auth";
import { classifyInbound, ownWords, type InboundMessage } from "./classify";
import { OutreachGmailError } from "./gmail";

/**
 * Reads the outreach mailbox's inbox and acts on what prospects wrote back.
 *
 * Read-only against Gmail: it lists and reads, never labels, archives or
 * deletes. Only three things are kept: replies from a prospect (so they can
 * be answered and appear in the queue), and the do-not-contact entries a
 * "stop" or a hard bounce leads to. Everything else in the mailbox is
 * looked at and forgotten.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const FIRST_LOOKBACK_DAYS = 14;
/** One page: outreach is a handful of emails, and a limit keeps a flood from becoming a bill. */
const MAX_MESSAGES = 50;
const OVERLAP_SECONDS = 3600;
const CONCURRENCY = 3;

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: { name?: string; value?: string }[] };
}

async function gmailGet(path: string): Promise<unknown> {
  const token = await getOutreachAccessToken();
  let response: Response;
  try {
    response = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new OutreachGmailError("Could not reach Gmail.", "offline");
  }
  if (response.status === 401 || response.status === 403) throw new OutreachGmailError("Gmail refused the request. Reconnect the outreach mailbox.", "unauthorized");
  if (!response.ok) throw new OutreachGmailError(`Gmail responded with ${response.status}.`, "failed");
  try {
    return await response.json();
  } catch {
    throw new OutreachGmailError("Gmail's answer could not be read.", "unreadable");
  }
}

function textOf(part: GmailPart | undefined): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts ?? []) {
    const found = textOf(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parseFrom(value: string): { email: string; name?: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>]+)>\s*$/.exec(value);
  const email = (match ? match[2] : value).trim();
  const name = match?.[1]?.trim();
  return { email, name: name || undefined };
}

/** The message as the classifier reads it. */
export function readGmailMessage(message: GmailMessage): (InboundMessage & { id: string; threadId: string; at: string; messageIdHeader?: string }) | undefined {
  if (!message.id || !message.threadId) return undefined;
  const headers: Record<string, string> = {};
  for (const header of message.payload?.headers ?? []) {
    if (header.name && typeof header.value === "string") headers[header.name.toLowerCase()] = header.value;
  }
  const from = parseFrom(headers.from ?? "");
  const millis = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId,
    fromEmail: from.email,
    fromName: from.name?.slice(0, 120),
    subject: (headers.subject ?? "").replace(/[\r\n]+/g, " ").slice(0, 200),
    text: textOf(message.payload) ?? message.snippet ?? "",
    headers,
    at: new Date(Number.isFinite(millis) ? millis : Date.now()).toISOString(),
    messageIdHeader: /^<[^<>\s]{1,300}>$/.test(headers["message-id"] ?? "") ? headers["message-id"] : undefined,
  };
}

let running: Promise<OutreachSyncResult> | undefined;

/** One read of the outreach inbox. Two callers at once share one run. */
export function syncOutreachInbox(): Promise<OutreachSyncResult> {
  running ??= run().finally(() => {
    running = undefined;
  });
  return running;
}

async function run(): Promise<OutreachSyncResult> {
  const own = await outreachAddress();
  if (!own) throw new OutreachGmailError("Connect the outreach mailbox first.", "unauthorized");

  const state = await readState();
  const since = state.outreachSync.lastSyncAt
    ? Math.floor(Date.parse(state.outreachSync.lastSyncAt) / 1000) - OVERLAP_SECONDS
    : Math.floor(Date.now() / 1000) - FIRST_LOOKBACK_DAYS * 86_400;
  const startedAt = new Date().toISOString();

  const list = (await gmailGet(`/messages?q=${encodeURIComponent(`in:inbox -from:me after:${since}`)}&maxResults=${MAX_MESSAGES}`)) as { messages?: { id?: string }[] };
  const ids = (list.messages ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === "string");

  const context = {
    sentTo: new Set(state.outreachLog.filter((entry) => entry.kind !== "draft").map((entry) => entry.to.toLowerCase())),
    prospectAddresses: new Set(state.prospects.flatMap((prospect) => (prospect.email ? [prospect.email.toLowerCase()] : []))),
    ownAddress: own,
  };
  const prospectByAddress = new Map(state.prospects.flatMap((prospect) => (prospect.email ? [[prospect.email.toLowerCase(), prospect] as const] : [])));

  const result: OutreachSyncResult = { checked: ids.length, replies: 0, stops: 0, bounces: 0, unverified: 0, at: startedAt };
  let next = 0;

  const worker = async () => {
    while (true) {
      const id = ids[next++];
      if (!id) return;
      const message = readGmailMessage((await gmailGet(`/messages/${encodeURIComponent(id)}?format=full`)) as GmailMessage);
      if (!message) continue;

      const outcome = classifyInbound(message, context);
      if (outcome.kind === "bounce") {
        await addSuppression(outcome.address, "bounced");
        result.bounces += 1;
      } else if (outcome.kind === "stop") {
        await addSuppression(outcome.address, "stop");
        result.stops += 1;
      } else if (outcome.kind === "unverified") {
        result.unverified += 1;
      } else if (outcome.kind === "reply") {
        const prospect = prospectByAddress.get(outcome.address);
        if (!prospect) continue;
        const stored = await recordOutreachReply({
          id: message.id,
          threadId: message.threadId,
          prospectId: prospect.id,
          fromEmail: outcome.address,
          fromName: message.fromName,
          subject: message.subject || "(no subject)",
          text: ownWords(message.text) || message.text.slice(0, 300),
          messageIdHeader: message.messageIdHeader,
          at: message.at,
        });
        if (stored) result.replies += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

  await markOutreachSynced(startedAt);
  return result;
}

/**
 * Reads the outreach inbox every so often while the server runs, so a reply
 * reaches the queue without a click. Reading only: nothing is ever sent from
 * here. Silent when no mailbox is connected.
 */
export function startOutreachSyncTimer(intervalMs = 15 * 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    void outreachAddress()
      .then((address) => (address ? syncOutreachInbox() : undefined))
      .catch((error: unknown) => console.warn(`[outreach] inbox check failed: ${error instanceof Error ? error.message : "unknown error"}`));
  }, intervalMs);
  timer.unref();
  return timer;
}
