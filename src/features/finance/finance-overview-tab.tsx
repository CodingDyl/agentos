import { investecCashOf, netCashOf, type FinanceData, type FinanceTab } from "@shared/finance-types";
import { Meter, PaperButton, PaperCard, PaperSection, StackedMeter, Tag } from "@/components/paper";
import { useLiveBalances } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { PayBadge } from "./finance-badges";
import { Figure, Line, SignalDot } from "./finance-kit";
import { debtPayState, formatDay, formatChange, goalStatusLabel, upcomingPayments, money } from "./finance-model";

/**
 * Finance's first screen. It answers six questions in order: how much do I
 * have, where is it going, what is coming up, what am I saving toward, what
 * looks wasteful, and what needs attention. Every figure is the engine's.
 */
export function FinanceOverviewTab({ data, onTab }: { data: FinanceData; onTab: (tab: FinanceTab) => void }) {
  const { summary } = data;
  const upcoming = upcomingPayments(data);

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <Headline data={data} />

        <ExactNetCash data={data} />

        <PaperSection label="This month">
          <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-paper-mist bg-paper-mist lg:grid-cols-4">
            {[
              { label: "Income", value: money(summary.income) },
              { label: "Spent", value: money(summary.spent) },
              { label: "Saved", value: money(summary.saved), warn: summary.saved < 0 },
              { label: "Savings rate", value: summary.savingsRate === undefined ? "-" : `${(summary.savingsRate * 100).toFixed(1)}%` },
            ].map((cell) => (
              <li key={cell.label} className="bg-paper-white p-4">
                <Figure label={cell.label} value={cell.value} tone={cell.warn ? "warn" : undefined} />
              </li>
            ))}
          </ul>
        </PaperSection>

        {data.attention.length > 0 ? (
          <PaperSection label="Needs attention" count={data.attention.length}>
            <ul className="space-y-2">
              {data.attention.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onTab(item.tab)}
                    className="group flex w-full cursor-pointer items-start gap-2.5 rounded-[4px] text-left text-[14.5px] leading-6 text-paper-moss hover:text-paper-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue"
                  >
                    <span aria-hidden="true" className={cn("w-4 shrink-0 text-center font-semibold", item.tone === "warn" ? "text-paper-flame-deep" : "text-paper-sage")}>
                      {item.tone === "warn" ? "!" : "○"}
                    </span>
                    <span className={item.tone === "warn" ? "text-paper-moss" : "text-paper-char"}>{item.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </PaperSection>
        ) : null}

        <PaperSection
          label="Goals"
          action={
            <button type="button" onClick={() => onTab("goals")} className="cursor-pointer rounded-[4px] text-[12.5px] text-paper-sage hover:text-paper-moss focus-visible:outline-2 focus-visible:outline-paper-blue">
              Open goals →
            </button>
          }
        >
          {data.goals.length === 0 ? (
            <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">No goals yet. Add one on the Goals tab and Finance works out what to put aside each month.</p>
          ) : (
            <ul className="space-y-6">
              {data.goals.map((goal) => (
                <li key={goal.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-paper-display text-[16px] font-bold text-paper-moss">{goal.name}</p>
                    <span className="text-[13px] font-medium text-paper-char tabular-nums">{Math.round(goal.progress * 100)}%</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-paper-sage tabular-nums">
                    {money(goal.currentAmount)} / {money(goal.targetAmount)} · {goalStatusLabel(goal)}
                  </p>
                  <div className="mt-2.5">
                    <Meter value={goal.progress} label={`${goal.name} funded`} tone={goal.status === "behind" || goal.status === "overdue" ? "amber" : "green"} size="md" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PaperSection>

        <PaperSection label="Spending">
          {data.categories.length === 0 ? (
            <p className="text-[14px] leading-6 text-paper-char">Nothing spent yet this month.</p>
          ) : (
            <>
              <StackedMeter label="Spending this month by category" format={money} segments={data.categories.map((entry) => ({ key: entry.category, label: entry.category, value: entry.amount }))} />
              <ul className="mt-5 divide-y divide-paper-stone">
                {data.categories.map((entry) => (
                  <li key={entry.category} className="flex items-baseline justify-between gap-4 py-2 text-[14.5px]">
                    <span className="text-paper-moss">{entry.category}</span>
                    <span className="flex items-baseline gap-3 tabular-nums">
                      {entry.change !== undefined && Math.abs(entry.change) >= 0.15 ? (
                        <span className={cn("text-[12.5px]", entry.change > 0 ? "font-semibold text-paper-flame-deep" : "text-paper-sage")}>{formatChange(entry.change)}</span>
                      ) : null}
                      <span className="text-paper-moss">{money(entry.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </PaperSection>
      </div>

      <div className="min-w-0 space-y-12">
        <PaperSection label="Money health">
          <ul className="space-y-3">
            {data.health.map((signal) => (
              <li key={signal.id} className="flex items-start gap-2.5 text-[14.5px] leading-6">
                <SignalDot tone={signal.tone} />
                <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                  <span className="text-paper-char">{signal.label}</span>
                  <span className={cn("text-right tabular-nums", signal.tone === "warn" ? "font-semibold text-paper-flame-deep" : "text-paper-moss")}>{signal.value}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] leading-5 text-paper-sage">Separate signals, on purpose. There is no single score, because a score would hide which part to look at.</p>
        </PaperSection>

        <PaperSection label="Coming up">
          {upcoming.length === 0 ? (
            <p className="text-[14px] leading-6 text-paper-char">No recurring payments expected in the next two weeks.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((payment) => (
                <li key={payment.merchant} className="flex items-baseline justify-between gap-3 text-[14.5px]">
                  <span className="min-w-0 truncate text-paper-moss">
                    {payment.merchant} <span className="text-[12.5px] text-paper-sage">{formatDay(payment.date)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-paper-char">{money(payment.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">Bills are the ones you track; subscriptions are projected from their monthly rhythm. Neither is a schedule from the bank.</p>
        </PaperSection>

        <PaperSection label="Subscriptions">
          <Figure label="Every month" value={money(data.subscriptionMonthly)} note={`${money(data.subscriptionAnnual)} a year across ${data.subscriptions.length} ${data.subscriptions.length === 1 ? "service" : "services"}`} />
          {data.subscriptionReview.count > 0 ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-[14px] leading-6 text-paper-char">
              <Tag tone="marigold">{data.subscriptionReview.count} to review</Tag>
              Cancelling them would free {money(data.subscriptionReview.monthly)} a month.
            </p>
          ) : null}
          <button type="button" onClick={() => onTab("subscriptions")} className="mt-3 cursor-pointer rounded-[4px] text-[13px] text-paper-sage hover:text-paper-moss focus-visible:outline-2 focus-visible:outline-paper-blue">
            Open subscriptions →
          </button>
        </PaperSection>
      </div>
    </div>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * The big number. With Investec connected it is what is in your Investec
 * accounts right now, read from the bank while the page is open. Without it,
 * it is net cash as before. Either way the exact working is just below.
 */
function Headline({ data }: { data: FinanceData }) {
  const investec = investecCashOf(data.accounts);
  const live = data.source.kind === "investec" && data.source.configured;
  const balances = useLiveBalances(live);

  if (investec === undefined) {
    return (
      <PaperCard className="bg-paper-cream p-5 sm:p-6">
        <Figure large label="Net cash" value={money(data.netCash)} note="Current and savings accounts, less what is owed on cards. Investments are counted on their own tab." />
      </PaperCard>
    );
  }

  const count = data.accounts.filter((a) => a.provider === "investec" && (a.type === "current" || a.type === "savings")).length;
  const updated = balances.data?.at ?? data.source.balancesUpdatedAt ?? data.source.lastSyncedAt;

  return (
    <PaperCard className="bg-paper-cream p-5 sm:p-6">
      <Figure large label="In your Investec accounts" value={money(investec)} note={`Current and savings, across ${count} ${count === 1 ? "account" : "accounts"}. Your net cash, after cards and anything else, is worked out below.`} />
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-paper-sage" role="status" aria-live="polite">
        {live ? (
          <>
            <span className="flex items-start gap-1.5">
              <span aria-hidden="true" className={cn("mt-1 size-2 shrink-0 rounded-full", balances.isError ? "bg-paper-flame" : "bg-paper-green")} />
              {balances.isError
                ? `${balances.error instanceof Error && balances.error.message ? balances.error.message : "Could not read Investec just now."}${updated ? ` Showing the balance from ${clock(updated)}.` : ""}`
                : balances.isFetching && !balances.data
                  ? "Reading Investec…"
                  : `Live from Investec · updated ${updated ? clock(updated) : "just now"}`}
            </span>
            <PaperButton disabled={balances.isFetching} onClick={() => void balances.refetch()} aria-label="Read Investec's balances again now">
              {balances.isFetching ? "Reading…" : "Refresh"}
            </PaperButton>
          </>
        ) : (
          <span>Balances as of the last sync.</span>
        )}
      </div>
    </PaperCard>
  );
}

const PROVIDER_LABEL = { investec: "Investec", manual: "You added", sample: "Sample" } as const;

/**
 * Net cash, itemised so it can be checked against the bank: what you hold, what
 * you owe, and the total. The total uses the same function as the rest of
 * Finance, so it cannot differ from the figure everywhere else. What is left
 * out is named, so a missing amount is a decision you can see and not a gap.
 */
function ExactNetCash({ data }: { data: FinanceData }) {
  const held = data.accounts.filter((a) => a.type === "current" || a.type === "savings");
  const owed = data.accounts.filter((a) => a.type === "credit");
  const investments = data.accounts.filter((a) => a.type === "investment");
  const heldTotal = held.reduce((total, a) => total + a.balance, 0);
  const owedTotal = owed.reduce((total, a) => total + a.balance, 0);
  const total = netCashOf(data.accounts);
  const owedBack = data.shared.partner && data.shared.owedBack >= 1 ? data.shared.owedBack : 0;
  const investmentValue = investments.reduce((sum, a) => sum + a.balance, 0);

  const row = (a: FinanceData["accounts"][number]) => (
    <div key={a.id} className="flex items-baseline justify-between gap-4 py-1.5 text-[14px]">
      <dt className="min-w-0 text-paper-char">
        {a.name}
        <span className="ml-2 align-middle">
          <Tag>{PROVIDER_LABEL[a.provider]}</Tag>
        </span>
        {a.provider === "manual" ? <span className="ml-2 text-[12px] text-paper-sage">as you last entered it</span> : null}
        {a.type === "credit" ? (
          <span className="ml-2 align-middle">
            {(() => {
              const debt = data.debts.find((entry) => entry.accountId === a.id);
              if (!debt) return null;
              const pay = debtPayState(debt);
              return <PayBadge state={pay.state}>{pay.label}</PayBadge>;
            })()}
          </span>
        ) : null}
      </dt>
      <dd className={cn("shrink-0 tabular-nums", a.balance < 0 ? "text-paper-flame-deep" : "text-paper-moss")}>{a.type === "credit" ? `- ${money(-a.balance, true)}` : money(a.balance, true)}</dd>
    </div>
  );

  return (
    <PaperSection label="Your exact net cash">
      {data.accounts.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-char">No accounts yet.</p>
      ) : (
        <div className="rounded-[4px] border border-paper-mist">
          <div className="px-4 pt-3">
            <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">What you hold</p>
            <dl className="divide-y divide-paper-stone">{held.length > 0 ? held.map(row) : <p className="py-1.5 text-[14px] text-paper-sage">No current or savings accounts.</p>}</dl>
            <dl className="border-t border-paper-mist">
              <Line label="Total held" value={money(heldTotal, true)} />
            </dl>
          </div>

          {owed.length > 0 ? (
            <div className="border-t border-paper-mist px-4 pt-3">
              <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">What you owe</p>
              <dl className="divide-y divide-paper-stone">{owed.map(row)}</dl>
              <dl className="border-t border-paper-mist">
                <Line label="Total owed" value={`- ${money(-owedTotal, true)}`} />
              </dl>
            </div>
          ) : null}

          <dl className="border-t-2 border-paper-moss bg-paper-cream px-4 py-2">
            <Line strong label="Net cash" value={money(total, true)} />
          </dl>
        </div>
      )}

      {investments.length > 0 || owedBack > 0 ? (
        <div className="mt-5">
          <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">Not counted above</p>
          <dl className="mt-1 divide-y divide-paper-stone">
            {investments.length > 0 ? <Line label="Investments (not cash: see the Investments tab)" value={money(investmentValue, true)} /> : null}
            {owedBack > 0 ? <Line label={`Owed back to you by ${data.shared.partner?.name}`} value={`+ ${money(owedBack, true)}`} /> : null}
            {owedBack > 0 ? <Line strong label="Net cash if that arrives" value={money(total + owedBack, true)} /> : null}
          </dl>
        </div>
      ) : null}

      <p className="mt-3 max-w-[70ch] text-[12.5px] leading-5 text-paper-sage">
        Investec balances are what the bank reports for each account right now. A card's balance is what you owe on it. Accounts you added are only as accurate as the last time you updated them.
      </p>
    </PaperSection>
  );
}
