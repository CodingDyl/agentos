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
});

export type EmailContent = z.infer<typeof EmailContentSchema>;
export type OutreachSettingsInput = z.infer<typeof OutreachSettingsInputSchema>;
export type OutreachStatus = z.infer<typeof OutreachStatusSchema>;

/** What was done with the outreach mailbox, kept as a log against the prospect. */
export const OutreachLogEntrySchema = z.object({
  id: z.string(),
  prospectId: z.string(),
  /** `draft`: created in Gmail for a person to send. */
  kind: z.enum(["draft"]),
  to: z.string(),
  subject: z.string(),
  gmailDraftId: z.string().optional(),
  at: z.string(),
});

export type OutreachLogEntry = z.infer<typeof OutreachLogEntrySchema>;

/** The most log entries kept. Old ones are dropped, oldest first. */
export const OUTREACH_LOG_LIMIT = 500;
