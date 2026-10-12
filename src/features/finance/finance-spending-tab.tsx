import { PaperPagination } from "@/components/paper";
import { useState } from "react";
import { CircleHelp } from "lucide-react";
import type { Category, Enquiry, FinanceData, FinanceTransactionRow } from "@shared/finance-types";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useRemoveEnquiry, useSaveCorrection, useSaveEnquiry } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { CategorySuggest, MutationError } from "./finance-kit";
import { CATEGORY_CHOICES, formatDay, money, needsClassifying } from "./finance-model";
import { usePagination } from "@/lib/use-pagination";
import { CategoryList, IncomeSplit } from "./finance-where-it-goes";

type PaymentFilter = "all" | "review" | "enquire";

const FILTER_LABEL: Record<PaymentFilter, string> = { all: "All", review: "Needs a look", enquire: "Enquire" };

/** Where it went, and the place to say what a payment really was. */
export function FinanceSpendingTab({ data }: { data: FinanceData }) {
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const enquired = new Set(data.enquiries.map((entry) => entry.transactionId));
  const rows = filter === "review" ? data.transactions.filter(needsClassifying) : data.transactions;
  // Back to the first page whenever the filter changes, so a shorter list never leaves you on an empty page.
  const pager = usePagination(rows, filter);
  const enquiryPager = usePagination(data.enquiries, filter);
  const sample = data.source.kind === "sample";

  return (
    <div className="space-y-12">
      <IncomeSplit data={data} />

      <CategoryList data={data} />

      <PaperSection
        label="Recent payments"
        count={filter === "enquire" ? data.enquiries.length : rows.length}
        action={
          <div role="radiogroup" aria-label="Filter payments" className="inline-flex rounded-none border border-paper-mist bg-paper-linen p-0.5 text-[13px]">
            {(["all", "review", "enquire"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={filter === option}
                onClick={() => setFilter(option)}
                className={cn("min-h-7 cursor-pointer rounded-none px-3 font-medium", filter === option ? "bg-paper-white text-paper-moss ring-1 ring-paper-mist" : "text-paper-sage hover:text-paper-moss")}
              >
                {FILTER_LABEL[option]}
                {option === "enquire" && data.enquiries.length > 0 ? <span className="ml-1 tabular-nums">({data.enquiries.length})</span> : null}
              </button>
            ))}
          </div>
        }
      >
        {filter === "enquire" ? (
          data.enquiries.length === 0 ? (
            <p className="text-[14px] leading-6 text-paper-char">
              Nothing to look into. Press the <CircleHelp aria-hidden="true" className="inline size-4 align-[-3px]" /> on a payment you do not recognise, or were not expecting, to keep it here until you have checked it.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
                {enquiryPager.pageItems.map((enquiry) => (
                  <EnquiryLine key={enquiry.transactionId} enquiry={enquiry} />
                ))}
              </ul>
              <PaperPagination label="Enquiry pages" pager={enquiryPager} />
            </>
          )
        ) : rows.length === 0 ? (
          <p className="text-[14px] leading-6 text-paper-char">{filter === "review" ? "Nothing needs a look." : "No payments yet."}</p>
        ) : (
          <>
            <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
              {pager.pageItems.map((row) => (
                <TransactionLine key={row.id} row={row} jev={data.jev.configured} readOnlySample={sample} enquired={enquired.has(row.id)} />
              ))}
            </ul>
            <PaperPagination label="Recent payments pages" pager={pager} />
          </>
        )}
      </PaperSection>
    </div>
  );
}

function TransactionLine({ row, jev, readOnlySample, enquired }: { row: FinanceTransactionRow; jev: boolean; readOnlySample: boolean; enquired: boolean }) {
  const save = useSaveCorrection();
  const enquire = useSaveEnquiry();
  const resolve = useRemoveEnquiry();
  const label = row.merchant ?? row.description;
  const enquiryPending = enquire.isPending || resolve.isPending;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[14.5px] text-paper-moss">
            <span className="truncate">{label}</span>
            {row.recurring ? <Tag>Recurring</Tag> : null}
            {row.flagged ? <Tag tone="flame">Unusual</Tag> : null}
            {row.categorySource === "you" ? <Tag tone="green">Yours</Tag> : null}
            {enquired ? <Tag tone="blue">Enquiring</Tag> : null}
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
            className="min-h-8 cursor-pointer rounded-none border border-paper-mist bg-paper-white px-2 text-[13px] text-paper-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue disabled:cursor-not-allowed disabled:opacity-60"
          >
            {CATEGORY_CHOICES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <p className={cn("w-28 text-right text-[14.5px] tabular-nums", row.amount > 0 ? "text-paper-moss" : "text-paper-char")}>{money(row.amount, true)}</p>
          <button
            type="button"
            aria-pressed={enquired}
            aria-label={enquired ? `Stop enquiring about ${label}` : `Enquire about ${label}`}
            title={readOnlySample ? "Enquiries are saved once you have your own payments" : enquired ? "In Enquire. Press to take it out" : "Not sure about this one? Add it to Enquire"}
            disabled={enquiryPending || readOnlySample}
            onClick={() => (enquired ? resolve.mutate(row.id) : enquire.mutate({ transactionId: row.id }))}
            className={cn(
              "inline-flex size-8 cursor-pointer items-center justify-center rounded-none disabled:cursor-not-allowed disabled:opacity-50",
              PAPER_FOCUS,
              enquired ? "text-paper-blue" : "text-paper-sage hover:text-paper-moss",
            )}
          >
            <CircleHelp aria-hidden="true" className="size-4" strokeWidth={enquired ? 2.5 : 2} />
          </button>
        </div>
      </div>

      {jev && needsClassifying(row) && !readOnlySample ? <CategorySuggest transactionId={row.id} merchant={label} current={row.category} /> : null}
      <MutationError error={save.error ?? enquire.error ?? resolve.error} />
    </li>
  );
}

/** One payment you are looking into: what it was, a note on what you found, and a way to close it. */
function EnquiryLine({ enquiry }: { enquiry: Enquiry }) {
  const saveNote = useSaveEnquiry();
  const resolve = useRemoveEnquiry();
  const [note, setNote] = useState(enquiry.note ?? "");
  const label = enquiry.merchant ?? enquiry.description;
  const changed = note.trim() !== (enquiry.note ?? "");

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] text-paper-moss">{label}</p>
          <p className="text-[12.5px] text-paper-sage">
            {formatDay(enquiry.date)} · {enquiry.accountName}
            {enquiry.merchant && enquiry.merchant !== enquiry.description ? ` · ${enquiry.description}` : ""}
          </p>
        </div>
        <p className={cn("w-28 text-right text-[14.5px] tabular-nums", enquiry.amount > 0 ? "text-paper-moss" : "text-paper-char")}>{money(enquiry.amount, true)}</p>
      </div>

      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) saveNote.mutate({ transactionId: enquiry.transactionId, note: note.trim() });
        }}
      >
        <label className="min-w-0 flex-1 basis-60">
          <span className="sr-only">Note on {label}</span>
          <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="What you found, or who to ask" className={cn(PAPER_INPUT, "w-full")} />
        </label>
        <PaperButton type="submit" variant="ghost" disabled={!changed || saveNote.isPending}>
          Save note
        </PaperButton>
        <PaperButton variant="quiet" disabled={resolve.isPending} onClick={() => resolve.mutate(enquiry.transactionId)}>
          Resolved
        </PaperButton>
      </form>
      <MutationError error={saveNote.error ?? resolve.error} />
    </li>
  );
}
