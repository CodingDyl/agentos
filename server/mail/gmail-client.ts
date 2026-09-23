import type { AgentFailureReason } from "../../shared/agentos-types";
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

async function gmailFetch(path: string): Promise<unknown> {
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
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

/** Up to 100 most recent INBOX thread ids, newest first. */
export async function listInboxThreadIds(): Promise<string[]> {
  const payload = (await gmailFetch("/threads?labelIds=INBOX&maxResults=100")) as GmailThreadListResponse;
  return (payload.threads ?? []).map((thread) => thread.id);
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
