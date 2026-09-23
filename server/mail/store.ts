import type { MailCategory, MailData, MailThread } from "../../shared/mail-types";
import { buildMailBuckets } from "./bucketing";
import { mailDatabase } from "./db";

/** What Gmail gave us for a thread — the input to `insertThreadIfNew`. */
export interface ThreadSummaryInput {
  threadId: string;
  fromName?: string;
  fromEmail?: string;
  subject: string;
  snippet: string;
  /** ISO 8601. */
  messageDate: string;
}

/** What Jev returned for one thread — the input to `storeClassification`. */
export interface ClassificationInput {
  category: MailCategory;
  needsReply: number;
  urgency: number;
  business: string;
  financial: number;
  actionRequired: number;
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
  };
}

const INSERT_SUMMARY = `
  INSERT OR IGNORE INTO mail_threads (
    thread_id, from_name, from_email, subject, snippet, message_date, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
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
    );
}

/** Every thread id already cached, for diffing against Gmail's list. */
export function existingThreadIds(): Set<string> {
  const rows = mailDatabase()
    .prepare("SELECT thread_id FROM mail_threads")
    .all() as unknown as { thread_id: string }[];

  return new Set(rows.map((row) => row.thread_id));
}

/** Threads with no successful Jev classification yet — new, or previously failed. */
export function listUnclassifiedThreadIds(): string[] {
  const rows = mailDatabase()
    .prepare("SELECT thread_id FROM mail_threads WHERE classified = 0")
    .all() as unknown as { thread_id: string }[];

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
      financial = ?, action_required = ?, classified_at = ?
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
      new Date().toISOString(),
      threadId,
    );
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

/** The bucketed view the Mail page reads. Never a live Gmail or Jev call. */
export function readMailData(): MailData {
  const rows = mailDatabase()
    .prepare("SELECT * FROM mail_threads ORDER BY message_date DESC")
    .all() as unknown as MailThreadRow[];

  const threads = rows.map(toMailThread);
  const { needsYou, fyi, lowPriority } = buildMailBuckets(threads);

  return {
    generatedAt: new Date().toISOString(),
    needsYou,
    fyi,
    lowPriority,
  };
}
