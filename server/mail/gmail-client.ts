import type { AgentFailureReason } from "../../shared/agentos-types";
import { MAIL_MAX_AGE_DAYS, MAIL_THREAD_LIMIT } from "../../shared/mail-types";
import { authorize } from "../connectors/policy";
import { getAccessToken } from "./gmail-auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

async function gmailFetch(path: string, init?: { method: "POST"; body?: unknown }): Promise<unknown> {
  const token = await getAccessToken();

  // Every POST this client makes is a label change or a move to Trash.
  const decision = init?.method === "POST"
    ? authorize("gmail.modify", { initiator: "system", detail: path.endsWith("/trash") ? "Moved a thread to Trash" : "Changed a thread's labels" })
    : authorize("gmail.read", { initiator: "system" });
  if (!decision.allowed) throw new GmailError(decision.reason, "not-configured");

  let response: Response;
  try {
    response = await fetch(`${GMAIL_API}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new GmailError("Could not reach Gmail.", "offline");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new GmailError("Gmail rejected the request.", "unauthorized");
    }
    throw new GmailError(`Gmail responded with ${response.status}.`, "failed");
  }

  return response.json();
}

interface GmailThreadListResponse {
  threads?: { id: string }[];
}

/** Gmail's own search filter for the Inbox window: the last `MAIL_MAX_AGE_DAYS` days. */
const RECENT_QUERY = `&q=${encodeURIComponent(`newer_than:${MAIL_MAX_AGE_DAYS}d`)}`;

/**
 * Up to `MAIL_THREAD_LIMIT` most recent INBOX thread ids from the last
 * `MAIL_MAX_AGE_DAYS` days, newest first. One call — Gmail allows up to 500.
 */
export async function listInboxThreadIds(): Promise<string[]> {
  const payload = (await gmailFetch(
    `/threads?labelIds=INBOX&maxResults=${MAIL_THREAD_LIMIT}${RECENT_QUERY}`,
  )) as GmailThreadListResponse;
  return (payload.threads ?? []).slice(0, MAIL_THREAD_LIMIT).map((thread) => thread.id);
}

/**
 * Which of the `MAIL_THREAD_LIMIT` most recent INBOX threads are unread.
 * One list call, so Refresh can mirror read state without refetching every thread.
 */
export async function listUnreadInboxThreadIds(): Promise<Set<string>> {
  const payload = (await gmailFetch(
    `/threads?labelIds=INBOX&labelIds=UNREAD&maxResults=${MAIL_THREAD_LIMIT}${RECENT_QUERY}`,
  )) as GmailThreadListResponse;
  return new Set((payload.threads ?? []).map((thread) => thread.id));
}

/** Marks every message in a thread read (or unread) in Gmail. Needs `gmail.modify`. */
export async function setThreadRead(threadId: string, read: boolean): Promise<void> {
  await gmailFetch(`/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] },
  });
}

/** Archives a thread: out of Gmail's inbox, kept in All Mail. Needs `gmail.modify`. */
export async function archiveThread(threadId: string): Promise<void> {
  await gmailFetch(`/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: { removeLabelIds: ["INBOX"] },
  });
}

/**
 * Moves a thread to Gmail's Trash — recoverable there for 30 days. Never a
 * permanent delete: this module has no call that can do that.
 */
export async function trashThread(threadId: string): Promise<void> {
  await gmailFetch(`/threads/${encodeURIComponent(threadId)}/trash`, { method: "POST" });
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: GmailHeader[] } & GmailMessagePart;
}

interface GmailThreadResponse {
  messages?: GmailMessage[];
}

export interface GmailThreadSummary {
  threadId: string;
  fromName?: string;
  fromEmail?: string;
  subject: string;
  snippet: string;
  /** ISO 8601. */
  messageDate: string;
  /** True when any message in the thread carries Gmail's UNREAD label. */
  unread: boolean;
}

function header(message: GmailMessage, name: string): string | undefined {
  return message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;
}

/** `"Gavin Smith <gavin@example.com>"` → `{ name, email }`. A bare address has no name. */
export function parseFromHeader(value: string | undefined): { name?: string; email?: string } {
  if (!value) return {};

  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, "").trim();
    return { name: name.length > 0 ? name : undefined, email: match[2].trim() };
  }

  return { email: value.trim() };
}

/** Metadata and snippet only for the thread's latest message — never the full body. */
export async function getThreadSummary(threadId: string): Promise<GmailThreadSummary> {
  const payload = (await gmailFetch(
    `/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
  )) as GmailThreadResponse;

  const messages = payload.messages ?? [];
  const latest = messages[messages.length - 1];

  if (!latest) {
    throw new GmailError(`Thread ${threadId} has no messages.`, "failed");
  }

  const { name, email } = parseFromHeader(header(latest, "From"));
  const dateHeader = header(latest, "Date");

  return {
    threadId,
    fromName: name,
    fromEmail: email,
    subject: header(latest, "Subject") ?? "(no subject)",
    snippet: latest.snippet ?? "",
    messageDate: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
    unread: messages.some((message) => message.labelIds?.includes("UNREAD") ?? false),
  };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractPlainText(part: GmailMessagePart | undefined): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = extractPlainText(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * The latest message's plain-text body.
 *
 * Fetched only when a person opens one specific thread — never during sync,
 * and never stored. Everything else in this module reads metadata only.
 */
export async function getThreadBody(threadId: string): Promise<string> {
  const payload = (await gmailFetch(`/threads/${threadId}?format=full`)) as GmailThreadResponse;
  const messages = payload.messages ?? [];
  const latest = messages[messages.length - 1];

  return extractPlainText(latest?.payload) ?? "(No plain-text body was found for this message.)";
}
