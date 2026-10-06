import { randomUUID } from "node:crypto";
import {
  MAIL_TAG_LABEL,
  type MailComposeInput,
  type MailComposeResult,
  type MailOutboxItem,
  type MailReplyContext,
  type MailSendTag,
} from "../../shared/mail-compose-types";
import { mailAccountOf, type MailAccountId } from "../../shared/mail-account-types";
import { replySubject } from "../outreach/draft";
import { toRaw } from "../outreach/mime";
import { simpleParser, type AddressObject } from "mailparser";
import { buildComposedMessage, normalizeAddress, withoutBccHeader } from "./compose-mime";
import { mailDatabase } from "./db";
import {
  deleteInboxDraft,
  ensureLabel,
  getMailboxAddress,
  getReplyContext,
  GmailError,
  labelMessage,
  saveInboxDraft,
  sendInboxDraft,
  sendInboxMessage,
  type GmailSentMessage,
} from "./gmail-client";
import {
  appendTitanSent,
  deleteTitanDraft,
  getTitanReplyContext,
  readTitanDraft,
  saveTitanDraft,
  TitanDraftMissingError,
  TitanError,
} from "./titan-client";
import { titanAccount } from "./titan-credentials";
import { sendTitanRaw, type SmtpEnvelope } from "./titan-smtp";

/**
 * Writing mail from the Inbox.
 *
 * Gmail does the sending and keeps the text. `mail_outbox` remembers only
 * what the Sent and Drafts views need to list and filter by tag: who, the
 * subject, the tag, and how many files. Never the body, never the files.
 *
 * A tag other than `normal` is also a Gmail label on the sent message, so
 * "my Business email" is a search in Gmail too. Labelling happens after the
 * send; if it fails, the email has still gone and the result says so instead
 * of pretending the send failed.
 *
 * The Virtara mailbox (Titan) sends over SMTP instead. SMTP keeps no copy,
 * so AgentOS files one in Titan's Sent folder afterwards, as a desktop mail
 * app does, and drafts live in Titan's Drafts folder. Tags on Virtara mail
 * are kept here only: IMAP has no labels to mirror them to.
 */

export interface ComposeDeps {
  sendMessage: (raw: string, threadId?: string) => Promise<GmailSentMessage>;
  saveDraft: (raw: string, threadId?: string) => Promise<{ draftId: string; messageId?: string; threadId?: string }>;
  sendDraft: (draftId: string) => Promise<GmailSentMessage>;
  deleteDraft: (draftId: string) => Promise<void>;
  ensureLabel: (name: string) => Promise<string>;
  labelMessage: (messageId: string, addLabelIds: readonly string[], removeLabelIds?: readonly string[]) => Promise<void>;
  replyContext: typeof getReplyContext;
  mailboxAddress: () => Promise<string | undefined>;
  now: () => Date;
  /** The Virtara mailbox. Absent (as in most tests) means it is not linked. */
  titan?: TitanComposeDeps;
}

export interface TitanComposeDeps {
  /** The linked address, or undefined when the mailbox is not linked. */
  address: () => Promise<string | undefined>;
  send: (raw: string, envelope: SmtpEnvelope) => Promise<void>;
  appendSent: (raw: string) => Promise<void>;
  saveDraft: (raw: string, messageId: string) => Promise<string>;
  readDraft: (ref: string) => Promise<string>;
  deleteDraft: (ref: string) => Promise<void>;
  replyContext: typeof getTitanReplyContext;
}

export const defaultTitanComposeDeps: TitanComposeDeps = {
  address: async () => (await titanAccount())?.address,
  send: sendTitanRaw,
  appendSent: appendTitanSent,
  saveDraft: saveTitanDraft,
  readDraft: readTitanDraft,
  deleteDraft: deleteTitanDraft,
  replyContext: getTitanReplyContext,
};

export const defaultComposeDeps: ComposeDeps = {
  sendMessage: sendInboxMessage,
  saveDraft: saveInboxDraft,
  sendDraft: sendInboxDraft,
  deleteDraft: deleteInboxDraft,
  ensureLabel,
  labelMessage,
  replyContext: getReplyContext,
  mailboxAddress: getMailboxAddress,
  now: () => new Date(),
  titan: defaultTitanComposeDeps,
};

export class OutboxNotFoundError extends Error {}

interface OutboxRow {
  id: string;
  kind: string;
  gmail_message_id: string | null;
  gmail_draft_id: string | null;
  thread_id: string | null;
  to_list: string;
  subject: string;
  tag: string;
  attachment_count: number;
  label_applied: number;
  created_at: string;
  sent_at: string | null;
  /** For Virtara mail, `gmail_message_id` holds the Message-ID header and `gmail_draft_id` the Drafts folder reference. */
  account: string;
}

function toItem(row: OutboxRow): MailOutboxItem {
  let to: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.to_list);
    if (Array.isArray(parsed)) to = parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    // A damaged row still lists, just without recipients.
  }
  return {
    id: row.id,
    kind: row.kind === "draft" ? "draft" : "sent",
    to,
    subject: row.subject,
    tag: row.tag === "business" || row.tag === "virtara" ? row.tag : "normal",
    account: row.account === "titan" ? "titan" : "gmail",
    attachmentCount: row.attachment_count,
    threadId: row.thread_id ?? undefined,
    labelApplied: row.label_applied === 1,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? undefined,
  };
}

function readRow(id: string): OutboxRow | undefined {
  return mailDatabase().prepare("SELECT * FROM mail_outbox WHERE id = ?").get(id) as OutboxRow | undefined;
}

/** Everything written here, newest first, optionally one tag only. */
export function listOutbox(tag?: MailSendTag, limit = 200): MailOutboxItem[] {
  const rows = (
    tag
      ? mailDatabase().prepare("SELECT * FROM mail_outbox WHERE tag = ? ORDER BY created_at DESC LIMIT ?").all(tag, limit)
      : mailDatabase().prepare("SELECT * FROM mail_outbox ORDER BY created_at DESC LIMIT ?").all(limit)
  ) as unknown as OutboxRow[];
  return rows.map(toItem);
}

/**
 * Puts the tag's Gmail label on a sent message, taking off the other tag's
 * label when `previous` says it had one. Returns a warning instead of
 * throwing: the email has already gone.
 */
async function applyTag(
  messageId: string,
  tag: MailSendTag,
  deps: ComposeDeps,
  previous?: MailSendTag,
): Promise<{ applied: boolean; warning?: string }> {
  if (tag === previous) return { applied: true };
  const name = tag === "normal" ? undefined : MAIL_TAG_LABEL[tag];
  const previousName = previous && previous !== "normal" ? MAIL_TAG_LABEL[previous] : undefined;
  if (!name && !previousName) return { applied: true };
  try {
    const add = name ? [await deps.ensureLabel(name)] : [];
    const remove = previousName ? [await deps.ensureLabel(previousName)] : [];
    await deps.labelMessage(messageId, add, remove);
    return { applied: true };
  } catch (error) {
    console.error(`[agentos] could not change the tag label on a sent email:`, error);
    const label = name ?? "untagged";
    return { applied: false, warning: `Sent, but Gmail would not update the label. It is still tagged ${label} here.` };
  }
}

/** Who a reply goes to, and its subject, for prefilling the composer. */
export async function replyContextFor(threadId: string, deps: ComposeDeps = defaultComposeDeps): Promise<MailReplyContext> {
  const titan = mailAccountOf(threadId) === "titan" ? requireTitan(deps) : undefined;
  const context = titan ? await titan.replyContext(threadId) : await deps.replyContext(threadId);
  const own = (await (titan ? titan.address() : deps.mailboxAddress()).catch(() => undefined))?.toLowerCase();
  const sender = context.replyToEmail ?? context.fromEmail;
  // The latest message being one's own means the reply continues to whoever it was sent to.
  const to = sender && sender.toLowerCase() !== own ? sender : (context.toEmails.find((email) => email.toLowerCase() !== own) ?? sender ?? "");
  return { to, subject: replySubject(context.subject) };
}

function requireTitan(deps: ComposeDeps): TitanComposeDeps {
  if (!deps.titan) throw new TitanError("The Virtara mailbox is not linked. Link it under Accounts.", "not-connected");
  return deps.titan;
}

/**
 * Which mailbox an email goes from: the one chosen, else the one a reply's
 * thread arrived in, else Virtara for a Virtara-tagged email when that
 * mailbox is linked, else Gmail.
 */
export function chooseSendAccount(input: Pick<MailComposeInput, "from" | "replyToThreadId" | "tag">, titanLinked: boolean): MailAccountId {
  if (input.from) return input.from;
  if (input.replyToThreadId) return mailAccountOf(input.replyToThreadId);
  return input.tag === "virtara" && titanLinked ? "titan" : "gmail";
}

function insertRow(row: OutboxRow): void {
  mailDatabase()
    .prepare(
      `INSERT INTO mail_outbox (id, kind, gmail_message_id, gmail_draft_id, thread_id, to_list, subject, tag, attachment_count, label_applied, created_at, sent_at, account)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.kind,
      row.gmail_message_id,
      row.gmail_draft_id,
      row.thread_id,
      row.to_list,
      row.subject,
      row.tag,
      row.attachment_count,
      row.label_applied,
      row.created_at,
      row.sent_at,
      row.account,
    );
}

/** The Message-ID being answered, from whichever mailbox the thread is in. */
async function inReplyToFor(threadId: string | undefined, deps: ComposeDeps): Promise<string | undefined> {
  if (!threadId) return undefined;
  const context = mailAccountOf(threadId) === "titan" ? await requireTitan(deps).replyContext(threadId) : await deps.replyContext(threadId);
  return context.messageId && /^<[^<>\s]{1,300}>$/.test(context.messageId) ? context.messageId : undefined;
}

function uniqueRecipients(input: Pick<MailComposeInput, "to" | "cc" | "bcc">): string[] {
  return [...new Set([...input.to, ...input.cc, ...input.bcc].map(normalizeAddress).filter((address) => address.length > 0))];
}

/** Sends a finished message from the Virtara mailbox, then files a copy in its Sent folder. */
async function sendFromTitan(raw: string, from: string, recipients: readonly string[], titan: TitanComposeDeps): Promise<string | undefined> {
  await titan.send(withoutBccHeader(raw), { from, to: recipients });
  try {
    await titan.appendSent(raw);
    return undefined;
  } catch (error) {
    console.error("[agentos] could not file a sent Virtara email in Sent:", error instanceof Error ? error.message : "unknown error");
    return "Sent, but Titan would not save a copy in its Sent folder.";
  }
}

async function composeFromTitan(input: MailComposeInput, deps: ComposeDeps): Promise<MailComposeResult> {
  const titan = requireTitan(deps);
  const from = await titan.address();
  if (!from) throw new TitanError("The Virtara mailbox is not linked. Link it under Accounts.", "not-connected");

  const domain = from.slice(from.indexOf("@") + 1) || "agentos.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const raw = buildComposedMessage({
    from,
    date: deps.now(),
    messageId,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    inReplyTo: await inReplyToFor(input.replyToThreadId, deps),
    attachments: input.attachments,
  });

  const now = deps.now().toISOString();
  const recipients = uniqueRecipients(input);
  const base = {
    id: randomUUID(),
    gmail_message_id: messageId,
    thread_id: input.replyToThreadId ?? null,
    to_list: JSON.stringify(recipients),
    subject: input.subject.trim(),
    tag: input.tag,
    attachment_count: input.attachments.length,
    // No labels to apply in IMAP: the tag lives here.
    label_applied: 1,
    created_at: now,
    account: "titan",
  };

  let warning: string | undefined;
  let row: OutboxRow;
  if (input.mode === "send") {
    warning = await sendFromTitan(raw, from, recipients, titan);
    row = { ...base, kind: "sent", gmail_draft_id: null, sent_at: now };
  } else {
    row = { ...base, kind: "draft", gmail_draft_id: await titan.saveDraft(raw, messageId), sent_at: null };
  }
  insertRow(row);
  return { item: toItem(row), ...(warning ? { warning } : {}) };
}

/** Sends now or saves a draft, from whichever mailbox it belongs to, then records it. */
export async function composeMail(input: MailComposeInput, deps: ComposeDeps = defaultComposeDeps): Promise<MailComposeResult> {
  const titanLinked = deps.titan ? Boolean(await deps.titan.address()) : false;
  if (chooseSendAccount(input, titanLinked) === "titan") return composeFromTitan(input, deps);

  const raw = toRaw(
    buildComposedMessage({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body: input.body,
      inReplyTo: await inReplyToFor(input.replyToThreadId, deps),
      attachments: input.attachments,
    }),
  );
  // A Gmail thread id threads the reply in Gmail; a Virtara thread's id means nothing there.
  const gmailThreadId = input.replyToThreadId && mailAccountOf(input.replyToThreadId) === "gmail" ? input.replyToThreadId : undefined;

  const now = deps.now().toISOString();
  const recipients = [...input.to, ...input.cc, ...input.bcc].map(normalizeAddress);
  let warning: string | undefined;
  let row: OutboxRow;

  if (input.mode === "send") {
    const sent = await deps.sendMessage(raw, gmailThreadId);
    const tagged = await applyTag(sent.messageId, input.tag, deps);
    warning = tagged.warning;
    row = {
      id: randomUUID(),
      kind: "sent",
      gmail_message_id: sent.messageId,
      gmail_draft_id: null,
      thread_id: sent.threadId ?? input.replyToThreadId ?? null,
      to_list: JSON.stringify(recipients),
      subject: input.subject.trim(),
      tag: input.tag,
      attachment_count: input.attachments.length,
      label_applied: tagged.applied ? 1 : 0,
      created_at: now,
      sent_at: now,
      account: "gmail",
    };
  } else {
    const draft = await deps.saveDraft(raw, gmailThreadId);
    row = {
      id: randomUUID(),
      kind: "draft",
      gmail_message_id: draft.messageId ?? null,
      gmail_draft_id: draft.draftId,
      thread_id: draft.threadId ?? input.replyToThreadId ?? null,
      to_list: JSON.stringify(recipients),
      subject: input.subject.trim(),
      tag: input.tag,
      attachment_count: input.attachments.length,
      // The label goes on when the draft is sent, which is when it becomes mail.
      label_applied: input.tag === "normal" ? 1 : 0,
      created_at: now,
      sent_at: null,
      account: "gmail",
    };
  }

  insertRow(row);
  return { item: toItem(row), ...(warning ? { warning } : {}) };
}

function addressesIn(field: AddressObject | AddressObject[] | undefined): string[] {
  const groups = field === undefined ? [] : Array.isArray(field) ? field : [field];
  return groups.flatMap((group) => group.value.map((entry) => entry.address?.trim()).filter((address): address is string => Boolean(address)));
}

/** Sends a Virtara draft as it now stands in Titan, files it in Sent, and removes it from Drafts. */
async function sendSavedTitanDraft(row: OutboxRow & { gmail_draft_id: string }, deps: ComposeDeps): Promise<MailComposeResult> {
  const titan = requireTitan(deps);
  const from = await titan.address();
  if (!from) throw new TitanError("The Virtara mailbox is not linked. Link it under Accounts.", "not-connected");

  let raw: string;
  try {
    raw = await titan.readDraft(row.gmail_draft_id);
  } catch (error) {
    if (error instanceof TitanDraftMissingError) {
      mailDatabase().prepare("DELETE FROM mail_outbox WHERE id = ?").run(row.id);
      throw new OutboxNotFoundError(error.message);
    }
    throw error;
  }

  const parsed = await simpleParser(raw);
  const recipients = [...new Set([...addressesIn(parsed.to), ...addressesIn(parsed.cc), ...addressesIn(parsed.bcc)])];
  if (recipients.length === 0) throw new TitanError("That draft has no recipients. Add them in Titan, then send it again.", "failed");

  const warning = await sendFromTitan(raw, from, recipients, titan);
  try {
    await titan.deleteDraft(row.gmail_draft_id);
  } catch (error) {
    console.error("[agentos] a sent Virtara draft could not be removed from Drafts:", error instanceof Error ? error.message : "unknown error");
  }

  const now = deps.now().toISOString();
  mailDatabase()
    .prepare("UPDATE mail_outbox SET kind = 'sent', gmail_draft_id = NULL, to_list = ?, sent_at = ? WHERE id = ?")
    .run(JSON.stringify(recipients), now, row.id);
  const updated = readRow(row.id);
  if (!updated) throw new OutboxNotFoundError("That draft is not in AgentOS.");
  return { item: toItem(updated), ...(warning ? { warning } : {}) };
}

function requireDraft(id: string): OutboxRow & { gmail_draft_id: string } {
  const row = readRow(id);
  if (!row || row.kind !== "draft" || !row.gmail_draft_id) throw new OutboxNotFoundError("That draft is not in AgentOS.");
  return row as OutboxRow & { gmail_draft_id: string };
}

/** Sends a draft saved earlier, as it now stands in Gmail, then tags it. */
export async function sendSavedDraft(id: string, deps: ComposeDeps = defaultComposeDeps): Promise<MailComposeResult> {
  const row = requireDraft(id);
  if (row.account === "titan") return sendSavedTitanDraft(row, deps);
  let sent: GmailSentMessage;
  try {
    sent = await deps.sendDraft(row.gmail_draft_id);
  } catch (error) {
    // Sent or deleted in Gmail already: it is no longer a draft AgentOS can act on.
    if (error instanceof GmailError && /404/.test(error.message)) {
      mailDatabase().prepare("DELETE FROM mail_outbox WHERE id = ?").run(id);
      throw new OutboxNotFoundError("That draft is no longer in Gmail. It may have been sent or deleted there.");
    }
    throw error;
  }
  const tagged = await applyTag(sent.messageId, row.tag as MailSendTag, deps);
  const now = deps.now().toISOString();

  mailDatabase()
    .prepare(
      "UPDATE mail_outbox SET kind = 'sent', gmail_message_id = ?, gmail_draft_id = NULL, thread_id = COALESCE(?, thread_id), label_applied = ?, sent_at = ? WHERE id = ?",
    )
    .run(sent.messageId, sent.threadId ?? null, tagged.applied ? 1 : 0, now, id);

  const updated = readRow(id);
  if (!updated) throw new OutboxNotFoundError("That draft is not in AgentOS.");
  return { item: toItem(updated), ...(tagged.warning ? { warning: tagged.warning } : {}) };
}

/** Deletes a draft in Gmail and forgets it here. Already gone in Gmail counts as done. */
export async function discardSavedDraft(id: string, deps: ComposeDeps = defaultComposeDeps): Promise<void> {
  const row = requireDraft(id);
  if (row.account === "titan") {
    await requireTitan(deps).deleteDraft(row.gmail_draft_id);
    mailDatabase().prepare("DELETE FROM mail_outbox WHERE id = ?").run(id);
    return;
  }
  try {
    await deps.deleteDraft(row.gmail_draft_id);
  } catch (error) {
    if (!(error instanceof GmailError && /404/.test(error.message))) throw error;
  }
  mailDatabase().prepare("DELETE FROM mail_outbox WHERE id = ?").run(id);
}

/** Changes a recorded email's tag. On sent mail, the Gmail label follows; a draft is labelled when it is sent. */
export async function retagOutboxItem(id: string, tag: MailSendTag, deps: ComposeDeps = defaultComposeDeps): Promise<MailComposeResult> {
  const row = readRow(id);
  if (!row) throw new OutboxNotFoundError("That email is not in AgentOS.");

  let applied = tag === "normal";
  let warning: string | undefined;
  if (row.account === "titan") {
    // Virtara mail has no labels to change; the tag is AgentOS's own record.
    applied = true;
  } else if (row.kind === "sent" && row.gmail_message_id) {
    // A label that never made it on cannot be taken off; only remove what is there.
    const previous = row.label_applied === 1 ? (row.tag as MailSendTag) : undefined;
    const tagged = await applyTag(row.gmail_message_id, tag, deps, previous);
    applied = tagged.applied;
    warning = tagged.warning?.replace(/^Sent, but/, "Retagged, but");
  }

  mailDatabase().prepare("UPDATE mail_outbox SET tag = ?, label_applied = ? WHERE id = ?").run(tag, applied ? 1 : 0, id);
  const updated = readRow(id);
  if (!updated) throw new OutboxNotFoundError("That email is not in AgentOS.");
  return { item: toItem(updated), ...(warning ? { warning } : {}) };
}
