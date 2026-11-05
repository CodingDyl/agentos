import { randomUUID } from "node:crypto";
import { buildComposedMessage, withoutBccHeader } from "../mail/compose-mime";
import { titanAccount } from "../mail/titan-credentials";
import { appendTitanSent } from "../mail/titan-client";
import { sendTitanRaw, type SmtpEnvelope } from "../mail/titan-smtp";

/**
 * Sending one outreach email from the Virtara mailbox (Titan).
 *
 * Replies are noticed by the existing Titan reply watch (`titan-replies.ts`),
 * which searches that mailbox for mail from contacted prospects. Gmail
 * outreach sync (`sync.ts`) does not see Virtara-sent mail; that is the
 * Gmail inbox, not this one. The sent copy is filed in Titan Sent so it is
 * in the mailbox a person already reads. AgentOS Inbox itself lists INBOX,
 * not Sent, the same as for other Virtara mail composed in Inbox.
 */

export interface VirtaraSender {
  address: string;
  name?: string;
}

export interface VirtaraMessage {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  from: { address: string; name?: string };
}

export interface VirtaraSendDeps {
  account: () => Promise<{ address: string; senderName?: string } | undefined>;
  send: (raw: string, envelope: SmtpEnvelope) => Promise<void>;
  appendSent: (raw: string) => Promise<void>;
  now: () => Date;
}

const live: VirtaraSendDeps = {
  account: titanAccount,
  send: sendTitanRaw,
  appendSent: appendTitanSent,
  now: () => new Date(),
};

let override: Partial<VirtaraSendDeps> | undefined;

/** For tests, so they never touch Titan. */
export function setVirtaraForTests(deps: Partial<VirtaraSendDeps> | undefined): void {
  override = deps;
}

function deps(extra: Partial<VirtaraSendDeps> = {}): VirtaraSendDeps {
  return { ...live, ...override, ...extra };
}

/** The linked Virtara address and sender name, or undefined when none is linked. */
export async function virtaraSender(extra: Partial<VirtaraSendDeps> = {}): Promise<VirtaraSender | undefined> {
  const account = await deps(extra).account();
  if (!account) return undefined;
  return {
    address: account.address,
    ...(account.senderName ? { name: account.senderName } : {}),
  };
}

/** Builds the MIME so a malformed email can be refused before a send slot is reserved. */
export function buildVirtaraRaw(message: VirtaraMessage, at?: Date, messageId?: string): string {
  return buildComposedMessage({
    from: message.from.address,
    fromName: message.from.name,
    date: at,
    messageId,
    to: [message.to],
    subject: message.subject,
    body: message.body,
    inReplyTo: message.inReplyTo,
  });
}

/**
 * Sends over SMTP, then files a copy in Titan Sent. A failed Sent copy is
 * only logged: the email has already gone. Returns the Message-ID that went
 * on the wire, so the send can be settled as sent.
 */
export async function sendViaVirtara(
  message: VirtaraMessage,
  extra: Partial<VirtaraSendDeps> = {},
): Promise<{ messageId: string }> {
  const used = deps(extra);
  const domain = message.from.address.slice(message.from.address.indexOf("@") + 1) || "agentos.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const raw = buildVirtaraRaw(message, used.now(), messageId);
  await used.send(withoutBccHeader(raw), { from: message.from.address, to: [message.to] });
  try {
    await used.appendSent(raw);
  } catch (error) {
    console.error(
      "[outreach] could not file a sent Virtara email in Sent:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  return { messageId };
}
