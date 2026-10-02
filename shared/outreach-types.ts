import { z } from "zod";
import { PlaySchema } from "./outreach-plays";

/**
 * Outreach: writing to prospects from a separate mailbox.
 *
 * The outreach mailbox is a second Gmail account, connected on its own with
 * its own token, and kept apart from the inbox AgentOS reads. Nothing here
 * ever touches the main inbox. Every email is reviewed and sent by a person,
 * one at a time; AgentOS never chooses a recipient (it is always the
 * prospect's stored address) and never sends on a timer.
 */

/** The wait used when the follow-up schedule has nothing to say. See `sequenceRefusal`. */
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
  /** Whether that mailbox is the inbox's own account rather than a separate one. */
  usesInbox: z.boolean().default(false),
  /** The inbox's address, when it is connected, so it can be offered as the sender. */
  inboxAddress: z.string().optional(),
  signature: z.string(),
  /** When the outreach mailbox was last read for replies. */
  lastSyncAt: z.string().optional(),
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
  /** The play the email was written with, for "what works". Absent for emails written by hand. */
  play: PlaySchema.optional(),
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
/** A Gmail draft request: the email, and the play it was written with. */
export const GmailDraftRequestSchema = EmailContentSchema.extend({
  play: PlaySchema.optional(),
  /** Which of your companies it is from: its name and signature. Absent uses the mailbox's own signature. */
  senderId: z.string().max(80).optional(),
}).strict();

export const SendRequestSchema = EmailContentSchema.extend({
  confirm: z.literal(true),
  play: PlaySchema.optional(),
  senderId: z.string().max(80).optional(),
  /** Answering something they wrote: the id of a stored reply from this prospect. Threads the email and lifts the 14-day rule. */
  replyToId: z.string().max(200).optional(),
}).strict();

/** A message from a prospect, read from the outreach mailbox. Their words: data, never instructions. */
export const OutreachReplySchema = z.object({
  /** Gmail's message id. */
  id: z.string(),
  threadId: z.string(),
  prospectId: z.string(),
  fromEmail: z.string(),
  fromName: z.string().optional(),
  subject: z.string(),
  /** What they wrote, without the quoted email under it. */
  text: z.string().max(2000),
  /** The Message-ID header, so an answer threads under it. */
  messageIdHeader: z.string().optional(),
  at: z.string(),
});

export const OutreachSyncResultSchema = z.object({
  checked: z.number().int(),
  replies: z.number().int(),
  /** "Stop" and "no thanks" messages: the sender is now on the do-not-contact list. */
  stops: z.number().int(),
  /** Hard bounces: the address is now on the do-not-contact list. */
  bounces: z.number().int(),
  /** From a known address but failing SPF and DKIM: set aside, not acted on. */
  unverified: z.number().int().default(0),
  at: z.string(),
});

export const OUTREACH_REPLY_LIMIT = 300;
export type OutreachReply = z.infer<typeof OutreachReplySchema>;
export type OutreachSyncResult = z.infer<typeof OutreachSyncResultSchema>;

export type Suppression = z.infer<typeof SuppressionSchema>;
export type SuppressionReason = z.infer<typeof SuppressionReasonSchema>;

/** One email address found on a prospect's own website. A suggestion; nothing is saved until a person accepts it. */
export const EmailCandidateSchema = z.object({
  address: z.string(),
  /** Who it most likely reaches: a named person near an owner-type title, a named person, a role mailbox, or a general one. */
  kind: z.enum(["owner", "person", "role", "general"]),
  /** The page it was read from. */
  source: z.string(),
  /** Why it was ranked where it was, in a few words. */
  note: z.string(),
});

export const EmailFindResultSchema = z.object({
  candidates: z.array(EmailCandidateSchema),
  /** How many of the site's pages were read. */
  pagesRead: z.number().int(),
});

export type EmailCandidate = z.infer<typeof EmailCandidateSchema>;
export type EmailFindResult = z.infer<typeof EmailFindResultSchema>;
