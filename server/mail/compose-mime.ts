import { randomBytes } from "node:crypto";
import { isBlockedAttachment, type MailAttachment } from "../../shared/mail-compose-types";
import { base64Lines, CONTROL, encodeHeader, isPlainAddress, MimeError } from "../outreach/mime";

/**
 * An email written in the Inbox, as RFC 2822 text: several recipients, Cc and
 * Bcc, and attachments as `multipart/mixed`.
 *
 * The same rule as `outreach/mime.ts`, whose helpers this reuses: nothing a
 * person typed can start a new header. Addresses must be plain, the subject
 * one line, and attachment names and types are cleaned before they go
 * anywhere near a header.
 */

export interface ComposedEmail {
  /** Set when sending over SMTP, which (unlike Gmail's API) needs the message to say who it is from. */
  from?: string;
  /** The name shown next to `from`. Quoted, or RFC 2047-encoded when it is not plain ASCII. */
  fromName?: string;
  /** RFC 5322 date, and a Message-ID the message can be found by later. Gmail adds both itself. */
  date?: Date;
  messageId?: string;
  to: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  subject: string;
  body: string;
  /** The Message-ID being answered, so the reply threads in every client. */
  inReplyTo?: string;
  attachments?: readonly MailAttachment[];
}

/** `"Gavin <gavin@example.com>"` and `gavin@example.com` both become the bare address. */
export function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/<([^<>]+)>\s*$/);
  return (bracketed ? bracketed[1] : trimmed).trim();
}

function addressList(values: readonly string[] | undefined, label: string): string[] {
  const addresses = [...new Set((values ?? []).map(normalizeAddress).filter((value) => value.length > 0))];
  for (const address of addresses) {
    if (!isPlainAddress(address)) throw new MimeError(`${label}: "${address.slice(0, 80)}" is not a valid email address.`);
  }
  return addresses;
}

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

/** A filename safe inside a quoted header parameter: no path, no quotes, no control characters. */
export function safeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/^.*[\\/]/, "")
    .replace(/["\\]/g, "")
    .trim()
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : "attachment";
}

/** RFC 2231 for names that are not plain ASCII, so "Résumé.pdf" survives the trip. */
function filenameParams(name: string): string {
  return /^[ -~]*$/.test(name)
    ? `filename="${name}"`
    : `filename="${encodeHeader(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function wrapBase64(data: string): string {
  return (data.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** `"Dylan Petzer" <dylan@virtara.co.za>`, or the bare address when there is no name. */
export function fromHeader(address: string, name: string | undefined): string {
  const display = name?.trim();
  if (!display) return address;
  if (CONTROL.test(display) || /[<>]/.test(display)) throw new MimeError("The sender name can't contain line breaks or angle brackets.");
  const phrase = /^[ -~]*$/.test(display) ? `"${display.replace(/["\\]/g, (character) => `\\${character}`)}"` : encodeHeader(display);
  return `${phrase} <${address}>`;
}

/** The raw message, `\r\n` line endings, ready to base64url. */
export function buildComposedMessage(email: ComposedEmail): string {
  const to = addressList(email.to, "To");
  const cc = addressList(email.cc, "Cc");
  const bcc = addressList(email.bcc, "Bcc");
  if (to.length + cc.length + bcc.length === 0) throw new MimeError("Add at least one recipient.");

  if (CONTROL.test(email.subject)) throw new MimeError("The subject must be one line.");
  if (!email.subject.trim()) throw new MimeError("The subject is empty.");
  if (email.inReplyTo !== undefined && (CONTROL.test(email.inReplyTo) || !/^<[^<>\s]{1,300}>$/.test(email.inReplyTo))) {
    throw new MimeError("The message being answered is not a valid Message-ID.");
  }

  if (email.from !== undefined && !isPlainAddress(email.from)) throw new MimeError("The sending address is not valid.");
  if (email.messageId !== undefined && !/^<[^<>\s]{1,300}>$/.test(email.messageId)) throw new MimeError("The Message-ID is not valid.");

  const headers = [
    ...(email.from ? [`From: ${fromHeader(email.from, email.fromName)}`] : []),
    ...(email.date ? [`Date: ${email.date.toUTCString().replace("GMT", "+0000")}`] : []),
    ...(email.messageId ? [`Message-ID: ${email.messageId}`] : []),
    ...(to.length > 0 ? [`To: ${to.join(", ")}`] : []),
    ...(cc.length > 0 ? [`Cc: ${cc.join(", ")}`] : []),
    // Gmail removes Bcc from what recipients receive and delivers to it from here.
    ...(bcc.length > 0 ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(email.subject.trim())}`,
    "MIME-Version: 1.0",
    ...(email.inReplyTo ? [`In-Reply-To: ${email.inReplyTo}`, `References: ${email.inReplyTo}`] : []),
  ];

  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(email.body.replace(/\r?\n/g, "\r\n")),
  ].join("\r\n");

  const attachments = email.attachments ?? [];
  if (attachments.length === 0) {
    return `${headers.join("\r\n")}\r\n${textPart}\r\n`;
  }

  const boundary = `agentos_${randomBytes(12).toString("hex")}`;
  const parts = attachments.map((attachment) => {
    const filename = safeFilename(attachment.filename);
    if (isBlockedAttachment(filename)) throw new MimeError(`${filename} is a file type mail servers block. Zip it or share a link instead.`);
    const mimeType = MIME_TYPE.test(attachment.mimeType) ? attachment.mimeType : "application/octet-stream";
    return [
      `Content-Type: ${mimeType}; name="${encodeHeader(filename)}"`,
      `Content-Disposition: attachment; ${filenameParams(filename)}`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(attachment.data),
    ].join("\r\n");
  });

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    textPart,
    ...parts.flatMap((part) => [`--${boundary}`, part]),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/**
 * The copy that goes over SMTP: the same message without its Bcc header, so
 * Bcc recipients stay hidden from everyone else. (Gmail's API does this
 * itself; an SMTP server delivers the headers exactly as given.) Folded
 * continuation lines of the Bcc header go with it.
 */
export function withoutBccHeader(raw: string): string {
  const split = raw.search(/\r?\n\r?\n/);
  if (split < 0) return raw;
  const head = raw.slice(0, split);
  const lines = head.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!skipping) kept.push(line);
      continue;
    }
    skipping = /^bcc\s*:/i.test(line);
    if (!skipping) kept.push(line);
  }
  return `${kept.join("\r\n")}${raw.slice(split)}`;
}
