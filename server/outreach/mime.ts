/**
 * An email as Gmail wants it: RFC 2822 text, base64url-encoded.
 *
 * Built by hand because the only thing needed is one plain-text message, and
 * every header value here comes from somewhere a person or a model wrote.
 * Header injection is the risk: a newline in a subject or an address would
 * let text after it become a header (`Bcc:`). So nothing is trusted: control
 * characters are refused, not stripped, and the recipient must look like one
 * plain address.
 */

export class MimeError extends Error {}

/** One plain address: no display name, no list, no angle brackets, nothing that could start a new header. */
const ADDRESS =
  /^[\p{L}\p{N}._%+'-]{1,64}@[\p{L}\p{N}.-]{1,190}\.\p{L}{2,24}$/u;

// eslint-disable-next-line no-control-regex
export const CONTROL = /[\u0000-\u001F\u007F]/;

export function isPlainAddress(value: string): boolean {
  return value.length <= 254 && !value.includes("..") && ADDRESS.test(value);
}

/** A header value that is pure ASCII passes through; anything else becomes an encoded word (RFC 2047). */
export function encodeHeader(value: string): string {
  return /^[ -~]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function base64Lines(text: string): string {
  return (
    Buffer.from(text, "utf8")
      .toString("base64")
      .match(/.{1,76}/g) ?? []
  ).join("\r\n");
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  /** For a reply: the Message-ID being answered, so mail clients thread it. */
  inReplyTo?: string;
  /** The sender name and the mailbox's own address. Gmail sends from the authenticated account either way. */
  from?: { name: string; address: string };
}

/** The raw message, `\r\n` line endings, ready to base64url. */
export function buildMessage({
  to,
  subject,
  body,
  inReplyTo,
  from,
}: EmailMessage): string {
  if (!isPlainAddress(to))
    throw new MimeError("The recipient is not a plain email address.");
  if (CONTROL.test(subject))
    throw new MimeError("The subject must be one line.");
  if (!subject.trim()) throw new MimeError("The subject is empty.");
  if (
    inReplyTo !== undefined &&
    (CONTROL.test(inReplyTo) || !/^<[^<>\s]{1,300}>$/.test(inReplyTo))
  ) {
    throw new MimeError(
      "The message being answered is not a valid Message-ID.",
    );
  }

  if (from && (!isPlainAddress(from.address) || CONTROL.test(from.name)))
    throw new MimeError("The sender is not valid.");
  const fromName = from?.name.replace(/["<>\\]/g, "").trim();

  const headers = [
    ...(from ? [`From: ${fromName ? `${/^[ -~]*$/.test(fromName) ? `"${fromName}"` : encodeHeader(fromName)} ` : ""}<${from.address}>`] : []),
    `To: ${to}`,
    `Subject: ${encodeHeader(subject.trim())}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    ...(inReplyTo
      ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`]
      : []),
  ];

  // Body line endings become CRLF; the transfer encoding keeps everything else exact.
  return `${headers.join("\r\n")}\r\n\r\n${base64Lines(body.replace(/\r?\n/g, "\r\n"))}\r\n`;
}

/** Gmail's `raw` field: the message, base64url without padding. */
export function toRaw(message: string): string {
  return Buffer.from(message, "utf8").toString("base64url");
}
