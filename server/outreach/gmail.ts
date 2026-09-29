import { getOutreachAccessToken, OutreachAuthError } from "./auth";
import { buildMessage, toRaw, type EmailMessage } from "./mime";

/**
 * The outreach mailbox's Gmail calls. Only what is used: create a draft.
 *
 * Every call carries the outreach mailbox's own token (never the inbox's),
 * and a failure reads as a plain sentence, never Google's raw body, which
 * can echo what was sent.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class OutreachGmailError extends Error {
  constructor(
    message: string,
    readonly reason: "offline" | "unauthorized" | "failed",
  ) {
    super(message);
    this.name = "OutreachGmailError";
  }
}

async function gmailPost(path: string, body: unknown): Promise<unknown> {
  const token = await getOutreachAccessToken();
  let response: Response;
  try {
    response = await fetch(`${GMAIL_API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new OutreachGmailError("Could not reach Gmail.", "offline");
  }

  if (response.status === 401 || response.status === 403) {
    throw new OutreachGmailError("Gmail refused the request. Reconnect the outreach mailbox.", "unauthorized");
  }
  if (!response.ok) throw new OutreachGmailError(`Gmail responded with ${response.status}.`, "failed");

  try {
    return await response.json();
  } catch {
    throw new OutreachGmailError("Gmail's answer could not be read.", "failed");
  }
}

export interface CreatedDraft {
  draftId: string;
  messageId: string;
  threadId?: string;
}

/**
 * Puts an email in the outreach mailbox's Drafts. Nothing is sent: a person
 * opens it in Gmail and presses Send.
 */
export async function createDraft(message: EmailMessage, threadId?: string): Promise<CreatedDraft> {
  const raw = toRaw(buildMessage(message));
  const result = (await gmailPost("/drafts", { message: { raw, ...(threadId ? { threadId } : {}) } })) as {
    id?: unknown;
    message?: { id?: unknown; threadId?: unknown };
  };

  if (typeof result.id !== "string" || typeof result.message?.id !== "string") {
    throw new OutreachGmailError("Gmail created something, but its answer was not what AgentOS expected.", "failed");
  }
  return {
    draftId: result.id,
    messageId: result.message.id,
    threadId: typeof result.message.threadId === "string" ? result.message.threadId : undefined,
  };
}

/** A link that opens the draft in the outreach mailbox, whichever Google account the browser is in. */
export function draftUrl(address: string, messageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#drafts?compose=${encodeURIComponent(messageId)}`;
}

export { OutreachAuthError };
