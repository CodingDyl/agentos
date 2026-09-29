import type { FinanceData } from "@shared/finance-types";
import { PaperCard, PaperSection, Tag } from "@/components/paper";
import { cn } from "@/lib/utils";
import { Figure, Line } from "./finance-kit";
import { formatMonthShort, money } from "./finance-model";

/** Six months of what came in and what went out, and where the money sits. */
export function FinanceCashFlowTab({ data }: { data: FinanceData }) {
  const peak = Math.max(1, ...data.months.flatMap((month) => [month.income, month.spent]));

  return (
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-12">
        <PaperSection label="Last six months">
          <ul className="space-y-4">
            {data.months.map((month) => {
              const current = month.month === data.month;
              return (
                <li key={month.month} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4">
                  <span className="text-[13px] font-medium text-paper-char">{formatMonthShort(month.month)}</span>
                  <div className="space-y-1" role="img" aria-label={`${formatMonthShort(month.month)}: income ${money(month.income)}, spent ${money(month.spent)}`}>
                    <div className="h-2 rounded-[2px] bg-paper-stone">
                      <div className="h-full rounded-[2px] bg-paper-moss" style={{ width: `${(month.income / peak) * 100}%` }} />
                    </div>
                    <div className="h-2 rounded-[2px] bg-paper-stone">
                      <div className="h-full rounded-[2px] bg-paper-amber" style={{ width: `${(month.spent / peak) * 100}%` }} />
                    </div>
                  </div>
                  <span className={cn("w-24 text-right text-[13.5px] tabular-nums", month.saved < 0 ? "font-semibold text-paper-flame-deep" : "text-paper-moss")}>
                    {money(month.saved)}
                    {current ? <span className="block text-[11.5px] font-normal text-paper-sage">so far</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-paper-sage">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[1px] bg-paper-moss" aria-hidden="true" /> Income
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[1px] bg-paper-amber" aria-hidden="true" /> Spent
            </span>
            <span>Right: saved. Transfers between your own accounts and into investments are not counted as spending.</span>
          </p>
        </PaperSection>

        <PaperSection label="Month by month">
          <div className="overflow-x-auto rounded-[4px] border border-paper-mist">
            <table className="w-full min-w-[32rem] text-left text-[14px]">
              <thead className="bg-paper-linen text-[12.5px] text-paper-char">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Month</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Income</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Spent</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Saved</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-stone tabular-nums">
                {[...data.months].reverse().map((month) => (
                  <tr key={month.month}>
                    <th scope="row" className="px-4 py-2.5 font-medium text-paper-moss">{formatMonthShort(month.month)}</th>
                    <td className="px-4 py-2.5 text-right">{money(month.income)}</td>
                    <td className="px-4 py-2.5 text-right">{money(month.spent)}</td>
                    <td className={cn("px-4 py-2.5 text-right", month.saved < 0 && "font-semibold text-paper-flame-deep")}>{money(month.saved)}</td>
                    <td className="px-4 py-2.5 text-right text-paper-char">{month.savingsRate === undefined ? "-" : `${Math.round(month.savingsRate * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PaperSection>
      </div>

      <div className="min-w-0 space-y-12">
        <PaperCard className="bg-paper-cream p-5">
          <div className="space-y-5">
            <Figure label="Free cash flow" value={data.freeCashFlow === undefined ? "-" : money(data.freeCashFlow)} note="Average saved over the last three complete months." />
            <Figure label="Average monthly spend" value={data.averageMonthlySpend === undefined ? "-" : money(data.averageMonthlySpend)} note="Same three months." />
          </div>
        </PaperCard>

        <PaperSection label="Accounts" count={data.accounts.length}>
          <dl className="divide-y divide-paper-stone">
            {data.accounts.map((account) => (
              <div key={account.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="min-w-0 text-[14px] text-paper-moss">
                  {account.name}
                  <span className="ml-2 inline-flex gap-1.5 align-middle">
                    <Tag>{account.type}</Tag>
                    {account.mask ? <span className="text-[12px] text-paper-sage">•••• {account.mask}</span> : null}
                  </span>
                </dt>
                <dd className={cn("shrink-0 text-[14px] tabular-nums", account.balance < 0 ? "text-paper-flame-deep" : "text-paper-moss")}>{money(account.balance)}</dd>
              </div>
            ))}
          </dl>
          <dl className="mt-1 border-t border-paper-mist pt-1">
            <Line strong label="Net cash" value={money(data.netCash)} />
          </dl>
        </PaperSection>
      </div>
    </div>
  );
}
