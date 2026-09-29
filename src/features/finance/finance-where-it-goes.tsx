import { useState } from "react";
import { CATEGORY_GROUP, type CategoryTotal, type FinanceData } from "@shared/finance-types";
import { Meter, PAPER_INPUT, PaperButton, PaperSection } from "@/components/paper";
import { useSaveBudget } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { MutationError } from "./finance-kit";
import { formatChange, money } from "./finance-model";

/**
 * Understanding where the money goes, three ways: a split of income into
 * needs, wants and what was kept; the categories you can open to see which
 * merchants they are made of; and a monthly limit you can set on any of them.
 */

const GROUPS = [
  { key: "needs", label: "Needs", note: "Housing, utilities, groceries, transport, debt, health, insurance, education, fees" },
  { key: "wants", label: "Wants", note: "Dining, subscriptions, entertainment, shopping, personal care, travel, giving" },
  { key: "business", label: "Business", note: "Costs of running your business" },
  { key: "unsorted", label: "Unsorted", note: "Payments with no category yet" },
] as const;

/** The 50/30/20 rule of thumb is a starting point people quote, not a target that suits everyone. */
const RULE_OF_THUMB = { needs: 0.5, wants: 0.3, saved: 0.2 };

export function IncomeSplit({ data }: { data: FinanceData }) {
  const { split } = data;
  const income = split.income;

  if (income <= 0) {
    return (
      <PaperSection label="Where your income went">
        <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">No income has arrived this month yet, so there is nothing to divide.</p>
      </PaperSection>
    );
  }

  const rows = [
    ...GROUPS.map((group) => ({ key: group.key, label: group.label, note: group.note, amount: split[group.key] })),
    { key: "saved", label: "Saved or invested", note: "Income less everything above: kept, moved to savings, or invested", amount: Math.max(0, split.saved) },
  ];
  const overspent = split.saved < 0;

  return (
    <PaperSection label="Where your income went">
      <p className="mb-4 text-[14px] leading-6 text-paper-char">
        Of every R100 that came in this month, here is where it went.
      </p>
      <ul className="space-y-4">
        {rows
          .filter((row) => row.amount > 0 || row.key === "saved" || row.key === "needs" || row.key === "wants")
          .map((row) => {
            const share = row.amount / income;
            const reference = row.key === "needs" ? RULE_OF_THUMB.needs : row.key === "wants" ? RULE_OF_THUMB.wants : row.key === "saved" ? RULE_OF_THUMB.saved : undefined;
            return (
              <li key={row.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[15px] font-medium text-paper-moss" title={row.note}>
                    {row.label}
                  </p>
                  <p className="text-[14px] tabular-nums text-paper-char">
                    <span className="font-semibold text-paper-moss">R{Math.round(share * 100)}</span> of every R100 · {money(row.amount)}
                  </p>
                </div>
                <div className="mt-1.5">
                  <Meter value={share} label={`${row.label}: ${Math.round(share * 100)}% of income`} tone={row.key === "saved" ? "green" : "ink"} />
                </div>
                {reference !== undefined ? <p className="mt-1 text-[12.5px] text-paper-sage">Rule of thumb: about R{Math.round(reference * 100)}</p> : null}
              </li>
            );
          })}
      </ul>
      {overspent ? <p className="mt-4 text-[13.5px] leading-6 font-semibold text-paper-flame-deep">You spent {money(-split.saved)} more than came in this month.</p> : null}
      <p className="mt-4 max-w-[70ch] text-[12.5px] leading-5 text-paper-sage">
        The 50/30/20 split is a common rule of thumb, not a target that suits everyone. Which category counts as a need is a judgement, and a rough one: all of "Groceries" counts as a need, and all of "Dining" as a want.
      </p>
    </PaperSection>
  );
}

export function CategoryList({ data }: { data: FinanceData }) {
  const [open, setOpen] = useState<string | undefined>();

  return (
    <PaperSection label="This month by category">
      {data.categories.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-char">Nothing spent yet this month.</p>
      ) : (
        <ul className="divide-y divide-paper-stone rounded-none border border-paper-mist">
          {data.categories.map((entry) => (
            <CategoryRow key={entry.category} entry={entry} open={open === entry.category} onToggle={() => setOpen(open === entry.category ? undefined : entry.category)} readOnly={data.source.kind === "sample"} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">Open a category to see where it went and to set a monthly limit. Typical is the average of the previous three months.</p>
    </PaperSection>
  );
}

function CategoryRow({ entry, open, onToggle, readOnly }: { entry: CategoryTotal; open: boolean; onToggle: () => void; readOnly: boolean }) {
  const save = useSaveBudget();
  const [draft, setDraft] = useState(entry.budget === undefined ? "" : String(entry.budget));
  const over = entry.budget !== undefined && entry.amount > entry.budget;
  const group = entry.category === "Income" || entry.category === "Transfer" || entry.category === "Reimbursement" ? undefined : CATEGORY_GROUP[entry.category];
  const draftValue = Number(draft);
  const draftValid = draft.trim() !== "" && Number.isFinite(draftValue) && draftValue >= 0 && draftValue !== entry.budget;
  const panelId = `category-${entry.category.replace(/\W+/g, "-")}`;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-paper-cream focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-paper-blue"
      >
        <span className="text-[14.5px] font-medium text-paper-moss">
          <span aria-hidden="true" className="mr-2 inline-block w-3 text-paper-sage">{open ? "▾" : "▸"}</span>
          {entry.category}
          {group ? <span className="ml-2 text-[12px] font-normal text-paper-sage">{group}</span> : null}
        </span>
        <span className="flex items-baseline gap-4 tabular-nums">
          {entry.change !== undefined && Math.abs(entry.change) >= 0.15 ? (
            <span className={cn("text-[12.5px]", entry.change >= 0.3 ? "font-semibold text-paper-flame-deep" : "text-paper-sage")}>{formatChange(entry.change)}</span>
          ) : null}
          <span className={cn("text-[14.5px]", over ? "font-semibold text-paper-flame-deep" : "text-paper-moss")}>
            {money(entry.amount)}
            {entry.budget !== undefined ? <span className="font-normal text-paper-sage"> / {money(entry.budget)}</span> : null}
          </span>
        </span>
      </button>

      {entry.budget !== undefined && entry.budget > 0 ? (
        <div className="px-4 pb-3">
          <Meter value={entry.amount / entry.budget} label={`${entry.category}: ${money(entry.amount)} of a ${money(entry.budget)} budget`} tone={over ? "flame" : "amber"} />
          <p className={cn("mt-1 text-[12.5px]", over ? "font-semibold text-paper-flame-deep" : "text-paper-sage")}>
            {over ? `${money(entry.amount - entry.budget)} over budget` : `${money(entry.budget - entry.amount)} left`}
          </p>
        </div>
      ) : null}

      {open ? (
        <div id={panelId} className="border-t border-paper-stone bg-paper-cream px-4 py-4">
          {entry.merchants.length === 0 ? (
            <p className="text-[13.5px] text-paper-char">Nothing spent here yet.</p>
          ) : (
            <>
              <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">Where it went</p>
              <ul className="mt-2 divide-y divide-paper-stone">
                {entry.merchants.map((merchant) => (
                  <li key={merchant.merchant} className="flex items-baseline justify-between gap-4 py-1.5 text-[14px]">
                    <span className="min-w-0 truncate text-paper-moss">
                      {merchant.merchant}
                      {merchant.payments > 1 ? <span className="ml-2 text-[12.5px] text-paper-sage">{merchant.payments} payments</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-paper-char">
                      {money(merchant.amount)}
                      <span className="ml-2 text-[12.5px] text-paper-sage">{entry.amount > 0 ? `${Math.round((merchant.amount / entry.amount) * 100)}%` : ""}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {entry.typical !== undefined ? <p className="mt-2 text-[12.5px] text-paper-sage">Typically {money(entry.typical)} a month.</p> : null}
            </>
          )}

          {!readOnly ? (
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (draftValid) save.mutate({ category: entry.category, amount: draftValue });
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] font-medium text-paper-char">Monthly budget (R)</span>
                <input type="number" min={0} step="any" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={entry.typical === undefined ? "" : String(Math.round(entry.typical))} className={`${PAPER_INPUT} w-36`} />
              </label>
              <PaperButton variant="ghost" type="submit" disabled={!draftValid || save.isPending}>
                Set budget
              </PaperButton>
              {entry.budget !== undefined ? (
                <PaperButton
                  disabled={save.isPending}
                  onClick={() => {
                    setDraft("");
                    save.mutate({ category: entry.category, amount: null });
                  }}
                >
                  Remove
                </PaperButton>
              ) : null}
            </form>
          ) : (
            <p className="mt-3 text-[12.5px] text-paper-sage">Budgets can be set once Investec is connected.</p>
          )}
          <MutationError error={save.error} />
        </div>
      ) : null}
    </li>
  );
}
