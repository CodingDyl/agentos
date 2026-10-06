import { z } from "zod";

/**
 * The mailboxes the Inbox reads. Gmail through Google's API; the Virtara
 * business mailbox (Titan) over IMAP. One merged Inbox, each thread knowing
 * which account it came from.
 */
export const MailAccountIdSchema = z.enum(["gmail", "titan"]);
export type MailAccountId = z.infer<typeof MailAccountIdSchema>;

export const MAIL_ACCOUNT_LABEL: Record<MailAccountId, string> = {
  gmail: "Gmail",
  titan: "Virtara",
};

/** Titan's published servers. Both are TLS from the first byte; nothing is ever sent in the clear. */
export const TITAN_DEFAULTS = {
  imapHost: "imap.titan.email",
  imapPort: 993,
  smtpHost: "smtp.titan.email",
  smtpPort: 465,
} as const;

const TITAN_PREFIX = "titan:";

/**
 * IMAP has no Gmail-style thread ids, so each Titan message is one Inbox row,
 * named by its mailbox's UIDVALIDITY and its UID. The prefix keeps it from
 * ever colliding with a Gmail thread id, and says where to send any action.
 */
export function titanThreadId(uidValidity: string, uid: number): string {
  return `${TITAN_PREFIX}${uidValidity}:${uid}`;
}

export function parseTitanThreadId(threadId: string): { uidValidity: string; uid: number } | undefined {
  const match = /^titan:(\d{1,20}):(\d{1,10})$/.exec(threadId);
  if (!match) return undefined;
  return { uidValidity: match[1], uid: Number(match[2]) };
}

export function mailAccountOf(threadId: string): MailAccountId {
  return threadId.startsWith(TITAN_PREFIX) ? "titan" : "gmail";
}

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** The name recipients see next to the address. One line, no angle brackets, so it can't change the From address. */
export const SenderNameSchema = z
  .string()
  .trim()
  .max(100, "Keep the sender name under 100 characters.")
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[\u0000-\u001F\u007F<>]/.test(value), "The sender name can't contain line breaks or angle brackets.");

/** What the person types to link the mailbox. The password is never sent back by any route. */
export const TitanConnectRequestSchema = z.object({
  address: z.string().trim().toLowerCase().email("Enter the full mailbox address."),
  password: z.string().min(1, "Enter the mailbox password.").max(512),
  senderName: SenderNameSchema.optional(),
  imapHost: z.string().trim().regex(HOST, "That is not a server name.").default(TITAN_DEFAULTS.imapHost),
  imapPort: z.number().int().min(1).max(65535).default(TITAN_DEFAULTS.imapPort),
  smtpHost: z.string().trim().regex(HOST, "That is not a server name.").default(TITAN_DEFAULTS.smtpHost),
  smtpPort: z.number().int().min(1).max(65535).default(TITAN_DEFAULTS.smtpPort),
});
export type TitanConnectRequest = z.infer<typeof TitanConnectRequestSchema>;

/** Changes to a linked mailbox that need no new login. An empty name clears it. */
export const TitanUpdateRequestSchema = z.object({ senderName: SenderNameSchema });

/** One linked account as the page sees it: never a password. */
export const MailAccountSummarySchema = z.object({
  id: MailAccountIdSchema,
  label: z.string(),
  connected: z.boolean(),
  address: z.string().optional(),
  server: z.string().optional(),
  senderName: z.string().optional(),
});
export type MailAccountSummary = z.infer<typeof MailAccountSummarySchema>;
