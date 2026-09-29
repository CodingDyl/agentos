import { useState } from "react";
import { CATEGORIES, type FinanceData } from "@shared/finance-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperSection } from "@/components/paper";
import { useCreateSplitRule, useDeleteSettlement, useDeleteSplitRule, useRecordSettlement, useSavePartner, useStopSharing } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { Figure, Line, MutationError } from "./finance-kit";
import { formatDay, formatMonthShort, money } from "./finance-model";

/**
 * Shared costs.
 *
 * You pay for rent and groceries in full and your partner sends her half.
 * Her payments are not income, and what she still owes you is not savings, so
 * this keeps both out of your own numbers: money she sends lowers what you
 * spent, and money she owes is shown here, apart, until it arrives.
 *
 * Costs with no rule (the wifi, in your case) are yours alone.
 */
export function FinanceSharedTab({ data }: { data: FinanceData }) {
  const { shared } = data;

  if (!shared.partner) return <SetUp month={data.month} />;

  const owed = shared.owedBack;
  const current = shared.months[shared.months.length - 1];

  return (
    <div className="space-y-12">
      <PaperCard className="bg-paper-cream p-5 sm:p-6">
        <Figure
          large
          label={owed >= 0 ? `${shared.partner.name} owes you` : `${shared.partner.name} is ahead by`}
          value={money(Math.abs(owed))}
          note={
            owed > 0
              ? "Money owed to you is not counted as income or savings until it arrives."
              : owed < 0
                ? "She has paid more than her share so far. It carries into next month."
                : "You are level."
          }
        />
        {current ? (
          <dl className="mt-5 grid gap-x-8 sm:grid-cols-3">
            <Line label="Her share this month" value={money(current.herShare)} />
            <Line label="Sent so far" value={money(current.received)} />
            <Line strong label="Still to come" value={money(current.balance)} />
          </dl>
        ) : null}
      </PaperCard>

      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
        <div className="min-w-0 space-y-12">
          <RulesSection data={data} />
          <SettleSection data={data} />
        </div>
        <div className="min-w-0 space-y-12">
          <MonthsSection data={data} />
          <SettingsSection data={data} />
        </div>
      </div>
    </div>
  );
}

function SetUp({ month }: { month: string }) {
  const save = useSavePartner();
  const [name, setName] = useState("");
  const [match, setMatch] = useState("");
  const [since, setSince] = useState(month);
  const valid = name.trim().length > 0 && match.trim().length >= 2 && /^\d{4}-\d{2}$/.test(since);

  return (
    <div className="max-w-2xl">
      <h2 className="font-paper-display text-[19px] font-bold tracking-[-0.01em] text-paper-moss">Split costs with someone</h2>
      <p className="mt-2 text-[14.5px] leading-7 text-paper-char">
        If you pay for something and a partner sends back her share, tell Finance who she is. Her payments then count as money coming back, not as income, and you can see what she still owes you.
      </p>
      <form
        className="mt-6 grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate({ name: name.trim(), match: match.trim(), sinceMonth: since });
        }}
      >
        <label className="block">
          <FieldLabel>Her name</FieldLabel>
          <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Sam" className={`${PAPER_INPUT} w-full`} maxLength={60} />
        </label>
        <label className="block">
          <FieldLabel>How her payments show on your statement</FieldLabel>
          <input required value={match} onChange={(event) => setMatch(event.target.value)} placeholder="SAM JONES" className={`${PAPER_INPUT} w-full`} maxLength={60} />
        </label>
        <label className="block">
          <FieldLabel>Start counting from</FieldLabel>
          <input required type="month" value={since} onChange={(event) => setSince(event.target.value)} className={`${PAPER_INPUT} w-full`} />
        </label>
        <p className="text-[12.5px] leading-5 text-paper-sage sm:col-span-2">
          Finance looks for that word in money arriving in your accounts. Use what your bank shows, such as her name or her reference. Months before the start are ignored, so an old balance is not swept in.
        </p>
        <div className="sm:col-span-2">
          <PaperButton variant="amber" type="submit" disabled={!valid || save.isPending}>
            {save.isPending ? "Saving…" : "Start tracking"}
          </PaperButton>
          <MutationError error={save.error} />
        </div>
      </form>
    </div>
  );
}

function RulesSection({ data }: { data: FinanceData }) {
  const { shared } = data;
  const create = useCreateSplitRule();
  const remove = useDeleteSplitRule();
  const [adding, setAdding] = useState(shared.rules.length === 0);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"category" | "merchant">("merchant");
  const [value, setValue] = useState("");
  const [share, setShare] = useState("50");

  const sharePct = Number(share);
  const valid = label.trim().length > 0 && value.trim().length > 0 && Number.isFinite(sharePct) && sharePct >= 1 && sharePct <= 100;

  return (
    <PaperSection label="What she shares" count={shared.rules.length}>
      {shared.rules.length === 0 ? (
        <p className="mb-4 max-w-[60ch] text-[14px] leading-6 text-paper-char">Add each cost she shares. For rent: a payment containing “rent”, her share 50%. For groceries: the Groceries category, 50%. Anything without a rule, like the wifi, is yours alone.</p>
      ) : (
        <ul className="mb-4 divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
          {shared.rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <p className="min-w-0 text-[14.5px] text-paper-moss">
                {rule.label}
                <span className="ml-2 text-[12.5px] text-paper-sage">
                  {rule.kind === "category" ? `everything in ${rule.value}` : `payments containing “${rule.value}”`} · she pays {Math.round(rule.share * 100)}%
                </span>
              </p>
              <PaperButton disabled={remove.isPending} onClick={() => remove.mutate(rule.id)} aria-label={`Remove ${rule.label}`}>
                Remove
              </PaperButton>
            </li>
          ))}
        </ul>
      )}
      <MutationError error={remove.error} />

      {adding ? (
        <form
          className="grid gap-4 rounded-[4px] bg-paper-cream p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) create.mutate({ label: label.trim(), kind, value: value.trim(), share: sharePct / 100 }, { onSuccess: () => { setLabel(""); setValue(""); setShare("50"); setAdding(false); } });
          }}
        >
          <label className="block">
            <FieldLabel>Name</FieldLabel>
            <input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Rent" className={`${PAPER_INPUT} w-full`} maxLength={60} />
          </label>
          <label className="block">
            <FieldLabel>Find it by</FieldLabel>
            <select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setValue(""); }} className={`${PAPER_INPUT} w-full`}>
              <option value="merchant">A word in the payment</option>
              <option value="category">A whole category</option>
            </select>
          </label>
          <label className="block">
            <FieldLabel>{kind === "category" ? "Category" : "Word"}</FieldLabel>
            {kind === "category" ? (
              <select required value={value} onChange={(event) => setValue(event.target.value)} className={`${PAPER_INPUT} w-full`}>
                <option value="">Choose…</option>
                {CATEGORIES.filter((entry) => entry !== "Income" && entry !== "Transfer" && entry !== "Reimbursement").map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            ) : (
              <input required value={value} onChange={(event) => setValue(event.target.value)} placeholder="rent" className={`${PAPER_INPUT} w-full`} maxLength={60} />
            )}
          </label>
          <label className="block">
            <FieldLabel>Her share (%)</FieldLabel>
            <input required type="number" min={1} max={100} step="any" inputMode="decimal" value={share} onChange={(event) => setShare(event.target.value)} className={`${PAPER_INPUT} w-full`} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <PaperButton variant="ghost" type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? "Adding…" : "Add"}
            </PaperButton>
            {shared.rules.length > 0 ? <PaperButton onClick={() => setAdding(false)}>Cancel</PaperButton> : null}
          </div>
          <div className="sm:col-span-2">
            <MutationError error={create.error} />
          </div>
        </form>
      ) : (
        <PaperButton variant="ghost" onClick={() => setAdding(true)}>
          Add another
        </PaperButton>
      )}
    </PaperSection>
  );
}

function MonthsSection({ data }: { data: FinanceData }) {
  const { shared } = data;
  return (
    <PaperSection label="Month by month">
      {shared.months.length === 0 ? (
        <p className="text-[14px] leading-6 text-paper-char">Nothing to show yet.</p>
      ) : (
        <ul className="space-y-4">
          {[...shared.months].reverse().map((entry) => (
            <li key={entry.month}>
              <PaperCard className="p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-paper-display text-[16px] font-bold text-paper-moss">
                    {formatMonthShort(entry.month)}
                    {entry.month === data.month ? <span className="ml-2 font-paper-ui text-[12.5px] font-normal text-paper-sage">so far</span> : null}
                  </p>
                  <p className={cn("text-[14.5px] font-semibold tabular-nums", entry.balance > 0 ? "text-paper-moss" : "text-paper-char")}>
                    {entry.balance > 0 ? `${money(entry.balance)} owed` : entry.balance < 0 ? `${money(-entry.balance)} ahead` : "Settled"}
                  </p>
                </div>
                <dl className="mt-2 divide-y divide-paper-stone">
                  {entry.rows.map((row) => (
                    <Line key={row.ruleId} label={`${row.label}: you paid ${money(row.paid)}`} value={`her share ${money(row.herShare)}`} />
                  ))}
                  <Line label="She sent" value={money(entry.received)} />
                </dl>
              </PaperCard>
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

function SettleSection({ data }: { data: FinanceData }) {
  const { shared } = data;
  const record = useRecordSettlement();
  const remove = useDeleteSettlement();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <PaperSection label="What she has sent">
      {shared.payments.length === 0 ? (
        <p className="mb-4 text-[14px] leading-6 text-paper-char">
          No payments from {shared.partner?.name} found yet. Finance looks for “{shared.partner?.match}” in money arriving. If her payments show differently, change the name Finance looks for below, or record them by hand.
        </p>
      ) : (
        <ul className="mb-4 divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
          {shared.payments.map((payment) => (
            <li key={`${payment.date}-${payment.description}-${payment.amount}`} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-[14px]">
              <span className="min-w-0 truncate text-paper-moss">
                {payment.description}
                <span className="ml-2 text-[12.5px] text-paper-sage">{formatDay(payment.date)}</span>
              </span>
              <span className="shrink-0 tabular-nums text-paper-char">{money(payment.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {shared.settlements.length > 0 ? (
        <ul className="mb-4 divide-y divide-paper-stone rounded-[4px] border border-paper-mist">
          {shared.settlements.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]">
              <span className="min-w-0 truncate text-paper-moss">
                Recorded by you: {money(entry.amount)}
                <span className="ml-2 text-[12.5px] text-paper-sage">{formatMonthShort(entry.month)}{entry.note ? ` · ${entry.note}` : ""}</span>
              </span>
              <PaperButton disabled={remove.isPending} onClick={() => remove.mutate(entry.id)} aria-label="Remove this recorded payment">
                Remove
              </PaperButton>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) record.mutate({ amount: value, note: note.trim() || undefined }, { onSuccess: () => { setAmount(""); setNote(""); } });
        }}
      >
        <label className="block">
          <FieldLabel>She paid another way (R)</FieldLabel>
          <input type="number" min={1} step="any" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={`${PAPER_INPUT} w-36`} />
        </label>
        <label className="block">
          <FieldLabel>Note (optional)</FieldLabel>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Cash" className={`${PAPER_INPUT} w-44`} maxLength={120} />
        </label>
        <PaperButton variant="ghost" type="submit" disabled={!valid || record.isPending}>
          Record
        </PaperButton>
      </form>
      <MutationError error={record.error} />
    </PaperSection>
  );
}

function SettingsSection({ data }: { data: FinanceData }) {
  const save = useSavePartner();
  const stop = useStopSharing();
  const partner = data.shared.partner;
  const [match, setMatch] = useState(partner?.match ?? "");
  const [since, setSince] = useState(partner?.sinceMonth ?? data.month);
  if (!partner) return null;

  return (
    <PaperSection label="How she is found">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (match.trim().length >= 2) save.mutate({ name: partner.name, match: match.trim(), sinceMonth: since });
        }}
      >
        <label className="block">
          <FieldLabel>Word in her payments</FieldLabel>
          <input value={match} onChange={(event) => setMatch(event.target.value)} className={`${PAPER_INPUT} w-48`} maxLength={60} />
        </label>
        <label className="block">
          <FieldLabel>Counting from</FieldLabel>
          <input type="month" value={since} onChange={(event) => setSince(event.target.value)} className={`${PAPER_INPUT} w-40`} />
        </label>
        <PaperButton variant="ghost" type="submit" disabled={save.isPending}>
          Save
        </PaperButton>
      </form>
      <MutationError error={save.error} />
      <p className="mt-3 max-w-[60ch] text-[12.5px] leading-5 text-paper-sage">
        A payment she sends for something else can be moved out of this: change its category on the Spending tab. Only money arriving that matches her, or that you filed as a Reimbursement, counts.
      </p>
      <div className="mt-5 border-t border-paper-stone pt-4">
        <PaperButton
          disabled={stop.isPending}
          onClick={() => {
            if (window.confirm(`Stop splitting costs with ${partner.name}? This removes her rules and any payments you recorded by hand.`)) stop.mutate();
          }}
        >
          Stop splitting costs
        </PaperButton>
        <MutationError error={stop.error} />
      </div>
    </PaperSection>
  );
}
