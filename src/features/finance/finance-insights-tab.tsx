import type { FinanceData } from "@shared/finance-types";
import { PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useWriteReview } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { CategorySuggest, Figure, MutationError } from "./finance-kit";
import { formatChange, money } from "./finance-model";

/** What looks off, and the month in review. Figures are the engine's; Hermes only explains. */
export function FinanceInsightsTab({ data }: { data: FinanceData }) {
  const write = useWriteReview();
  const { review } = data;
  const sample = data.source.kind === "sample";
  const month = new Date(`${review.month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <PaperSection label="Unusual" count={data.anomalies.length}>
          {data.anomalies.length === 0 ? (
            <p className="text-[14px] leading-6 text-paper-char">Nothing unusual this month.</p>
          ) : (
            <ul className="space-y-3">
              {data.anomalies.map((anomaly) => (
                <li key={anomaly.id}>
                  <PaperCard className="p-4">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-paper-moss">
                      <Tag tone="flame">{anomaly.kind === "category" ? "Spending" : "Payment"}</Tag>
                      {anomaly.title}
                    </p>
                    <p className="mt-1 text-[13.5px] leading-6 text-paper-char">{anomaly.detail}</p>
                    {anomaly.kind === "transaction" && anomaly.transactionId && anomaly.merchant && data.jev.configured && !sample ? (
                      <CategorySuggest transactionId={anomaly.transactionId} merchant={anomaly.merchant} />
                    ) : null}
                  </PaperCard>
                </li>
              ))}
            </ul>
          )}
        </PaperSection>

        {data.attention.length > 0 ? (
          <PaperSection label="Attention" count={data.attention.length}>
            <ul className="space-y-2">
              {data.attention.map((item) => (
                <li key={item.id} className={cn("flex items-start gap-2.5 text-[14.5px] leading-6", item.tone === "warn" ? "text-paper-moss" : "text-paper-char")}>
                  <span aria-hidden="true" className={cn("w-4 shrink-0 text-center font-semibold", item.tone === "warn" ? "text-paper-flame-deep" : "text-paper-sage")}>
                    {item.tone === "warn" ? "!" : "○"}
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
          </PaperSection>
        ) : null}
      </div>

      <div className="min-w-0 space-y-12">
        <PaperSection label={`${month} review`}>
          <PaperCard className="bg-paper-cream p-5">
            <div className="grid grid-cols-3 gap-4">
              <Figure label="Income" value={money(review.income)} />
              <Figure label="Expenses" value={money(review.spent)} />
              <Figure label="Saved" value={money(review.saved)} tone={review.saved < 0 ? "warn" : undefined} />
            </div>
          </PaperCard>

          {review.changes.length > 0 ? (
            <div className="mt-6">
              <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">What changed</p>
              <ul className="mt-2 divide-y divide-paper-stone">
                {review.changes.map((change) => (
                  <li key={change.label} className="flex items-baseline justify-between py-1.5 text-[14.5px]">
                    <span className="text-paper-moss">{change.label}</span>
                    <span className={cn("tabular-nums", change.change >= 0.2 ? "font-semibold text-paper-flame-deep" : "text-paper-char")}>{formatChange(change.change)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {[
            { label: "Good", items: review.good },
            { label: "Review", items: review.review },
            { label: "Next focus", items: review.focus },
          ].map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.label} className="mt-6">
                <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">{group.label}</p>
                <ul className="mt-2 space-y-1.5">
                  {group.items.map((item) => (
                    <li key={item} className="text-[14.5px] leading-6 text-paper-moss">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}

          <div className="mt-8 border-t border-paper-stone pt-6">
            {review.narrative ? (
              <>
                <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">Hermes explains</p>
                <p className="mt-2 text-[14.5px] leading-7 whitespace-pre-line text-paper-char">{review.narrative}</p>
                <p className="mt-2 text-[12.5px] text-paper-sage">
                  Written from the figures above{review.narrativeAt ? `, ${new Date(review.narrativeAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}. Hermes did not calculate any of them.
                </p>
              </>
            ) : null}
            <PaperButton variant="amber" className="mt-4" disabled={write.isPending || sample} onClick={() => write.mutate()}>
              {write.isPending ? "Asking Hermes…" : review.narrative ? "Explain again" : "Ask Hermes to explain"}
            </PaperButton>
            {sample ? <p className="mt-2 text-[12.5px] text-paper-sage">Not available on sample data.</p> : null}
            <MutationError error={write.error} />
          </div>
        </PaperSection>
      </div>
    </div>
  );
}
