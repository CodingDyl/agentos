import { Link } from "react-router-dom";
import type { PreviousReview } from "@shared/finance-types";
import { PaperButton, PaperSection, Tag } from "@/components/paper";
import { useFinance, useMarkReviewSeen } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { excerpt, isLiveSource, money, narrativeSection } from "./finance-model";

/** How many alerts Today shows before pointing at Finance. */
const TODAY_LIMIT = 4;

/**
 * Finance on Today, so it is part of the day rather than a page nobody opens.
 *
 * Only real data raises alerts here. On sample data, or with no accounts, the
 * section says how to connect instead of announcing problems in a ledger that
 * is not yours.
 */
export function FinanceToday({ className }: { className?: string }) {
  const { data, isError } = useFinance();

  if (isError) {
    return (
      <PaperSection label="Finance" className={className}>
        <p className="text-[15px] leading-6 text-paper-flame-deep">Finance could not be read.</p>
      </PaperSection>
    );
  }

  if (!data) return null;

  const live = isLiveSource(data.source);
  // Last month's review, until you have read it. Its own card says "ready", so the alert list does not repeat it.
  const review = live && data.previousReview && !data.previousReview.seen ? data.previousReview : undefined;
  const alerts = data.attention.filter((item) => !(review && item.id === "review"));
  const shown = live ? alerts.slice(0, TODAY_LIMIT) : [];

  return (
    <PaperSection
      id="finance"
      label="Finance"
      className={className}
      action={
        <Link to="/finance" className="-mx-1 inline-flex min-h-8 cursor-pointer items-center rounded-md px-1 text-[12.5px] text-paper-sage transition-colors duration-150 hover:text-paper-moss">
          Open Finance →
        </Link>
      }
    >
      {!live ? (
        <p className="text-[15px] leading-6 text-paper-char">
          Finance is not connected to a bank yet.{" "}
          <Link to="/finance?tab=settings" className="rounded-sm text-paper-moss underline-offset-4 hover:underline">
            Connect Investec
          </Link>{" "}
          to see spending alerts here.
        </p>
      ) : shown.length === 0 ? (
        <>
          {review ? <MonthlyReviewCard previous={review} /> : null}
          {review ? null : <p className="text-[15px] leading-6 text-paper-char">Nothing needs attention in your money.</p>}
        </>
      ) : (
        <>
          {review ? <MonthlyReviewCard previous={review} /> : null}
          <ul className="space-y-2.5">
          {shown.map((item) => (
            <li key={item.id} className="flex min-w-0 items-baseline gap-3">
              <span aria-hidden="true" className={cn("w-3 shrink-0 text-center text-[13px] font-semibold", item.tone === "warn" ? "text-paper-flame-deep" : "text-paper-sage")}>
                {item.tone === "warn" ? "!" : "○"}
              </span>
              <Link to={`/finance?tab=${item.tab}`} className="min-w-0 rounded-sm text-[16px] leading-7 text-paper-char transition-colors duration-150 hover:text-paper-moss">
                {item.text}
              </Link>
            </li>
          ))}
          {alerts.length > shown.length ? <li className="pl-6 text-[12.5px] text-paper-sage">+{alerts.length - shown.length} more in Finance</li> : null}
          </ul>
        </>
      )}
    </PaperSection>
  );
}

/**
 * Last month, in review, once it is over.
 *
 * Hermes writes its part by itself at the start of the month, so this simply
 * appears. It shows the month's three numbers, what Hermes advises for the
 * month ahead, and where to read the rest. It stays until you mark it read, and
 * it is still in Finance afterwards.
 */
function MonthlyReviewCard({ previous }: { previous: PreviousReview }) {
  const read = useMarkReviewSeen();
  const { review } = previous;
  const month = new Date(`${review.month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const advice = review.narrative ? excerpt(narrativeSection(review.narrative, "Next month") ?? review.narrative, 320) : undefined;

  return (
    <div className="mb-6 rounded-none border border-l-[3px] border-paper-mist border-l-paper-green bg-paper-cream p-4" role="region" aria-label={`${month} review`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-paper-display text-[18px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">{month} review</h3>
          <p className="mt-1">
            <Tag tone={review.narrative ? "green" : "muted"}>{review.narrative ? "Ready" : "Figures only"}</Tag>
          </p>
        </div>
        <PaperButton variant="ghost" disabled={read.isPending} onClick={() => read.mutate()} aria-label={`Mark the ${month} review as read`}>
          Mark as read
        </PaperButton>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
        {[
          { label: "Income", value: money(review.income) },
          { label: "Spent", value: money(review.spent) },
          { label: "Saved", value: money(review.saved), warn: review.saved < 0 },
        ].map((cell) => (
          <div key={cell.label}>
            <dt className="text-paper-sage">{cell.label}</dt>
            <dd className={cn("font-paper-display text-[18px] font-extrabold tracking-[-0.02em] tabular-nums", cell.warn ? "text-paper-flame-deep" : "text-paper-moss")}>{cell.value}</dd>
          </div>
        ))}
      </dl>

      {advice ? (
        <p className="mt-3 text-[14.5px] leading-6 text-paper-char">
          <span className="font-semibold text-paper-moss">Next month: </span>
          {advice}
        </p>
      ) : (
        <p className="mt-3 text-[14px] leading-6 text-paper-char">{previous.error ? "Hermes could not write its part yet. It will try again." : "Hermes is still to write its part."}</p>
      )}

      <Link to="/finance?tab=insights" className="mt-3 inline-flex min-h-8 items-center rounded-sm text-[13.5px] font-medium text-paper-moss underline-offset-4 hover:underline">
        Read the full review →
      </Link>
      {read.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {read.error.message}
        </p>
      ) : null}
    </div>
  );
}
