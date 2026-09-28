import { z } from "zod";

/**
 * The Inbox's window: only this many of the most recent INBOX threads are
 * fetched from Gmail, classified by Jev, and shown. Anything older stays in
 * Gmail and is never read.
 */
export const MAIL_THREAD_LIMIT = 150;

/**
 * How long a thread may sit in Low priority before it is moved to Gmail's
 * Trash. Counted from when it *became* Low priority, so every thread gets
 * the full window to be rescued — a correction out of Low priority stops the clock.
 */
export const LOW_PRIORITY_TTL_HOURS = 24;

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

/** The three statuses the Inbox sorts into. */
export const MailBucketSchema = z.enum(["needs_you", "fyi", "low_priority"]);

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
  /** 0..1 probability that this thread was sent by a system rather than a person. */
  automated: z.number().min(0).max(1).optional(),
  /** Gmail's UNREAD label, as of the last sync or the last action taken here. */
  unread: z.boolean().default(false),
  /** Set when the person corrected Jev — always wins over Jev's own answers. */
  userBucket: MailBucketSchema.optional(),
  userCategory: MailCategorySchema.optional(),
  /** ISO 8601 — when this thread entered Low priority. Absent while it's anywhere else. */
  lowPrioritySince: z.string().optional(),
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
  /**
   * Whether the stored Gmail grant allows marking read and moving to Trash.
   * False for a connection made before that access was requested — the
   * person reconnects once to upgrade it.
   */
  canModify: z.boolean().default(false),
  lastSyncedAt: z.string().optional(),
  threadCount: z.number().int().nonnegative(),
});

export const MailSyncResultSchema = z.object({
  added: z.number().int().nonnegative(),
  classified: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

/** A person's correction of Jev's profile for one thread. Omitted fields are left as they are. */
export const MailCorrectionSchema = z.object({
  bucket: MailBucketSchema.optional(),
  category: MailCategorySchema.optional(),
});

export const MailBulkActionSchema = z.enum(["mark_read", "archive", "trash", "reprofile"]);

export const MailBulkRequestSchema = z.object({
  action: MailBulkActionSchema,
  threadIds: z.array(z.string().min(1)).min(1).max(MAIL_THREAD_LIMIT),
});

export const MailBulkResultSchema = z.object({
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const MailProgressKindSchema = z.enum(["sync", "reprofile"]);
/** `fetching` is reading new threads from Gmail; `profiling` is Jev sorting them. */
export const MailProgressPhaseSchema = z.enum(["fetching", "profiling"]);

/** How far the current Refresh or "Ask Jev again" has got. `running: false` when nothing is. */
export const MailProgressSchema = z.object({
  running: z.boolean(),
  kind: MailProgressKindSchema.optional(),
  phase: MailProgressPhaseSchema.optional(),
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  startedAt: z.string().optional(),
});

export const MailThreadBodySchema = z.object({
  body: z.string(),
});

export type MailCategory = z.infer<typeof MailCategorySchema>;
export type MailBucket = z.infer<typeof MailBucketSchema>;
export type MailCorrection = z.infer<typeof MailCorrectionSchema>;
export type MailBulkAction = z.infer<typeof MailBulkActionSchema>;
export type MailBulkRequest = z.infer<typeof MailBulkRequestSchema>;
export type MailBulkResult = z.infer<typeof MailBulkResultSchema>;
export type MailProgressKind = z.infer<typeof MailProgressKindSchema>;
export type MailProgressPhase = z.infer<typeof MailProgressPhaseSchema>;
export type MailProgress = z.infer<typeof MailProgressSchema>;
export type MailThread = z.infer<typeof MailThreadSchema>;
export type MailData = z.infer<typeof MailDataSchema>;
export type MailClassifier = z.infer<typeof MailClassifierSchema>;
export type MailStatus = z.infer<typeof MailStatusSchema>;
export type MailSyncResult = z.infer<typeof MailSyncResultSchema>;
