import type { MailThread } from "../../shared/mail-types";

export type MailBucketKey = "needs_you" | "fyi" | "low_priority";

const NEEDS_REPLY_THRESHOLD = 0.5;
const FINANCIAL_THRESHOLD = 0.5;
const FYI_CATEGORIES = new Set(["client", "sales", "finance", "admin"]);

/**
 * Which bucket a classified thread belongs in — ordinary code, not a second
 * model call, so the screen says the same thing twice in a row.
 *
 * An unclassified thread (Jev hasn't succeeded yet) goes to `fyi` rather than
 * `low_priority`, so a failed classification stays visible instead of being
 * mistaken for something genuinely unimportant.
 */
export function bucketFor(thread: MailThread): MailBucketKey {
  if (!thread.classified) return "fyi";

  if (
    (thread.needsReply ?? 0) >= NEEDS_REPLY_THRESHOLD ||
    (thread.actionRequired ?? 0) >= NEEDS_REPLY_THRESHOLD
  ) {
    return "needs_you";
  }

  if (
    (thread.financial ?? 0) >= FINANCIAL_THRESHOLD ||
    (thread.category !== undefined && FYI_CATEGORIES.has(thread.category))
  ) {
    return "fyi";
  }

  return "low_priority";
}

function byDateDescending(a: MailThread, b: MailThread): number {
  return Date.parse(b.messageDate) - Date.parse(a.messageDate);
}

function byUrgencyThenDate(a: MailThread, b: MailThread): number {
  const urgencyDiff = (b.urgency ?? 0) - (a.urgency ?? 0);
  return urgencyDiff !== 0 ? urgencyDiff : byDateDescending(a, b);
}

export interface MailBuckets {
  needsYou: MailThread[];
  fyi: MailThread[];
  lowPriority: MailThread[];
}

/** Groups and sorts a flat list of threads into the three buckets the Mail page renders. */
export function buildMailBuckets(threads: readonly MailThread[]): MailBuckets {
  const needsYou: MailThread[] = [];
  const fyi: MailThread[] = [];
  const lowPriority: MailThread[] = [];

  for (const thread of threads) {
    const bucket = bucketFor(thread);
    if (bucket === "needs_you") needsYou.push(thread);
    else if (bucket === "fyi") fyi.push(thread);
    else lowPriority.push(thread);
  }

  needsYou.sort(byUrgencyThenDate);

  // Unclassified threads sort first (as `false < true`), newest first within
  // each group — a retry-pending thread should never hide behind old mail.
  fyi.sort((a, b) => {
    if (a.classified !== b.classified) return a.classified ? 1 : -1;
    return byDateDescending(a, b);
  });

  lowPriority.sort(byDateDescending);

  return { needsYou, fyi, lowPriority };
}
