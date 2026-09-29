import { z } from "zod";

/**
 * Outreach: writing to prospects from a separate mailbox.
 *
 * The outreach mailbox is a second Gmail account, connected on its own with
 * its own token, and kept apart from the inbox AgentOS reads. Nothing here
 * ever touches the main inbox. Every email is reviewed and sent by a person,
 * one at a time; AgentOS never chooses a recipient (it is always the
 * prospect's stored address) and never sends on a timer.
 */

/** One email per address per this many days, from AgentOS. */
export const REPEAT_WINDOW_DAYS = 14;
/** Default and ceiling for emails sent in any rolling 24 hours. */
export const DEFAULT_DAILY_CAP = 10;
export const MAX_DAILY_CAP = 50;

/** One line, no control characters: a subject is a header, and a newline in a header is an injection. */
const Subject = z
  .string()
  .trim()
  .min(1)
  .max(150)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001F\u007F]+$/, "One line only");

/** A cold email is a few short paragraphs. Anything longer is not one. */
export const MAX_EMAIL_BODY = 6000;

export const EmailContentSchema = z
  .object({
    subject: Subject,
    body: z.string().trim().min(1).max(MAX_EMAIL_BODY),
  })
  .strict();

export const OutreachSettingsInputSchema = z
  .object({
    /**
     * Who you are and how to opt out, added to the foot of every email:
     *
     *   Dylan Smith, Virtara (virtara.co.za)
     *   Not for you? Reply "no thanks" and I will not email you again.
     */
    signature: z.string().trim().max(600),
  })
  .strict();

export const OutreachStatusSchema = z.object({
  /** Google credentials exist, so a mailbox can be connected at all. */
  configured: z.boolean(),
  connected: z.boolean(),
  /** The connected mailbox, as Google reports it. */
  address: z.string().optional(),
  signature: z.string(),
  /** Emails sent in the last 24 hours, against the cap. */
  sentToday: z.number().int().default(0),
  dailyCap: z.number().int().default(DEFAULT_DAILY_CAP),
});

export type EmailContent = z.infer<typeof EmailContentSchema>;
export type OutreachSettingsInput = z.infer<typeof OutreachSettingsInputSchema>;
export type OutreachStatus = z.infer<typeof OutreachStatusSchema>;

/** What was done with the outreach mailbox, kept as a log against the prospect. */
export const OutreachLogEntrySchema = z.object({
  id: z.string(),
  prospectId: z.string(),
  /**
   * `draft`: created in Gmail for a person to send.
   * `sending`: reserved just before Gmail is called; stays if the process died mid-send.
   * `sent`: Gmail accepted it.
   * `unconfirmed`: the connection dropped mid-send, so it may have gone. Counts as sent.
   */
  kind: z.enum(["draft", "sending", "sent", "unconfirmed"]),
  to: z.string(),
  subject: z.string(),
  gmailDraftId: z.string().optional(),
  gmailMessageId: z.string().optional(),
  threadId: z.string().optional(),
  at: z.string(),
});

export type OutreachLogEntry = z.infer<typeof OutreachLogEntrySchema>;

/** The most log entries kept. Old ones are dropped, oldest first. */
export const OUTREACH_LOG_LIMIT = 500;

/** Entries that count against the daily cap and the repeat rule. */
export const SEND_KINDS: readonly OutreachLogEntry["kind"][] = [
  "sending",
  "sent",
  "unconfirmed",
];

/** Why an address must never be emailed from here. */
export const SuppressionReasonSchema = z.enum([
  "unsubscribed",
  "bounced",
  "stop",
  "manual",
]);

export const SuppressionSchema = z.object({
  /** Lower-case, as compared. */
  address: z.string(),
  reason: SuppressionReasonSchema,
  at: z.string(),
});

export const SuppressionInputSchema = z
  .object({
    address: z.string().trim().min(3).max(254),
    reason: SuppressionReasonSchema.default("manual"),
  })
  .strict();

/** The confirmation that a person looked at the preview. Recipient is never in it. */
export const SendRequestSchema = EmailContentSchema.extend({
  confirm: z.literal(true),
}).strict();

export type Suppression = z.infer<typeof SuppressionSchema>;
export type SuppressionReason = z.infer<typeof SuppressionReasonSchema>;
