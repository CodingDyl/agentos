import { Plus } from "lucide-react";
import { useState } from "react";
import type { BillStatus, BillSuggestion, FinanceData } from "@shared/finance-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useCreateBill, useDeleteBill, useMarkBillPaid, useUnmarkBillPaid, useUpdateBill } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { Figure, MutationError } from "./finance-kit";
import { PayBadge } from "./finance-badges";
import { CloseButton, FoldCard, FoldControls } from "./finance-fold";
import { CATEGORY_CHOICES, formatDay, formatMonthShort, money } from "./finance-model";
import { useDismiss, useFold } from "./finance-ui-hooks";

/**
 * Bills: the fixed things you pay every month. Rent, water and electricity,
 * wifi, whatever leaves your account on a date.
 *
 * You say what each is and about what it costs. Finance looks for the payment
 * each month and tells you if it went, what it cost against what you expected,
 * and if it has not turned up. "Not seen yet" is deliberate wording: a payment
 * can lag, or leave from an account Finance cannot see, and you can mark those
 * paid yourself.
 */

const GROUPS: readonly { status: BillStatus["status"]; label: string }[] = [
  { status: "missing", label: "Not seen yet" },
  { status: "due-soon", label: "Due soon" },
  { status: "upcoming", label: "Coming up" },
  { status: "paid", label: "Paid this month" },
];

export function FinanceBillsTab({ data }: { data: FinanceData }) {
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<BillSuggestion | undefined>();
  const { bills } = data;
  const sample = data.source.kind === "sample";
  // What needs attention starts open: not seen, or due within days. Paid and far-off bills start folded.
  const fold = useFold(
    bills.items.map((bill) => bill.id),
    (id) => {
      const bill = bills.items.find((entry) => entry.id === id);
      return bill?.status === "missing" || bill?.status === "due-soon" || bills.items.length <= 3;
    },
  );

  return (
    <div className="space-y-12">
      {/* The button stays put while the form is open, so closing the form can hand focus back to it. */}
      <PaperButton variant="amber" onClick={() => setAdding(true)} aria-expanded={adding} disabled={adding}>
        <Plus className="size-3.5" aria-hidden="true" />
        Add a bill
      </PaperButton>

      {adding ? (
        <PaperCard className="max-w-2xl p-5">
          <BillForm
            initial={prefill ? { name: prefill.merchant, amount: prefill.amount, dueDay: prefill.dueDay, category: prefill.category, match: prefill.merchant } : undefined}
            onDone={() => {
              setAdding(false);
              setPrefill(undefined);
            }}
          />
        </PaperCard>
      ) : null}

      {bills.items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-none border border-paper-mist bg-paper-mist lg:grid-cols-4">
          {[
            { label: "Bills each month", value: money(bills.committedMonthly), note: `${bills.items.length} tracked` },
            { label: "Paid so far", value: money(bills.paidThisMonth) },
            { label: "Still to come", value: money(bills.remaining) },
            { label: "Share of income", value: bills.incomeShare === undefined ? "-" : `${Math.round(bills.incomeShare * 100)}%`, note: "Under 40% is comfortable" },
          ].map((cell) => (
            <li key={cell.label} className="bg-paper-white p-4">
              <Figure label={cell.label} value={cell.value} note={cell.note} />
            </li>
          ))}
        </ul>
      ) : null}

      {bills.items.length === 0 && !adding ? (
        <p className="max-w-[62ch] text-[14px] leading-6 text-paper-char">
          No bills tracked yet. Add the fixed things you pay each month, such as rent, water and electricity, and wifi. Give each an amount and a due day, and Finance checks every month that it went, and what it cost.
        </p>
      ) : null}

      {bills.suggestions.length > 0 && !sample ? (
        <PaperSection label="Found in your payments" count={bills.suggestions.length}>
          <p className="mb-3 max-w-[62ch] text-[14px] leading-6 text-paper-char">These leave your account on a regular rhythm and you are not tracking them yet.</p>
          <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
            {bills.suggestions.map((suggestion) => (
              <li key={suggestion.merchant} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <p className="min-w-0 text-[14.5px] text-paper-moss">
                  {suggestion.merchant}
                  <span className="ml-2 text-[12.5px] text-paper-sage">
                    {money(suggestion.amount)} · around the {suggestion.dueDay}
                    {ordinal(suggestion.dueDay)} · {suggestion.category}
                  </span>
                </p>
                <PaperButton
                  variant="ghost"
                  onClick={() => {
                    setPrefill(suggestion);
                    setAdding(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Track this
                </PaperButton>
              </li>
            ))}
          </ul>
        </PaperSection>
      ) : null}

      {GROUPS.map((group) => {
        const items = bills.items.filter((bill) => bill.status === group.status).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        if (items.length === 0) return null;
        return (
          <PaperSection
            key={group.status}
            label={group.label}
            count={items.length}
            action={<FoldControls count={items.length} allOpen={items.every((bill) => fold.isOpen(bill.id))} onSetAll={(open) => fold.setAll(open, items.map((bill) => bill.id))} />}
          >
            <ul className="space-y-3">
              {items.map((bill) => (
                <li key={bill.id}>
                  <BillCard bill={bill} open={fold.isOpen(bill.id)} onToggle={() => fold.toggle(bill.id)} readOnly={sample && bill.id.startsWith("sample-")} />
                </li>
              ))}
            </ul>
          </PaperSection>
        );
      })}
    </div>
  );
}

const ordinal = (day: number) => (day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th");

const BILL_PAY = { paid: "paid", "due-soon": "due", upcoming: "due", missing: "late" } as const;

function BillCard({ bill, open, onToggle, readOnly }: { bill: BillStatus; open: boolean; onToggle: () => void; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const mark = useMarkBillPaid();
  const unmark = useUnmarkBillPaid();
  const remove = useDeleteBill();

  if (editing) {
    return (
      <PaperCard className="p-5">
        <BillForm bill={bill} onDone={() => setEditing(false)} />
      </PaperCard>
    );
  }

  const seen = bill.history.some((entry) => entry.amount !== undefined);
  const dear = bill.variance !== undefined && bill.variance > 0 && bill.variance / bill.amount >= 0.05;
  const state = BILL_PAY[bill.status];
  const badge =
    bill.status === "paid"
      ? `${bill.marked ? "Marked paid" : "Paid"}${bill.paidOn ? ` ${formatDay(bill.paidOn)}` : ""}`
      : bill.status === "missing"
        ? "Not seen yet"
        : bill.daysUntil === 0
          ? "Due today"
          : bill.daysUntil < 0
            ? `Was due ${formatDay(bill.dueDate)}`
            : `Due ${formatDay(bill.dueDate)}`;

  return (
    <FoldCard
      open={open}
      onToggle={onToggle}
      accent={bill.status === "paid" ? "green" : bill.status === "missing" ? "flame" : bill.status === "due-soon" ? "amber" : "none"}
      title={bill.name}
      meta={
        <>
          <PayBadge state={state}>{badge}</PayBadge>
          <Tag>{bill.category}</Tag>
          <span>
            due the {bill.dueDay}
            {ordinal(bill.dueDay)}
          </span>
        </>
      }
      figure={
        <>
          <span className="block font-paper-display text-[20px] leading-6 font-extrabold tracking-[-0.02em] text-paper-moss tabular-nums">{money(bill.paidAmount ?? bill.amount)}</span>
          <span className="block text-[12px] text-paper-sage tabular-nums">{bill.paidAmount === undefined ? "expected" : bill.variance !== undefined && Math.abs(bill.variance) >= 1 ? `expected ${money(bill.amount)}` : "as expected"}</span>
        </>
      }
    >
      <p className={cn("text-[14.5px] leading-6", bill.status === "missing" ? "font-semibold text-paper-flame-deep" : "text-paper-moss")} role="status">
        {bill.status === "paid" ? (
          <>
            {bill.marked ? "Marked paid" : "Paid"} {money(bill.paidAmount ?? 0)}
            {bill.paidOn ? ` on ${formatDay(bill.paidOn)}` : ""}.
            {bill.variance !== undefined && Math.abs(bill.variance) >= 1 ? (
              <span className={cn("ml-1", dear ? "font-semibold text-paper-flame-deep" : "text-paper-char")}>
                {bill.variance > 0 ? `${money(bill.variance)} more` : `${money(-bill.variance)} less`} than expected.
              </span>
            ) : null}
          </>
        ) : bill.status === "missing" ? (
          `Not seen yet. It was due ${formatDay(bill.dueDate)}. It may just be late, or paid from somewhere Finance cannot see.`
        ) : bill.daysUntil === 0 ? (
          "Due today."
        ) : bill.daysUntil < 0 ? (
          `Was due ${formatDay(bill.dueDate)}; not seen yet.`
        ) : (
          `Due ${formatDay(bill.dueDate)}, in ${bill.daysUntil} ${bill.daysUntil === 1 ? "day" : "days"}.`
        )}
      </p>
      {bill.match ? <p className="mt-1 text-[12.5px] text-paper-sage">Looks for “{bill.match}” in your payments.</p> : null}

      {seen ? (
        <div className="mt-3">
          <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">Last months</p>
          <ul className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[13.5px] tabular-nums">
            {bill.history.map((entry) => (
              <li key={entry.month} className="text-paper-char">
                <span className="text-paper-sage">{formatMonthShort(entry.month)} </span>
                {entry.amount === undefined ? "-" : money(entry.amount)}
              </li>
            ))}
            {bill.average !== undefined ? <li className="font-semibold text-paper-moss">Average {money(bill.average)}</li> : null}
          </ul>
        </div>
      ) : null}

      {!readOnly ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {bill.status !== "paid" ? (
            <PaperButton variant="ghost" disabled={mark.isPending} onClick={() => mark.mutate({ billId: bill.id })} title="For a bill paid in cash or from an account Finance cannot see">
              Mark paid
            </PaperButton>
          ) : bill.marked ? (
            <PaperButton disabled={unmark.isPending} onClick={() => unmark.mutate(bill.id)}>
              Undo mark
            </PaperButton>
          ) : null}
          <PaperButton variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </PaperButton>
          <PaperButton
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Stop tracking “${bill.name}”?`)) remove.mutate(bill.id);
            }}
          >
            Remove
          </PaperButton>
        </div>
      ) : (
        <p className="mt-4 text-[12.5px] text-paper-sage">A sample bill. Add your own to track real ones.</p>
      )}
      <MutationError error={mark.error ?? unmark.error ?? remove.error} />
    </FoldCard>
  );
}

interface BillFormInitial {
  name: string;
  amount: number;
  dueDay: number;
  category: BillStatus["category"];
  match?: string;
}

function BillForm({ bill, initial, onDone }: { bill?: BillStatus; initial?: BillFormInitial; onDone: () => void }) {
  const create = useCreateBill();
  const update = useUpdateBill();
  const start = bill ?? initial;

  const [name, setName] = useState(start?.name ?? "");
  const [amount, setAmount] = useState(start?.amount === undefined ? "" : String(start.amount));
  const [dueDay, setDueDay] = useState(start?.dueDay === undefined ? "" : String(start.dueDay));
  const [category, setCategory] = useState<BillStatus["category"]>(start?.category ?? "Housing");
  const [match, setMatch] = useState(start?.match ?? "");

  const amountValue = Number(amount);
  const dayValue = Number(dueDay);
  const valid = name.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0 && Number.isInteger(dayValue) && dayValue >= 1 && dayValue <= 31;
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  useDismiss(onDone);

  return (
    <form
      aria-label={bill ? `Edit ${bill.name}` : "New bill"}
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        if (bill) {
          update.mutate({ billId: bill.id, patch: { name: name.trim(), amount: amountValue, dueDay: dayValue, category, match: match.trim() === "" ? null : match.trim() } }, { onSuccess: onDone });
        } else {
          create.mutate({ name: name.trim(), amount: amountValue, dueDay: dayValue, category, match: match.trim() === "" ? undefined : match.trim() }, { onSuccess: onDone });
        }
      }}
    >
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <h2 className="font-paper-display text-[17px] font-bold text-paper-moss">{bill ? `Edit ${bill.name}` : "New bill"}</h2>
        <CloseButton label={bill ? `Close editing ${bill.name}` : "Close the new bill form"} onClick={onDone} showLabel />
      </div>
      <label className="block sm:col-span-2">
        <FieldLabel>What is it?</FieldLabel>
        <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Rent, Water and electricity, Wifi" className={`${PAPER_INPUT} w-full`} maxLength={60} />
      </label>
      <label className="block">
        <FieldLabel>Usual amount (R)</FieldLabel>
        <input required type="number" min={1} step="any" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={`${PAPER_INPUT} w-full`} />
      </label>
      <label className="block">
        <FieldLabel>Due day of the month</FieldLabel>
        <input required type="number" min={1} max={31} step={1} inputMode="numeric" value={dueDay} onChange={(event) => setDueDay(event.target.value)} className={`${PAPER_INPUT} w-full`} />
      </label>
      <label className="block">
        <FieldLabel>Category</FieldLabel>
        <select value={category} onChange={(event) => setCategory(event.target.value as BillStatus["category"])} className={`${PAPER_INPUT} w-full`}>
          {CATEGORY_CHOICES.filter((entry) => entry !== "Income" && entry !== "Transfer" && entry !== "Reimbursement").map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <FieldLabel>Word to look for in the payment (optional)</FieldLabel>
        <input value={match} onChange={(event) => setMatch(event.target.value)} placeholder={name.trim() || "Defaults to the name"} className={`${PAPER_INPUT} w-full`} maxLength={60} />
      </label>
      <p className="text-[12.5px] leading-5 text-paper-sage sm:col-span-2">
        Finance looks for a payment out of your accounts containing that word each month, as a whole word. For water and electricity use what your bank shows, such as the municipality's name. A bill paid another way can be marked paid by hand.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <PaperButton variant="ghost" type="submit" disabled={!valid || pending}>
          {pending ? "Saving…" : bill ? "Save" : "Add bill"}
        </PaperButton>
        <PaperButton onClick={onDone}>Cancel</PaperButton>
      </div>
      <div className="sm:col-span-2">
        <MutationError error={error} />
      </div>
    </form>
  );
}
