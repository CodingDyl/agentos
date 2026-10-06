import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from "imapflow";
import { simpleParser } from "mailparser";
import { MAIL_THREAD_LIMIT, mailCutoff } from "../../shared/mail-types";
import { parseTitanThreadId, titanThreadId } from "../../shared/mail-account-types";
import type { ThreadSummaryInput } from "./store";
import { readTitanCredentials, type TitanCredentials } from "./titan-credentials";

/**
 * The Virtara mailbox (Titan) over IMAP.
 *
 * One TLS connection is shared by everything here and closed after a minute
 * of quiet, so a Refresh or a bulk "Done" on 40 messages logs in once, not 40
 * times. Each operation holds INBOX's lock, which IMAPFlow queues, so two
 * actions never interleave on the one connection.
 *
 * Like Gmail, the mailbox stays the source of truth: AgentOS caches a summary
 * of each message, reads a body only when it is opened, and every change
 * (read, Trash, archive) is made on the server first.
 */

export type TitanErrorReason = "not-connected" | "unauthorized" | "offline" | "failed";

export class TitanError extends Error {
  constructor(
    message: string,
    readonly reason: TitanErrorReason,
  ) {
    super(message);
    this.name = "TitanError";
  }
}

const IDLE_CLOSE_MS = 60_000;
const SNIPPET_SOURCE_BYTES = 64 * 1024;
const BODY_SOURCE_BYTES = 30 * 1024 * 1024;

function clientFor(credentials: TitanCredentials): ImapFlow {
  return new ImapFlow({
    host: credentials.imapHost,
    port: credentials.imapPort,
    secure: true,
    auth: { user: credentials.address, pass: credentials.password },
    // IMAPFlow's logger would print protocol lines; nothing about this mailbox is logged.
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
  });
}

/** Turns IMAPFlow's errors into one the Inbox can explain. Never includes the password. */
export function describeTitanError(error: unknown): TitanError {
  if (error instanceof TitanError) return error;
  const value = error as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string } | undefined;
  if (value?.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials|authentication failed/i.test(`${value?.responseText ?? ""} ${value?.message ?? ""}`)) {
    return new TitanError("Titan refused the login. Check the address and password (the one you use in the Titan app).", "unauthorized");
  }
  if (value?.code && /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)$/.test(value.code)) {
    return new TitanError("Could not reach the Titan mail server. Check the internet connection and the server name.", "offline");
  }
  if (value?.code === "NoConnection" || /timeout/i.test(value?.message ?? "")) {
    return new TitanError("The Titan mail server stopped answering. Try again.", "offline");
  }
  return new TitanError("The Titan mail server did not accept that request.", "failed");
}

/** Logs in and out once: the check before a login is saved. */
export async function verifyTitanLogin(credentials: TitanCredentials): Promise<void> {
  const client = clientFor(credentials);
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.logout();
  } catch (error) {
    client.close();
    throw describeTitanError(error);
  }
}

interface SharedConnection {
  client: ImapFlow;
  idle?: NodeJS.Timeout;
}

let shared: SharedConnection | undefined;
let opening: Promise<SharedConnection> | undefined;

async function openShared(): Promise<SharedConnection> {
  const credentials = await readTitanCredentials();
  if (!credentials) throw new TitanError("The Virtara mailbox is not linked.", "not-connected");
  const client = clientFor(credentials);
  const connection: SharedConnection = { client };
  // A dropped socket must not crash the server; the next call reconnects.
  client.on("error", () => {
    if (shared === connection) shared = undefined;
  });
  client.on("close", () => {
    if (shared === connection) shared = undefined;
  });
  try {
    await client.connect();
  } catch (error) {
    client.close();
    throw describeTitanError(error);
  }
  return connection;
}

async function connection(): Promise<SharedConnection> {
  if (shared?.client.usable) return shared;
  opening ??= openShared().finally(() => {
    opening = undefined;
  });
  shared = await opening;
  return shared;
}

/** Closes the shared connection now. For unlinking the mailbox, and tests. */
export function closeTitanConnection(): void {
  const current = shared;
  shared = undefined;
  if (!current) return;
  clearTimeout(current.idle);
  void current.client.logout().catch(() => current.client.close());
}

async function withConnection<T>(run: (client: ImapFlow) => Promise<T>): Promise<T> {
  const current = await connection();
  clearTimeout(current.idle);
  try {
    return await run(current.client);
  } catch (error) {
    throw describeTitanError(error);
  } finally {
    current.idle = setTimeout(() => {
      if (shared === current) closeTitanConnection();
    }, IDLE_CLOSE_MS);
    current.idle.unref();
  }
}

/** Runs with a folder selected and locked, handing over its UIDVALIDITY. */
async function withFolder<T>(
  folder: string | ((client: ImapFlow) => Promise<string>),
  run: (client: ImapFlow, uidValidity: string) => Promise<T>,
): Promise<T> {
  return withConnection(async (client) => {
    const path = typeof folder === "string" ? folder : await folder(client);
    const lock = await client.getMailboxLock(path);
    try {
      const mailbox = client.mailbox;
      if (!mailbox) throw new TitanError(`Titan did not open ${path}.`, "failed");
      return await run(client, mailbox.uidValidity.toString());
    } finally {
      lock.release();
    }
  });
}

function withInbox<T>(run: (client: ImapFlow, uidValidity: string) => Promise<T>): Promise<T> {
  return withFolder("INBOX", run);
}

/** The UID inside a Titan thread id, provided the mailbox has not been renumbered since it was cached. */
function uidIn(threadId: string, uidValidity: string): number {
  const parsed = parseTitanThreadId(threadId);
  if (!parsed) throw new TitanError(`${threadId} is not a Virtara message.`, "failed");
  if (parsed.uidValidity !== uidValidity) {
    throw new TitanError("The Virtara mailbox was renumbered since this message was synced. Refresh and try again.", "failed");
  }
  return parsed.uid;
}

/** The newest Inbox messages from the Inbox's window, newest first. */
export async function listTitanInboxThreadIds(now: Date = new Date()): Promise<string[]> {
  return withInbox(async (client, uidValidity) => {
    const uids = (await client.search({ since: new Date(mailCutoff(now)) }, { uid: true })) || [];
    return [...uids]
      .sort((left, right) => right - left)
      .slice(0, MAIL_THREAD_LIMIT)
      .map((uid) => titanThreadId(uidValidity, uid));
  });
}

export async function listTitanUnreadThreadIds(now: Date = new Date()): Promise<Set<string>> {
  return withInbox(async (client, uidValidity) => {
    const uids = (await client.search({ since: new Date(mailCutoff(now)), seen: false }, { uid: true })) || [];
    return new Set(uids.map((uid) => titanThreadId(uidValidity, uid)));
  });
}

function firstAddress(addresses: MessageAddressObject[] | undefined): { name?: string; email?: string } {
  const first = addresses?.[0];
  return { name: first?.name?.trim() || undefined, email: first?.address?.trim().toLowerCase() || undefined };
}

/** Collapses whitespace and trims to the length Gmail's own snippets run to. */
export function snippetFrom(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A cached summary from one fetched message. Pure, so it is tested without a server. */
export function summaryFromMessage(threadId: string, message: Pick<FetchMessageObject, "envelope" | "flags" | "internalDate">, text: string | undefined): ThreadSummaryInput {
  const from = firstAddress(message.envelope?.from);
  const date = message.envelope?.date ?? message.internalDate;
  const when = date ? new Date(date) : new Date();
  return {
    threadId,
    fromName: from.name,
    fromEmail: from.email,
    subject: message.envelope?.subject?.trim() || "(no subject)",
    snippet: snippetFrom(text),
    messageDate: (Number.isNaN(when.getTime()) ? new Date() : when).toISOString(),
    unread: !message.flags?.has("\\Seen"),
  };
}

/** Plain text for a parsed message: its text part, or its HTML with the tags taken out. */
export function plainTextOf(parsed: { text?: string; html?: string | false }): string | undefined {
  if (parsed.text?.trim()) return parsed.text;
  if (typeof parsed.html !== "string") return undefined;
  return parsed.html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export async function getTitanThreadSummary(threadId: string): Promise<ThreadSummaryInput> {
  return withInbox(async (client, uidValidity) => {
    const uid = uidIn(threadId, uidValidity);
    const message = await client.fetchOne(String(uid), { uid: true, envelope: true, flags: true, internalDate: true, source: { maxLength: SNIPPET_SOURCE_BYTES } }, { uid: true });
    if (!message) throw new TitanError("That Virtara message is no longer in the Inbox.", "failed");
    const parsed = message.source ? await simpleParser(message.source).catch(() => undefined) : undefined;
    return summaryFromMessage(threadId, message, parsed ? plainTextOf(parsed) : undefined);
  });
}

/** One message's plain-text body, read when a person opens it and never stored. */
export async function getTitanThreadBody(threadId: string): Promise<string> {
  return withInbox(async (client, uidValidity) => {
    const uid = uidIn(threadId, uidValidity);
    const message = await client.fetchOne(String(uid), { uid: true, source: { maxLength: BODY_SOURCE_BYTES } }, { uid: true });
    if (!message || !message.source) throw new TitanError("That Virtara message is no longer in the Inbox.", "failed");
    const parsed = await simpleParser(message.source);
    return plainTextOf(parsed) ?? "(No plain-text body was found for this message.)";
  });
}

export async function setTitanThreadRead(threadId: string, read: boolean): Promise<void> {
  await withInbox(async (client, uidValidity) => {
    const uid = String(uidIn(threadId, uidValidity));
    if (read) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    else await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
  });
}

/** The server's folder for a special use (`\Trash`, `\Archive`), by flag first and then by name. */
async function specialFolder(client: ImapFlow, use: "\\Trash" | "\\Archive" | "\\Sent" | "\\Drafts", names: readonly string[], create: boolean): Promise<string> {
  const folders = await client.list();
  const flagged = folders.find((folder) => folder.specialUse === use);
  if (flagged) return flagged.path;
  const named = folders.find((folder) => names.includes(folder.path.toLowerCase()) || names.includes(folder.name.toLowerCase()));
  if (named) return named.path;
  if (!create) throw new TitanError(`The Virtara mailbox has no ${use.slice(1)} folder.`, "failed");
  const created = await client.mailboxCreate(names[0][0].toUpperCase() + names[0].slice(1));
  return created.path;
}

/** Moves a message to the mailbox's Trash, where Titan keeps it until it is emptied. */
export async function trashTitanThread(threadId: string): Promise<void> {
  await withInbox(async (client, uidValidity) => {
    const uid = String(uidIn(threadId, uidValidity));
    const trash = await specialFolder(client, "\\Trash", ["trash", "deleted items", "deleted messages"], false);
    await client.messageMove(uid, trash, { uid: true });
  });
}

/** "Done": out of the Inbox into Archive (created on first use), never deleted. */
export async function archiveTitanThread(threadId: string): Promise<void> {
  await withInbox(async (client, uidValidity) => {
    const uid = String(uidIn(threadId, uidValidity));
    const archive = await specialFolder(client, "\\Archive", ["archive", "archives"], true);
    await client.messageMove(uid, archive, { uid: true });
  });
}

const SENT_NAMES = ["sent", "sent items", "sent messages"] as const;
const DRAFT_NAMES = ["drafts", "draft"] as const;

const sentFolder = (client: ImapFlow) => specialFolder(client, "\\Sent", SENT_NAMES, true);
const draftsFolder = (client: ImapFlow) => specialFolder(client, "\\Drafts", DRAFT_NAMES, true);

function addressesOf(list: MessageAddressObject[] | undefined): string[] {
  return (list ?? []).map((entry) => entry.address?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
}

/** What a reply needs from a Virtara message: its Message-ID, subject, and who to answer. */
export async function getTitanReplyContext(
  threadId: string,
): Promise<{ messageId?: string; subject: string; fromEmail?: string; replyToEmail?: string; toEmails: string[] }> {
  return withInbox(async (client, uidValidity) => {
    const uid = uidIn(threadId, uidValidity);
    const message = await client.fetchOne(String(uid), { uid: true, envelope: true }, { uid: true });
    if (!message || !message.envelope) throw new TitanError("That Virtara message is no longer in the Inbox.", "failed");
    const envelope = message.envelope;
    return {
      messageId: envelope.messageId?.trim(),
      subject: envelope.subject ?? "",
      fromEmail: addressesOf(envelope.from)[0],
      replyToEmail: addressesOf(envelope.replyTo)[0],
      toEmails: addressesOf(envelope.to),
    };
  });
}

/** A saved draft's place in the Drafts folder: `<uidvalidity>:<uid>`. */
function draftRef(uidValidity: string, uid: number): string {
  return `${uidValidity}:${uid}`;
}

function parseDraftRef(ref: string): { uidValidity: string; uid: number } {
  const match = /^(\d{1,20}):(\d{1,10})$/.exec(ref);
  if (!match) throw new TitanError("That Virtara draft reference is damaged.", "failed");
  return { uidValidity: match[1], uid: Number(match[2]) };
}

/** Thrown when a draft is gone from Titan: sent, edited (which saves it anew) or deleted in the Titan app. */
export class TitanDraftMissingError extends TitanError {
  constructor() {
    super("That draft is no longer in the Virtara Drafts folder. It may have been sent, edited, or deleted in Titan.", "failed");
  }
}

/** Files a copy of a sent email in the Sent folder, read, as a desktop mail app would. */
export async function appendTitanSent(raw: string): Promise<void> {
  await withConnection(async (client) => {
    await client.append(await sentFolder(client), raw, ["\\Seen"]);
  });
}

/** Saves an email to the Drafts folder. Returns its reference, found by Message-ID when the server does not report the UID. */
export async function saveTitanDraft(raw: string, messageId: string): Promise<string> {
  return withConnection(async (client) => {
    const folder = await draftsFolder(client);
    const appended = await client.append(folder, raw, ["\\Draft", "\\Seen"]);
    if (appended && appended.uid && appended.uidValidity !== undefined) return draftRef(appended.uidValidity.toString(), appended.uid);
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = (await client.search({ header: { "message-id": messageId } }, { uid: true })) || [];
      const uid = uids.at(-1);
      const mailbox = client.mailbox;
      if (!uid || !mailbox) throw new TitanError("Titan saved the draft but did not say where.", "failed");
      return draftRef(mailbox.uidValidity.toString(), uid);
    } finally {
      lock.release();
    }
  });
}

/** A saved draft's full source, as it stands in Titan now. */
export async function readTitanDraft(ref: string): Promise<string> {
  const { uidValidity, uid } = parseDraftRef(ref);
  return withFolder(draftsFolder, async (client, current) => {
    if (current !== uidValidity) throw new TitanDraftMissingError();
    const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
    if (!message || !message.source) throw new TitanDraftMissingError();
    return message.source.toString("utf8");
  });
}

/** Deletes a saved draft. Already gone counts as done. */
export async function deleteTitanDraft(ref: string): Promise<void> {
  const { uidValidity, uid } = parseDraftRef(ref);
  await withFolder(draftsFolder, async (client, current) => {
    if (current !== uidValidity) return;
    await client.messageDelete(String(uid), { uid: true });
  });
}
