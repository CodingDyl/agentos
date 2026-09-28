import {
  LOW_PRIORITY_TTL_HOURS,
  type MailBucket,
  type MailCategory,
  type MailData,
  type MailThread,
} from "@shared/mail-types";

/** The sender line shown in a row — the display name when Gmail gave one, else the address. */
export function threadSender(thread: MailThread): string {
  return thread.fromName ?? thread.fromEmail ?? "Unknown sender";
}

/** A single-letter avatar glyph. */
export function threadInitial(thread: MailThread): string {
  const source = threadSender(thread);
  return source.trim().charAt(0).toUpperCase() || "?";
}

export type MailTagTone = "client" | "finance" | "reply" | "noreply" | "muted" | "yours";

export interface MailTag {
  label: string;
  tone: MailTagTone;
}

export const CATEGORY_LABEL: Record<MailCategory, string> = {
  client: "CLIENT",
  sales: "SALES",
  finance: "FINANCE",
  admin: "ADMIN",
  notification: "NOTIFICATION",
  newsletter: "NEWSLETTER",
  personal: "PERSONAL",
  spam: "SPAM",
};

const CATEGORY_TONE: Record<MailCategory, MailTagTone> = {
  client: "client",
  sales: "client",
  finance: "finance",
  admin: "finance",
  notification: "muted",
  newsletter: "muted",
  personal: "muted",
  spam: "muted",
};

const REPLY_THRESHOLD = 0.5;

/** The category on screen — the person's correction when there is one, else Jev's. */
export function threadCategory(thread: MailThread): MailCategory | undefined {
  return thread.userCategory ?? thread.category;
}

export function isCorrected(thread: MailThread): boolean {
  return thread.userBucket !== undefined || thread.userCategory !== undefined;
}

/** The small tag row under a thread's snippet — category, then reply status, then whether you set it. */
export function threadTags(thread: MailThread): MailTag[] {
  const corrected = isCorrected(thread);
  const category = threadCategory(thread);

  if (!thread.classified && !corrected) {
    return [{ label: "NOT YET CLASSIFIED", tone: "muted" }];
  }

  const tags: MailTag[] = [];

  if (category) {
    tags.push({ label: CATEGORY_LABEL[category], tone: CATEGORY_TONE[category] });
  }

  // Jev's reply signal is moot once the person has placed the thread themselves.
  if (thread.userBucket || !thread.classified) {
    if (corrected) tags.push({ label: "SET BY YOU", tone: "yours" });
    return tags;
  }

  // Same rule as the server's bucketing: nobody replies to an automated message.
  const wantsReply = (thread.needsReply ?? 0) >= REPLY_THRESHOLD && (thread.automated ?? 0) < REPLY_THRESHOLD;
  const wantsAction = (thread.actionRequired ?? 0) >= REPLY_THRESHOLD;

  if (wantsReply) {
    tags.push({ label: "REPLY NEEDED", tone: "reply" });
  } else if (wantsAction) {
    tags.push({ label: "ACTION NEEDED", tone: "reply" });
  } else if ((thread.financial ?? 0) >= REPLY_THRESHOLD) {
    tags.push({ label: "NO REPLY", tone: "noreply" });
  }

  if (corrected) tags.push({ label: "SET BY YOU", tone: "yours" });

  return tags;
}

/** Which of Jev's buckets a row is rendered in. */
export type MailBucketTone = "needs" | "fyi" | "low";

export const TONE_BUCKET: Record<MailBucketTone, MailBucket> = {
  needs: "needs_you",
  fyi: "fyi",
  low: "low_priority",
};

/**
 * The statuses the Inbox can be filtered to. The three buckets come straight
 * from Jev's classification (bucketed server-side); `unsorted` is the threads
 * Jev hasn't classified yet, which live inside FYI so they stay visible.
 */
export type MailStatusFilter = "all" | MailBucketTone | "unsorted";

export interface MailRow {
  thread: MailThread;
  tone: MailBucketTone;
}

export interface MailBucketGroup {
  tone: MailBucketTone;
  rows: MailRow[];
}

/** Every thread in display order — Needs you, then FYI, then Low priority — tagged with its bucket. */
export function flattenMail(data: MailData): MailRow[] {
  return [
    ...data.needsYou.map((thread) => ({ thread, tone: "needs" as const })),
    ...data.fyi.map((thread) => ({ thread, tone: "fyi" as const })),
    ...data.lowPriority.map((thread) => ({ thread, tone: "low" as const })),
  ];
}

export function matchesStatus(row: MailRow, filter: MailStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unsorted") return !row.thread.classified;
  return row.tone === filter;
}

/** How many rows each filter would show — for the counts on the filter row. */
export function statusCounts(rows: readonly MailRow[]): Record<MailStatusFilter, number> {
  const counts: Record<MailStatusFilter, number> = { all: 0, needs: 0, fyi: 0, low: 0, unsorted: 0 };
  for (const row of rows) {
    counts.all += 1;
    counts[row.tone] += 1;
    if (!row.thread.classified) counts.unsorted += 1;
  }
  return counts;
}

export interface MailPage {
  groups: MailBucketGroup[];
  /** 1-based, clamped into range. */
  page: number;
  pageCount: number;
  /** 1-based index of the first row shown; 0 when there are none. */
  firstIndex: number;
  lastIndex: number;
  total: number;
}

/**
 * One page of filtered rows, regrouped by bucket so a page that spans the
 * Needs you → FYI boundary still shows both labels. `page` is clamped, so a
 * filter change or a removal that shrinks the list never strands the reader
 * on an empty page.
 */
export function paginateMail(
  rows: readonly MailRow[],
  filter: MailStatusFilter,
  page: number,
  pageSize: number,
): MailPage {
  const filtered = rows.filter((row) => matchesStatus(row, filter));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const start = (current - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const groups: MailBucketGroup[] = [];
  for (const row of slice) {
    const last = groups[groups.length - 1];
    if (last && last.tone === row.tone) last.rows.push(row);
    else groups.push({ tone: row.tone, rows: [row] });
  }

  return {
    groups,
    page: current,
    pageCount,
    firstIndex: total === 0 ? 0 : start + 1,
    lastIndex: start + slice.length,
    total,
  };
}

/** Page numbers to show: always the first, last, and the current page's neighbours, with gaps as `null`. */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);

  const result: (number | null)[] = [];
  for (const value of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && value - previous > 1) result.push(null);
    result.push(value);
  }
  return result;
}

/**
 * How long until a Low priority thread is moved to Gmail's Trash, as a short
 * tag label — or undefined when it isn't on the clock. Rounded up, so the
 * label never claims more time than is left in a way that matters.
 */
export function lowPriorityCountdown(thread: MailThread, now: Date = new Date()): string | undefined {
  if (!thread.lowPrioritySince) return undefined;
  const clearsAt = Date.parse(thread.lowPrioritySince) + LOW_PRIORITY_TTL_HOURS * 60 * 60 * 1000;
  const hoursLeft = (clearsAt - now.getTime()) / (60 * 60 * 1000);
  if (Number.isNaN(hoursLeft)) return undefined;
  if (hoursLeft <= 1) return "TRASH WITHIN THE HOUR";
  return `TRASH IN ${Math.ceil(hoursLeft)}H`;
}
