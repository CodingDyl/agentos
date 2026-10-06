import {
  MAIL_THREAD_LIMIT,
  mailCutoff,
  type MailBucket,
  type MailCategory,
  type MailCorrection,
  type MailData,
  type MailThread,
} from "../../shared/mail-types";
import { mailAccountOf, type MailAccountId } from "../../shared/mail-account-types";
import { bucketFor, buildMailBuckets } from "./bucketing";
import { mailDatabase } from "./db";

/**
 * Where the store reads "now" from for the Inbox's one-month window.
 * Real time in the app; tests pin it, so fixtures with fixed dates don't
 * fall out of the window as the calendar moves on.
 */
export const mailClock = { now: (): Date => new Date() };

/**
 * The Inbox's window as SQL: visible threads from the last month, at most
 * `MAIL_THREAD_LIMIT` per account, so a busy Gmail never pushes the Virtara
 * mailbox out of view. Takes (cutoff, limit) as its two parameters.
 */
const WINDOW = `
  SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY account ORDER BY message_date DESC) AS account_rank
    FROM mail_threads WHERE removed = 0 AND message_date >= ?
  ) WHERE account_rank <= ?`;

/** What Gmail gave us for a thread — the input to `insertThreadIfNew`. */
export interface ThreadSummaryInput {
  threadId: string;
  fromName?: string;
  fromEmail?: string;
  subject: string;
  snippet: string;
  /** ISO 8601. */
  messageDate: string;
  /** Gmail's UNREAD label at fetch time. Absent is treated as read. */
  unread?: boolean;
}

/** What Jev returned for one thread — the input to `storeClassification`. */
export interface ClassificationInput {
  category: MailCategory;
  needsReply: number;
  urgency: number;
  business: string;
  financial: number;
  actionRequired: number;
  automated: number;
}

function text(value: string | null): string | undefined {
  return value ?? undefined;
}

function num(value: number | null): number | undefined {
  return value === null ? undefined : value;
}

interface MailThreadRow {
  thread_id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string;
  snippet: string;
  message_date: string;
  synced_at: string;
  classified: number;
  category: string | null;
  needs_reply: number | null;
  urgency: number | null;
  business: string | null;
  financial: number | null;
  action_required: number | null;
  classified_at: string | null;
  removed: number;
  unread: number;
  automated: number | null;
  user_bucket: string | null;
  user_category: string | null;
  corrected_at: string | null;
  low_priority_since: string | null;
  account: string;
}

function toMailThread(row: MailThreadRow): MailThread {
  return {
    threadId: row.thread_id,
    fromName: text(row.from_name),
    fromEmail: text(row.from_email),
    subject: row.subject,
    snippet: row.snippet,
    messageDate: row.message_date,
    classified: row.classified === 1,
    category: text(row.category) as MailCategory | undefined,
    needsReply: num(row.needs_reply),
    urgency: num(row.urgency),
    business: text(row.business),
    financial: num(row.financial),
    actionRequired: num(row.action_required),
    automated: num(row.automated),
    unread: row.unread === 1,
    userBucket: text(row.user_bucket) as MailBucket | undefined,
    userCategory: text(row.user_category) as MailCategory | undefined,
    lowPrioritySince: text(row.low_priority_since),
    account: row.account === "titan" ? "titan" : "gmail",
  };
}

const INSERT_SUMMARY = `
  INSERT OR IGNORE INTO mail_threads (
    thread_id, from_name, from_email, subject, snippet, message_date, synced_at, unread, account
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Stores a thread's Gmail summary, if it is not already known.
 *
 * `INSERT OR IGNORE` rather than upsert: once a thread is cached, only
 * `storeClassification` may change it. A summary is never overwritten by a
 * later sync, so a classification in progress can never be raced by a
 * refreshed subject line.
 */
export function insertThreadIfNew(summary: ThreadSummaryInput): void {
  mailDatabase()
    .prepare(INSERT_SUMMARY)
    .run(
      summary.threadId,
      summary.fromName ?? null,
      summary.fromEmail ?? null,
      summary.subject,
      summary.snippet,
      summary.messageDate,
      new Date().toISOString(),
      summary.unread ? 1 : 0,
      mailAccountOf(summary.threadId),
    );
}

/** Every thread id already cached, for diffing against Gmail's list. */
export function existingThreadIds(): Set<string> {
  const rows = mailDatabase()
    .prepare("SELECT thread_id FROM mail_threads")
    .all() as unknown as { thread_id: string }[];

  return new Set(rows.map((row) => row.thread_id));
}

/**
 * Threads with no successful Jev classification yet — new, or previously
 * failed — among the `MAIL_THREAD_LIMIT` most recent visible threads. The
 * same window the Mail page shows, so Jev never profiles a thread nobody can
 * see. Removed threads are never (re)classified.
 */
export function listUnclassifiedThreadIds(): string[] {
  const rows = mailDatabase()
    .prepare(
      `SELECT thread_id FROM (${WINDOW}) WHERE classified = 0 ORDER BY message_date DESC`,
    )
    .all(mailCutoff(mailClock.now()), MAIL_THREAD_LIMIT) as unknown as { thread_id: string }[];

  return rows.map((row) => row.thread_id);
}

/** One thread's cached summary — what Jev needs in order to classify it. */
export function readThreadSummary(threadId: string): ThreadSummaryInput | undefined {
  const rows = mailDatabase()
    .prepare(
      "SELECT thread_id, from_name, from_email, subject, snippet, message_date FROM mail_threads WHERE thread_id = ?",
    )
    .all(threadId) as unknown as {
    thread_id: string;
    from_name: string | null;
    from_email: string | null;
    subject: string;
    snippet: string;
    message_date: string;
  }[];

  const row = rows[0];
  if (!row) return undefined;

  return {
    threadId: row.thread_id,
    fromName: text(row.from_name),
    fromEmail: text(row.from_email),
    subject: row.subject,
    snippet: row.snippet,
    messageDate: row.message_date,
  };
}

const UPDATE_CLASSIFICATION = `
  UPDATE mail_threads
  SET classified = 1, category = ?, needs_reply = ?, urgency = ?, business = ?,
      financial = ?, action_required = ?, automated = ?, classified_at = ?
  WHERE thread_id = ?
`;

export function storeClassification(threadId: string, result: ClassificationInput): void {
  mailDatabase()
    .prepare(UPDATE_CLASSIFICATION)
    .run(
      result.category,
      result.needsReply,
      result.urgency,
      result.business,
      result.financial,
      result.actionRequired,
      result.automated,
      new Date().toISOString(),
      threadId,
    );
}

/**
 * Removes a thread from the Mail view.
 *
 * Local only, and permanent for that thread: Gmail access is read-only, so
 * the underlying message is never touched. The row stays in the table
 * (not deleted) so the next sync's diff against Gmail's thread list still
 * recognizes it as known and never re-adds it.
 */
export function removeThread(threadId: string): void {
  mailDatabase().prepare("UPDATE mail_threads SET removed = 1 WHERE thread_id = ?").run(threadId);
}

/**
 * Records a person's correction of Jev. Only the fields given change; the
 * rest of the correction (and Jev's own answers) stay as they were, so
 * fixing the category never silently resets a status fixed earlier.
 */
export function storeCorrection(threadId: string, correction: MailCorrection): void {
  mailDatabase()
    .prepare(
      `UPDATE mail_threads
       SET user_bucket = COALESCE(?, user_bucket),
           user_category = COALESCE(?, user_category),
           corrected_at = ?
       WHERE thread_id = ?`,
    )
    .run(correction.bucket ?? null, correction.category ?? null, new Date().toISOString(), threadId);
}

/** Drops a thread's correction, handing it back to Jev's own judgment. */
export function clearCorrection(threadId: string): void {
  mailDatabase()
    .prepare(
      "UPDATE mail_threads SET user_bucket = NULL, user_category = NULL, corrected_at = NULL WHERE thread_id = ?",
    )
    .run(threadId);
}

/** One earlier thread the person re-sorted by hand — a worked example for Jev. */
export interface MailCorrectionExample {
  fromEmail?: string;
  fromName?: string;
  subject: string;
  snippet: string;
  bucket?: MailBucket;
  category?: MailCategory;
}

/**
 * The corrections most relevant to a thread from `fromEmail`: same sender
 * first, then same domain, then the most recent of the rest. Removed threads
 * still count — a correction is what the person meant, whether or not the
 * thread is still on screen.
 */
export function listCorrectionExamples(
  fromEmail: string | undefined,
  limit: number,
  excludeThreadId?: string,
): MailCorrectionExample[] {
  const domain = fromEmail?.includes("@") ? fromEmail.slice(fromEmail.indexOf("@")) : undefined;

  const rows = mailDatabase()
    .prepare(
      `SELECT from_email, from_name, subject, snippet, user_bucket, user_category
       FROM mail_threads
       WHERE corrected_at IS NOT NULL AND thread_id != ?
       ORDER BY
         CASE
           WHEN ? IS NOT NULL AND lower(from_email) = lower(?) THEN 0
           WHEN ? IS NOT NULL AND lower(from_email) LIKE '%' || lower(?) THEN 1
           ELSE 2
         END,
         corrected_at DESC
       LIMIT ?`,
    )
    .all(excludeThreadId ?? "", fromEmail ?? null, fromEmail ?? null, domain ?? null, domain ?? null, limit) as unknown as {
    from_email: string | null;
    from_name: string | null;
    subject: string;
    snippet: string;
    user_bucket: string | null;
    user_category: string | null;
  }[];

  return rows.map((row) => ({
    fromEmail: text(row.from_email),
    fromName: text(row.from_name),
    subject: row.subject,
    snippet: row.snippet,
    bucket: text(row.user_bucket) as MailBucket | undefined,
    category: text(row.user_category) as MailCategory | undefined,
  }));
}

export function setUnread(threadIds: readonly string[], unread: boolean): void {
  const statement = mailDatabase().prepare("UPDATE mail_threads SET unread = ? WHERE thread_id = ?");
  for (const threadId of threadIds) statement.run(unread ? 1 : 0, threadId);
}

/**
 * Mirrors Gmail's read state onto the cached window: every thread in
 * `windowIds` is unread exactly when it is in `unreadIds`. Read or unread in
 * Gmail's own app is picked up on the next Refresh.
 */
export function syncUnreadState(windowIds: readonly string[], unreadIds: ReadonlySet<string>): void {
  const statement = mailDatabase().prepare("UPDATE mail_threads SET unread = ? WHERE thread_id = ?");
  for (const threadId of windowIds) statement.run(unreadIds.has(threadId) ? 1 : 0, threadId);
}

/** The subset of `threadIds` that are cached and still visible — bulk actions touch nothing else. */
export function visibleThreadIds(threadIds: readonly string[]): string[] {
  const statement = mailDatabase().prepare("SELECT 1 FROM mail_threads WHERE thread_id = ? AND removed = 0");
  return threadIds.filter((threadId) => statement.all(threadId).length > 0);
}

function visibleThreads(): MailThread[] {
  const rows = mailDatabase()
    .prepare(`${WINDOW} ORDER BY message_date DESC`)
    .all(mailCutoff(mailClock.now()), MAIL_THREAD_LIMIT) as unknown as MailThreadRow[];
  return rows.map(toMailThread);
}

/**
 * Starts the Low priority clock for threads that just landed there and stops
 * it for threads that left — by a correction, or Jev changing its mind.
 * Buckets are computed, not stored, so this runs after anything that can
 * move a thread and before the clean-up reads the clock.
 */
export function refreshLowPriorityClock(now: Date = new Date()): void {
  const start = mailDatabase().prepare(
    "UPDATE mail_threads SET low_priority_since = ? WHERE thread_id = ? AND low_priority_since IS NULL",
  );
  const stop = mailDatabase().prepare("UPDATE mail_threads SET low_priority_since = NULL WHERE thread_id = ?");

  for (const thread of visibleThreads()) {
    const low = bucketFor(thread) === "low_priority";
    if (low && !thread.lowPrioritySince) start.run(now.toISOString(), thread.threadId);
    else if (!low && thread.lowPrioritySince) stop.run(thread.threadId);
  }
}

/** Visible threads that have sat in Low priority since before `cutoff`. */
export function lowPriorityExpiredBefore(cutoff: Date): string[] {
  const rows = mailDatabase()
    .prepare(
      "SELECT thread_id FROM mail_threads WHERE removed = 0 AND low_priority_since IS NOT NULL AND low_priority_since <= ?",
    )
    .all(cutoff.toISOString()) as unknown as { thread_id: string }[];
  return rows.map((row) => row.thread_id);
}

/** Every cached thread of one account, for diffing that account's server list. */
export function existingThreadIdsFor(account: MailAccountId): Set<string> {
  const rows = mailDatabase()
    .prepare("SELECT thread_id FROM mail_threads WHERE account = ?")
    .all(account) as unknown as { thread_id: string }[];
  return new Set(rows.map((row) => row.thread_id));
}

export function threadCount(): number {
  const rows = mailDatabase()
    .prepare("SELECT COUNT(*) as count FROM mail_threads")
    .all() as unknown as { count: number }[];

  return rows[0]?.count ?? 0;
}

export function lastSyncedAt(): string | undefined {
  const rows = mailDatabase()
    .prepare("SELECT MAX(synced_at) as latest FROM mail_threads")
    .all() as unknown as { latest: string | null }[];

  return rows[0]?.latest ?? undefined;
}

/**
 * The bucketed view the Mail page reads — the `MAIL_THREAD_LIMIT` most recent
 * visible threads. Never a live Gmail or Jev call. Removed threads are excluded.
 *
 * Refreshes the Low priority clock first: buckets are computed rather than
 * stored, so this is the one place guaranteed to see every change (a
 * correction, a re-profile) before the page shows its countdown.
 */
export function readMailData(): MailData {
  refreshLowPriorityClock();
  const rows = mailDatabase()
    .prepare(`${WINDOW} ORDER BY message_date DESC`)
    .all(mailCutoff(mailClock.now()), MAIL_THREAD_LIMIT) as unknown as MailThreadRow[];

  const threads = rows.map(toMailThread);
  const { needsYou, fyi, lowPriority } = buildMailBuckets(threads);

  return {
    generatedAt: new Date().toISOString(),
    needsYou,
    fyi,
    lowPriority,
  };
}
