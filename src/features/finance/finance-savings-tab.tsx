import type { FinanceData } from "@shared/finance-types";
import { Meter, PaperCard, PaperSection } from "@/components/paper";
import { cn } from "@/lib/utils";
import { Figure, Line } from "./finance-kit";
import { formatMonthShort, money } from "./finance-model";

/**
 * How much to save each month, and in what order.
 *
 * Not one rule of thumb. It takes what you actually have left after spending,
 * and hands it down a list most people would defend: a starter buffer, then
 * expensive debt, then the full buffer, then your dated goals, then long-term
 * saving. If the list asks for more than you have, it says by how much, and
 * the steps at the bottom are the ones left unfunded.
 *
 * AgentOS does not move money. This page tells you what to move; you make the
 * transfer in your bank, and Finance checks that it happened.
 */
export function FinanceSavingsTab({ data }: { data: FinanceData }) {
  const plan = data.savings;

  if (!plan.ready) {
    return (
      <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">
        There is not enough to plan from yet. Finance needs at least one complete month of income and spending to say how much you can save. Come back once one has finished.
      </p>
    );
  }

  const covered = plan.gap === 0;
  const target = plan.bufferTargetMonths;
  const months = plan.bufferMonths ?? 0;
  const savingsNames = plan.savingsAccounts.map((account) => account.name);

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <PaperCard className="bg-paper-cream p-5 sm:p-6">
          <Figure
            large
            label="Aim to save each month"
            value={money(plan.recommended)}
            note={
              covered
                ? `The whole plan (${money(plan.totalNeeded)} a month) fits inside the ${money(plan.capacity)} you have left after spending.`
                : `The plan asks for ${money(plan.totalNeeded)} a month, and you have ${money(plan.capacity)} left after spending. It is ${money(plan.gap)} short, so the last steps below go unfunded.`
            }
          />
          <dl className="mt-5 grid gap-x-8 sm:grid-cols-3">
            <Line label="Average income" value={money(plan.income)} />
            <Line label="Average spending" value={money(plan.spending)} />
            <Line strong label="Left to save" value={money(plan.capacity)} />
          </dl>
        </PaperCard>

        <PaperSection label="Where it should go, in order">
          <ol className="space-y-5">
            {plan.steps
              .filter((step) => step.needed > 0 || step.id === "starter")
              .map((step, index) => {
                const short = step.funded < step.needed;
                return (
                  <li key={step.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-paper-display text-[16px] font-bold text-paper-moss">
                        <span className="mr-2 text-paper-sage tabular-nums">{index + 1}</span>
                        {step.label}
                      </p>
                      <p className="text-[14px] tabular-nums text-paper-char">
                        <span className={cn("font-semibold", short ? "text-paper-flame-deep" : "text-paper-moss")}>{money(step.funded)}</span>
                        {step.needed > 0 ? <span className="text-paper-sage"> of {money(step.needed)}</span> : null}
                      </p>
                    </div>
                    {step.needed > 0 ? (
                      <div className="mt-1.5">
                        <Meter value={step.needed > 0 ? step.funded / step.needed : undefined} label={`${step.label}: ${money(step.funded)} of ${money(step.needed)} funded`} tone={short ? "amber" : "green"} />
                      </div>
                    ) : null}
                    <p className="mt-1.5 text-[13px] leading-5 text-paper-sage">
                      {step.principle}. {step.note}
                    </p>
                  </li>
                );
              })}
          </ol>
          <p className="mt-6 max-w-[70ch] text-[12.5px] leading-5 text-paper-sage">
            The horizons are assumptions: the starter buffer over three months, debt and the full buffer over twelve. Change the goals and Finance recalculates. "Left to save" is your recent average, not a promise, and money owed to you is not counted until it arrives.
          </p>
        </PaperSection>
      </div>

      <div className="min-w-0 space-y-12">
        <PaperSection label="Your buffer">
          <Figure label="Cash you could live on" value={`${months.toFixed(1)} months`} note={`Aim for ${target} months${target === 6 ? ", because your income varies from month to month" : ""}.`} />
          <div className="mt-3">
            <Meter value={Math.min(1, months / target)} label={`Buffer: ${months.toFixed(1)} of ${target} months`} tone={months >= target ? "green" : "amber"} size="md" />
          </div>
          {plan.savingsAccounts.length > 0 ? (
            <dl className="mt-4 divide-y divide-paper-stone">
              {plan.savingsAccounts.map((account) => (
                <Line key={account.name} label={account.name} value={money(account.balance)} />
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-[13px] leading-5 text-paper-sage">No savings account found. A separate account you do not spend from makes a buffer easier to keep.</p>
          )}
        </PaperSection>

        <PaperSection label="How to do it">
          <p className="text-[14px] leading-6 text-paper-char">
            Each payday, move <span className="font-semibold text-paper-moss">{money(plan.recommended)}</span> {savingsNames.length > 0 ? `to ${savingsNames.join(" or ")}` : "to a savings account"}, before you spend the rest. Set it up as a recurring transfer in your bank so it happens without a decision.
          </p>
          <p className="mt-3 text-[14px] leading-6 text-paper-char">
            Moved into savings so far this month: <span className="font-semibold text-paper-moss">{money(plan.movedToSavingsThisMonth)}</span>
            {plan.recommended > 0 ? ` of ${money(plan.recommended)}` : ""}.
          </p>
          {plan.recommended > 0 ? (
            <div className="mt-2">
              <Meter value={Math.min(1, plan.movedToSavingsThisMonth / plan.recommended)} label="Moved to savings this month against the plan" tone="green" />
            </div>
          ) : null}
          <div role="note" className="mt-5 rounded-[4px] bg-paper-linen p-4 text-[13px] leading-6 text-paper-char">
            <p className="font-semibold text-paper-moss">AgentOS does not move money.</p>
            <p className="mt-1">You make the transfer in your bank, and Finance checks that it happened. Only savings accounts Finance can see are counted, so an account it does not know about will show as R0 moved.</p>
          </div>
        </PaperSection>

        <PaperSection label="Recent months">
          <ul className="divide-y divide-paper-stone">
            {[...data.months].reverse().slice(0, 5).map((entry) => (
              <li key={entry.month} className="flex items-baseline justify-between py-2 text-[14px] tabular-nums">
                <span className="text-paper-char">{formatMonthShort(entry.month)}{entry.month === data.month ? " (so far)" : ""}</span>
                <span className={cn(entry.saved < 0 ? "font-semibold text-paper-flame-deep" : "text-paper-moss")}>
                  {money(entry.saved)}
                  <span className="ml-2 text-[12.5px] text-paper-sage">{entry.savingsRate === undefined ? "" : `${Math.round(entry.savingsRate * 100)}%`}</span>
                </span>
              </li>
            ))}
          </ul>
        </PaperSection>
      </div>
    </div>
  );
}
