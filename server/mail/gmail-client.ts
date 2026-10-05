import type { AgentFailureReason } from "../../shared/agentos-types";
import { MAIL_MAX_AGE_DAYS, MAIL_THREAD_LIMIT } from "../../shared/mail-types";
import { authorize } from "../connectors/policy";
import { buildMessage, toRaw, type EmailMessage } from "../outreach/mime";
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

interface GmailFetchInit {
  method: "POST" | "DELETE";
  body?: unknown;
  /**
   * The capability this call uses, when the path alone does not say. Every
   * send and draft is a button a person pressed, so the press is the approval.
   */
  capability?: { id: "gmail.send" | "gmail.draft" | "gmail.modify"; detail: string };
}

async function gmailFetch(path: string, init?: GmailFetchInit): Promise<unknown> {
  const token = await getAccessToken();

  // A draft is a person's own reply, created because they pressed the button;
  // every other POST is a label change or a move to Trash.
  const decision = init?.capability
    ? authorize(init.capability.id, { initiator: "person", detail: init.capability.detail })
    : path === "/drafts"
    ? authorize("gmail.draft", { initiator: "person", detail: "Created one client reply draft" })
    : init?.method === "POST"
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
    if (response.status === 413) {
      throw new GmailError("Gmail refused the email as too large. Remove or shrink an attachment.", "failed");
    }
    throw new GmailError(`Gmail responded with ${response.status}.`, "failed");
  }

  // A delete answers 204 with no body.
  if (response.status === 204) return {};
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

/** What a reply needs from a thread: its latest Message-ID (to thread the reply), subject, and sender. */
export async function getReplyContext(
  threadId: string,
): Promise<{ messageId?: string; subject: string; fromEmail?: string; replyToEmail?: string; toEmails: string[] }> {
  const payload = (await gmailFetch(
    `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=To`,
  )) as GmailThreadResponse;
  const latest = (payload.messages ?? []).at(-1);
  if (!latest) throw new GmailError(`Thread ${threadId} has no messages.`, "failed");
  const messageId = header(latest, "Message-ID") ?? header(latest, "Message-Id");
  const toEmails = (header(latest, "To") ?? "")
    .split(",")
    .map((entry) => parseFromHeader(entry.trim()).email)
    .filter((email): email is string => Boolean(email));
  return {
    messageId: messageId?.trim(),
    subject: header(latest, "Subject") ?? "",
    fromEmail: parseFromHeader(header(latest, "From")).email,
    replyToEmail: parseFromHeader(header(latest, "Reply-To")).email,
    toEmails,
  };
}

let mailboxAddress: string | undefined;

/** The connected account's own address. Read once per process. */
export async function getMailboxAddress(): Promise<string | undefined> {
  if (mailboxAddress) return mailboxAddress;
  const profile = (await gmailFetch("/profile")) as { emailAddress?: unknown };
  mailboxAddress = typeof profile.emailAddress === "string" ? profile.emailAddress : undefined;
  return mailboxAddress;
}

/**
 * Puts an email in the inbox mailbox's Drafts. Nothing is sent: a person
 * opens it in Gmail, reads it, and presses Send.
 */
export async function createInboxDraft(message: EmailMessage, threadId?: string): Promise<{ draftId: string }> {
  const result = (await gmailFetch("/drafts", {
    method: "POST",
    body: { message: { raw: toRaw(buildMessage(message)), ...(threadId ? { threadId } : {}) } },
  })) as { id?: unknown };
  if (typeof result.id !== "string") throw new GmailError("Gmail created something, but not what AgentOS expected.", "failed");
  return { draftId: result.id };
}

export interface GmailSentMessage {
  messageId: string;
  threadId?: string;
}

function sentMessage(result: unknown): GmailSentMessage {
  const value = result as { id?: unknown; threadId?: unknown };
  if (typeof value.id !== "string") throw new GmailError("Gmail's answer could not be read.", "failed");
  return { messageId: value.id, threadId: typeof value.threadId === "string" ? value.threadId : undefined };
}

/** Sends a raw RFC 2822 message from the inbox mailbox. `threadId` files a reply in its conversation. */
export async function sendInboxMessage(raw: string, threadId?: string): Promise<GmailSentMessage> {
  return sentMessage(
    await gmailFetch("/messages/send", {
      method: "POST",
      body: { raw, ...(threadId ? { threadId } : {}) },
      capability: { id: "gmail.send", detail: "Sent one email from Inbox" },
    }),
  );
}

/** Saves a raw message to the inbox mailbox's Drafts. */
export async function saveInboxDraft(raw: string, threadId?: string): Promise<{ draftId: string; messageId?: string; threadId?: string }> {
  const result = (await gmailFetch("/drafts", {
    method: "POST",
    body: { message: { raw, ...(threadId ? { threadId } : {}) } },
    capability: { id: "gmail.draft", detail: "Saved one draft from Inbox" },
  })) as { id?: unknown; message?: { id?: unknown; threadId?: unknown } };
  if (typeof result.id !== "string") throw new GmailError("Gmail created something, but not what AgentOS expected.", "failed");
  return {
    draftId: result.id,
    messageId: typeof result.message?.id === "string" ? result.message.id : undefined,
    threadId: typeof result.message?.threadId === "string" ? result.message.threadId : undefined,
  };
}

/** Sends a draft exactly as it sits in Gmail, including any edits made there. */
export async function sendInboxDraft(draftId: string): Promise<GmailSentMessage> {
  return sentMessage(
    await gmailFetch("/drafts/send", {
      method: "POST",
      body: { id: draftId },
      capability: { id: "gmail.send", detail: "Sent one draft from Inbox" },
    }),
  );
}

/** Deletes a draft. A draft is unsent text, not mail, so it does not go through Trash. */
export async function deleteInboxDraft(draftId: string): Promise<void> {
  await gmailFetch(`/drafts/${encodeURIComponent(draftId)}`, {
    method: "DELETE",
    capability: { id: "gmail.draft", detail: "Discarded one draft from Inbox" },
  });
}

/** Label ids by name, for the life of the process. A label is never renamed by AgentOS. */
const labelIds = new Map<string, string>();

/** The id of a user label with this exact name, creating it in Gmail the first time. */
export async function ensureLabel(name: string): Promise<string> {
  const cached = labelIds.get(name);
  if (cached) return cached;

  const listed = (await gmailFetch("/labels")) as { labels?: { id?: unknown; name?: unknown }[] };
  const existing = (listed.labels ?? []).find((label) => typeof label.name === "string" && label.name.toLowerCase() === name.toLowerCase());
  if (existing && typeof existing.id === "string") {
    labelIds.set(name, existing.id);
    return existing.id;
  }

  const created = (await gmailFetch("/labels", {
    method: "POST",
    body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    capability: { id: "gmail.modify", detail: `Created the ${name} label` },
  })) as { id?: unknown };
  if (typeof created.id !== "string") throw new GmailError("Gmail did not create the label.", "failed");
  labelIds.set(name, created.id);
  return created.id;
}

/** Adds and removes labels on one message. */
export async function labelMessage(messageId: string, addLabelIds: readonly string[], removeLabelIds: readonly string[] = []): Promise<void> {
  await gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: "POST",
    body: { addLabelIds, removeLabelIds },
    capability: { id: "gmail.modify", detail: "Tagged one sent email" },
  });
}

/** Test-only: forgets cached label ids. */
export function resetLabelCache(): void {
  labelIds.clear();
  mailboxAddress = undefined;
}
