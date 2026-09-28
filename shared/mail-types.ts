import { z } from "zod";

/**
 * The vocabulary Jev classifies every thread into.
 *
 * Fixed and small on purpose — Jev's `category` question is a `choice`
 * question, and a choice question needs a closed set of options to choose
 * between.
 */
export const MailCategorySchema = z.enum([
  "client",
  "sales",
  "finance",
  "admin",
  "notification",
  "newsletter",
  "personal",
  "spam",
]);

/**
 * One cached Gmail thread, with whatever Jev has made of it so far.
 *
 * `classified` is false until Jev succeeds. A thread is never dropped just
 * because its classification call failed or hasn't run yet — the next sync
 * retries it, and until then it is shown, not hidden.
 */
export const MailThreadSchema = z.object({
  threadId: z.string(),
  fromName: z.string().optional(),
  fromEmail: z.string().optional(),
  subject: z.string(),
  snippet: z.string(),
  /** ISO 8601. */
  messageDate: z.string(),
  classified: z.boolean(),
  category: MailCategorySchema.optional(),
  /** 0..1 probability that this thread needs a reply. */
  needsReply: z.number().min(0).max(1).optional(),
  /** 0..4, continuous — Jev's score against a 5-point urgency rubric. */
  urgency: z.number().min(0).max(4).optional(),
  /** A live AgentOS project name, or `"none"`. */
  business: z.string().optional(),
  /** 0..1 probability that this thread involves money. */
  financial: z.number().min(0).max(1).optional(),
  /** 0..1 probability that this thread needs an action beyond a reply. */
  actionRequired: z.number().min(0).max(1).optional(),
});

/**
 * The Mail page's whole read, pre-bucketed and pre-sorted server-side — the
 * client never re-derives which bucket a thread belongs in.
 */
export const MailDataSchema = z.object({
  generatedAt: z.string(),
  needsYou: z.array(MailThreadSchema),
  fyi: z.array(MailThreadSchema),
  lowPriority: z.array(MailThreadSchema),
});

/** Whether Mail is usable at all, established without contacting Gmail or Jev. */
/**
 * Who sorts the inbox into Needs you / FYI / Low priority.
 *
 * `manual` is a real mode, not an error: Gmail connected with no classifier
 * still lists every thread, unsorted, under FYI. Jev is one provider among the
 * ones this enum will grow to hold — the Inbox never requires it.
 */
export const MailClassifierSchema = z.enum(["manual", "jev"]);

export const MailStatusSchema = z.object({
  configured: z.boolean(),
  classifier: MailClassifierSchema.default("manual"),
  connected: z.boolean(),
  lastSyncedAt: z.string().optional(),
  threadCount: z.number().int().nonnegative(),
});

export const MailSyncResultSchema = z.object({
  added: z.number().int().nonnegative(),
  classified: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const MailThreadBodySchema = z.object({
  body: z.string(),
});

export type MailCategory = z.infer<typeof MailCategorySchema>;
export type MailThread = z.infer<typeof MailThreadSchema>;
export type MailData = z.infer<typeof MailDataSchema>;
export type MailClassifier = z.infer<typeof MailClassifierSchema>;
export type MailStatus = z.infer<typeof MailStatusSchema>;
export type MailSyncResult = z.infer<typeof MailSyncResultSchema>;
