import { addMonths } from "./engine";
import { getFinanceForMonth, hasRealData, localToday, syncFinance } from "./finance";
import { isInvestecConfigured } from "./investec";
import { readNarrative, writeNarrative } from "./review";
import { readMeta, writeMeta } from "./store";

/**
 * The monthly review, written on its own.
 *
 * Once a month is over, Hermes is asked to explain how it went, from the
 * figures the engine worked out as at that month's last day. Nobody has to
 * remember to press a button: the server checks on start, then every hour, and
 * on every page load, and does nothing unless there is a finished month with no
 * review yet.
 *
 * It is careful about three things:
 *
 * - It only ever writes a review once. A stored one is never replaced unless
 *   you ask, so a review you have read does not change under you.
 * - It never runs on sample data, and never for a month with nothing in it.
 * - When Hermes is down it does not hammer it. A failed try is recorded with its
 *   reason, shown on the page, and retried no sooner than six hours later.
 *
 * What Hermes is given is unchanged from the manual review: that month's totals,
 * category movement and the plain findings. Never merchants, balances, account
 * names or numbers.
 */

const RETRY_AFTER_MS = 6 * 60 * 60_000;
const CHECK_EVERY_MS = 60 * 60_000;
const FIRST_CHECK_AFTER_MS = 90_000;

export type ReviewOutcome = "written" | "exists" | "skipped" | "waiting" | "failed";

let inflight: Promise<ReviewOutcome> | undefined;

export const previousMonth = () => addMonths(localToday().slice(0, 7), -1);

/**
 * Writes last month's review if it needs one. `force` is you asking for it, so
 * it ignores both the existing review and the wait after a failure.
 */
export function ensureMonthlyReview(options: { force?: boolean } = {}): Promise<ReviewOutcome> {
  if (inflight) return inflight;

  const run = (async (): Promise<ReviewOutcome> => {
    const month = previousMonth();
    if (!options.force) {
      if (readNarrative(month)) return "exists";
      const attempt = readMeta(`review-attempt:${month}`);
      if (attempt && Date.now() - Date.parse(attempt) < RETRY_AFTER_MS) return "waiting";
    }
    if (!hasRealData()) return "skipped";

    // The last days of the month may not be in the ledger yet. Bring it up to date first; a failed sync is not a reason not to try.
    if (isInvestecConfigured()) await syncFinance().catch(() => undefined);

    const data = getFinanceForMonth(month);
    if (data.review.income <= 0 && data.review.spent <= 0) return "skipped";

    writeMeta(`review-attempt:${month}`, new Date().toISOString());
    try {
      await writeNarrative(data);
      writeMeta(`review-error:${month}`, "");
      return "written";
    } catch (error) {
      writeMeta(`review-error:${month}`, error instanceof Error ? error.message : "Hermes could not write the review.");
      return "failed";
    }
  })();

  // Cleared once it settles, and only from here. Clearing inside the function is wrong: a path that returns
  // before its first await would clear `inflight` before this assignment, and leave a finished promise in it.
  inflight = run;
  const clear = () => {
    if (inflight === run) inflight = undefined;
  };
  run.then(clear, clear);

  return run;
}

/** For a page load: try, and never let it block or throw. */
export function ensureMonthlyReviewInBackground(): void {
  void ensureMonthlyReview().catch((error) => console.error("[agentos] finance: monthly review check failed:", error));
}

export function markReviewSeen(month: string): void {
  writeMeta(`review-seen:${month}`, "1");
}

/** The error from the last failed try, for showing next to a "try again". */
export const reviewError = (month: string) => readMeta(`review-error:${month}`) || undefined;

/** Checks on start and then hourly. Timers do not keep the process alive. */
export function startMonthlyReviewSchedule(): void {
  const check = () => ensureMonthlyReviewInBackground();
  setTimeout(check, FIRST_CHECK_AFTER_MS).unref();
  setInterval(check, CHECK_EVERY_MS).unref();
}
