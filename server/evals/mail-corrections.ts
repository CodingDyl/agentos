import type { MailBucket, MailCategory } from "../../shared/mail-types";

/**
 * The owner's own mail corrections, shaped as eval cases.
 *
 * Each correction is a case: given this thread, the app should file it where
 * the owner did. The examples sent with it are the *other* corrections only
 * (leave-one-out). A thread shown its own answer would score perfectly and
 * measure nothing.
 */

export interface CorrectedThread {
  threadId: string;
  fromEmail?: string;
  subject: string;
  snippet: string;
  messageDate: string;
  bucket?: MailBucket;
  category?: MailCategory;
  correctedAt: string;
}

export interface CorrectionCase {
  description: string;
  vars: {
    from: string;
    subject: string;
    snippet: string;
    date: string;
    expectedBucket?: MailBucket;
    expectedCategory?: MailCategory;
    corrections: Array<{ from: string; subject: string; snippet: string; bucket?: MailBucket; category?: MailCategory }>;
  };
}

const domainOf = (email: string | undefined) => (email?.includes("@") ? email.slice(email.indexOf("@")).toLowerCase() : undefined);

/** Same order the app uses when it picks examples: same sender, same domain, then newest. */
function closeness(target: CorrectedThread, other: CorrectedThread): number {
  const from = target.fromEmail?.toLowerCase();
  if (from && other.fromEmail?.toLowerCase() === from) return 0;
  const domain = domainOf(target.fromEmail);
  if (domain && domainOf(other.fromEmail) === domain) return 1;
  return 2;
}

export function buildCorrectionCases(rows: readonly CorrectedThread[], examplesPerCase: number): CorrectionCase[] {
  return rows
    .filter((row) => row.bucket !== undefined || row.category !== undefined)
    .map((row) => {
      const examples = rows
        .filter((other) => other.threadId !== row.threadId)
        .sort((a, b) => closeness(row, a) - closeness(row, b) || b.correctedAt.localeCompare(a.correctedAt))
        .slice(0, examplesPerCase)
        .map((other) => ({
          from: other.fromEmail ?? "unknown",
          subject: other.subject,
          snippet: other.snippet,
          bucket: other.bucket,
          category: other.category,
        }));
      return {
        description: `Correction ${row.threadId.slice(0, 8)}`,
        vars: {
          from: row.fromEmail ?? "unknown",
          subject: row.subject,
          snippet: row.snippet,
          date: row.messageDate,
          expectedBucket: row.bucket,
          expectedCategory: row.category,
          corrections: examples,
        },
      };
    });
}
