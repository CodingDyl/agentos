import { z } from "zod";
import { MailAccountIdSchema } from "./mail-account-types";

/**
 * Writing mail from the Inbox: new emails, replies, drafts, attachments, and
 * the tag that says which side of life an outgoing email belongs to.
 */

/**
 * What an outgoing email is for. `normal` is everyday mail; `business` and
 * `virtara` are also applied as Gmail labels, so the split is visible in
 * Gmail itself, not only in AgentOS.
 */
export const MailSendTagSchema = z.enum(["normal", "business", "virtara"]);

/** The Gmail label each tag is filed under. `normal` gets none. */
export const MAIL_TAG_LABEL: Record<Exclude<MailSendTag, "normal">, string> = {
  business: "Business",
  virtara: "Virtara",
};

/**
 * Gmail refuses a message over 25 MB, and attachments grow by a third when
 * base64-encoded for sending. 18 MB of files is what fits with room for the
 * text and headers.
 */
export const MAIL_ATTACHMENT_MAX_TOTAL_BYTES = 18 * 1024 * 1024;
export const MAIL_ATTACHMENT_MAX_COUNT = 10;
export const MAIL_MAX_RECIPIENTS = 20;
export const MAIL_MAX_BODY_CHARS = 50_000;

/**
 * File types Gmail blocks outright. Refused before upload so the person gets
 * a clear reason instead of a bare "Gmail responded with 400".
 */
export const MAIL_BLOCKED_EXTENSIONS: readonly string[] = [
  "ade", "adp", "apk", "appx", "appxbundle", "bat", "cab", "chm", "cmd", "com", "cpl", "dll", "dmg", "exe",
  "hta", "ins", "iso", "isp", "jar", "js", "jse", "lib", "lnk", "mde", "msc", "msi", "msix", "msixbundle",
  "msp", "mst", "nsh", "pif", "ps1", "scr", "sct", "shb", "sys", "vb", "vbe", "vbs", "vxd", "wsc", "wsf", "wsh",
];

export function isBlockedAttachment(filename: string): boolean {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  return filename.includes(".") && MAIL_BLOCKED_EXTENSIONS.includes(extension);
}

/** Exact decoded size of a base64 string, without decoding it. */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export const MailAttachmentSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().max(200).default("application/octet-stream"),
  /** Standard base64, no `data:` prefix. */
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, "Attachment data must be base64."),
});

const AddressListSchema = z.array(z.string().trim().min(1).max(254)).max(MAIL_MAX_RECIPIENTS).default([]);

export const MailComposeRequestSchema = z
  .object({
    /** `send` sends now; `draft` saves to Gmail Drafts. */
    mode: z.enum(["send", "draft"]),
    to: AddressListSchema,
    cc: AddressListSchema,
    bcc: AddressListSchema,
    subject: z.string().max(400),
    body: z.string().max(MAIL_MAX_BODY_CHARS),
    tag: MailSendTagSchema.default("normal"),
    /**
     * Which mailbox sends it. Absent: a reply goes from the mailbox it
     * arrived in, a Virtara-tagged email from the Virtara mailbox when it is
     * linked, and everything else from Gmail.
     */
    from: MailAccountIdSchema.optional(),
    /** Set when answering a thread from the Inbox: threads the reply in Gmail. */
    replyToThreadId: z.string().min(1).max(200).optional(),
    attachments: z.array(MailAttachmentSchema).max(MAIL_ATTACHMENT_MAX_COUNT).default([]),
  })
  .refine((value) => value.to.length + value.cc.length + value.bcc.length > 0, {
    message: "Add at least one recipient.",
    path: ["to"],
  })
  .refine(
    (value) => value.attachments.reduce((total, file) => total + base64ByteLength(file.data), 0) <= MAIL_ATTACHMENT_MAX_TOTAL_BYTES,
    { message: "Attachments are limited to 18 MB in total.", path: ["attachments"] },
  );

/** One email written in AgentOS, as remembered locally. Never the body: that stays in Gmail. */
export const MailOutboxItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["sent", "draft"]),
  to: z.array(z.string()),
  subject: z.string(),
  tag: MailSendTagSchema,
  /** The mailbox it was sent or drafted from. Absent on mail written before there was a choice: Gmail. */
  account: MailAccountIdSchema.optional(),
  attachmentCount: z.number().int().nonnegative(),
  threadId: z.string().optional(),
  /** Whether the tag's Gmail label is on the message. Always true for `normal`. */
  labelApplied: z.boolean(),
  /** ISO 8601. */
  createdAt: z.string(),
  sentAt: z.string().optional(),
});

export const MailOutboxSchema = z.object({
  items: z.array(MailOutboxItemSchema),
});

export const MailComposeResultSchema = z.object({
  item: MailOutboxItemSchema,
  /** Set when the email went but the tag's Gmail label could not be applied. */
  warning: z.string().optional(),
});

export const MailReplyContextSchema = z.object({
  to: z.string(),
  subject: z.string(),
});

export const MailPolishRequestSchema = z.object({
  subject: z.string().max(400).optional(),
  body: z.string().trim().min(1, "Write something to polish first.").max(MAIL_MAX_BODY_CHARS),
});

export const MailPolishResultSchema = z.object({
  subject: z.string().optional(),
  body: z.string(),
});

export type MailSendTag = z.infer<typeof MailSendTagSchema>;
export type MailAttachment = z.infer<typeof MailAttachmentSchema>;
export type MailComposeRequest = z.input<typeof MailComposeRequestSchema>;
export type MailComposeInput = z.output<typeof MailComposeRequestSchema>;
export type MailOutboxItem = z.infer<typeof MailOutboxItemSchema>;
export type MailOutbox = z.infer<typeof MailOutboxSchema>;
export type MailComposeResult = z.infer<typeof MailComposeResultSchema>;
export type MailReplyContext = z.infer<typeof MailReplyContextSchema>;
export type MailPolishRequest = z.infer<typeof MailPolishRequestSchema>;
export type MailPolishResult = z.infer<typeof MailPolishResultSchema>;
