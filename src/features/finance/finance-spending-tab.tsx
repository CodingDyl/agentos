import { useState } from "react";
import type { Category, FinanceData, FinanceTransactionRow } from "@shared/finance-types";
import { PaperSection, Tag } from "@/components/paper";
import { useSaveCorrection } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { CategorySuggest, MutationError } from "./finance-kit";
import { CATEGORY_CHOICES, formatDay, money } from "./finance-model";
import { Pagination } from "./finance-pagination";
import { usePagination } from "./finance-ui-hooks";
import { CategoryList, IncomeSplit } from "./finance-where-it-goes";

/** Where it went, and the place to say what a payment really was. */
export function FinanceSpendingTab({ data }: { data: FinanceData }) {
  const [filter, setFilter] = useState<"all" | "review">("all");
  const rows = filter === "review" ? data.transactions.filter((row) => row.flagged || row.categorySource === "none") : data.transactions;
  // Back to the first page whenever the filter changes, so a shorter list never leaves you on an empty page.
  const pager = usePagination(rows, filter);

  return (
    <div className="space-y-12">
      <IncomeSplit data={data} />

      <CategoryList data={data} />

      <PaperSection
        label="Recent payments"
        count={rows.length}
        action={
          <div role="radiogroup" aria-label="Filter payments" className="inline-flex rounded-[4px] border border-paper-mist bg-paper-linen p-0.5 text-[13px]">
            {(["all", "review"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={filter === option}
                onClick={() => setFilter(option)}
                className={cn("min-h-7 cursor-pointer rounded-[3px] px-3 font-medium", filter === option ? "bg-paper-white text-paper-moss ring-1 ring-paper-mist" : "text-paper-sage hover:text-paper-moss")}
              >
                {option === "all" ? "All" : "Needs a look"}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="text-[14px] leading-6 text-paper-char">{filter === "review" ? "Nothing needs a look." : "No payments yet."}</p>
        ) : (
          <>
            <ul className="divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
              {pager.pageItems.map((row) => (
                <TransactionLine key={row.id} row={row} jev={data.jev.configured} readOnlySample={data.source.kind === "sample"} />
              ))}
            </ul>
            <Pagination label="Recent payments pages" {...pager} onPage={pager.setPage} onSize={pager.setSize} />
          </>
        )}
      </PaperSection>
    </div>
  );
}

function TransactionLine({ row, jev, readOnlySample }: { row: FinanceTransactionRow; jev: boolean; readOnlySample: boolean }) {
  const save = useSaveCorrection();
  const label = row.merchant ?? row.description;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[14.5px] text-paper-moss">
            <span className="truncate">{label}</span>
            {row.recurring ? <Tag>Recurring</Tag> : null}
            {row.flagged ? <Tag tone="flame">Unusual</Tag> : null}
            {row.categorySource === "you" ? <Tag tone="green">Yours</Tag> : null}
          </p>
          <p className="text-[12.5px] text-paper-sage">
            {formatDay(row.date)} · {row.accountName}
          </p>
        </div>

        <label className="flex items-center gap-2 text-[13px] text-paper-char">
          <span className="sr-only">Category for {label}</span>
          <select
            value={row.category ?? "Other"}
            disabled={save.isPending || readOnlySample}
            title={readOnlySample ? "Corrections are saved once Investec is connected" : undefined}
            onChange={(event) => save.mutate({ merchant: label, category: event.target.value as Category })}
            className="min-h-8 cursor-pointer rounded-[4px] border border-paper-mist bg-paper-white px-2 text-[13px] text-paper-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue disabled:cursor-not-allowed disabled:opacity-60"
          >
            {CATEGORY_CHOICES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <p className={cn("w-28 text-right text-[14.5px] tabular-nums", row.amount > 0 ? "text-paper-moss" : "text-paper-char")}>{money(row.amount, true)}</p>
      </div>

      {jev && (row.flagged || row.categorySource === "none") && !readOnlySample ? <CategorySuggest transactionId={row.id} merchant={label} /> : null}
      <MutationError error={save.error} />
    </li>
  );
}
