import { useRef, useState } from "react";
import type { FinanceData, FinancialAccount } from "@shared/finance-types";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useCreateAccount, useDeleteAccount, useImportStatement, useUpdateAccount, type StatementImportResult } from "@/lib/agentos/finance";
import { cn } from "@/lib/utils";
import { Line, MutationError } from "./finance-kit";
import { money } from "./finance-model";

/**
 * Accounts: what Investec reports, and the ones you add yourself.
 *
 * Discovery has no public API, so a card there is an account you add, with its
 * statement read in from a CSV you download. The file is sent to your own
 * AgentOS server and read there; it is not uploaded anywhere else.
 */

const TYPE_LABEL: Record<FinancialAccount["type"], string> = { current: "Current", savings: "Savings", credit: "Card or loan", investment: "Investment" };

export function AccountsSection({ data }: { data: FinanceData }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | undefined>();
  const sample = data.source.kind === "sample";

  return (
    <PaperSection
      label="Accounts"
      count={data.accounts.length}
      action={
        <PaperButton variant="ghost" onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
          {adding ? "Cancel" : "Add an account"}
        </PaperButton>
      }
    >
      {adding ? <AddAccountForm onDone={() => setAdding(false)} /> : null}

      <ul className="divide-y divide-paper-stone">
        {data.accounts.map((account) => (
          <li key={account.id} className="py-2.5">
            <div className="flex items-baseline justify-between gap-4">
              <p className="min-w-0 text-[14px] text-paper-moss">
                {account.name}
                <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle">
                  <Tag>{TYPE_LABEL[account.type]}</Tag>
                  {account.provider === "manual" ? <Tag tone="marigold">You added</Tag> : null}
                  {account.mask ? <span className="text-[12px] text-paper-sage">•••• {account.mask}</span> : null}
                </span>
              </p>
              <p className={cn("shrink-0 text-[14px] tabular-nums", account.balance < 0 ? "text-paper-flame-deep" : "text-paper-moss")}>{account.type === "credit" && account.balance < 0 ? `${money(-account.balance)} owed` : money(account.balance)}</p>
            </div>
            {!sample && (account.provider === "manual" || account.type === "credit") ? (
              <button
                type="button"
                onClick={() => setOpen(open === account.id ? undefined : account.id)}
                aria-expanded={open === account.id}
                className="mt-1 cursor-pointer rounded-[4px] text-[12.5px] text-paper-sage hover:text-paper-moss focus-visible:outline-2 focus-visible:outline-paper-blue"
              >
                {open === account.id ? "Close" : "Manage"}
              </button>
            ) : null}
            {open === account.id ? <ManageAccount account={account} /> : null}
          </li>
        ))}
      </ul>

      {sample ? <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">These are sample accounts. Add your own and the sample is replaced.</p> : null}
      <dl className="mt-1 border-t border-paper-mist pt-1">
        <Line strong label="Net cash" value={money(data.netCash)} />
      </dl>
    </PaperSection>
  );
}

function AddAccountForm({ onDone }: { onDone: () => void }) {
  const create = useCreateAccount();
  const [name, setName] = useState("");
  const [type, setType] = useState<FinancialAccount["type"]>("credit");
  const [balance, setBalance] = useState("");
  const [rate, setRate] = useState("");
  const [limit, setLimit] = useState("");

  const balanceValue = Number(balance);
  const rateValue = rate.trim() === "" ? undefined : Number(rate) / 100;
  const limitValue = limit.trim() === "" ? undefined : Number(limit);
  const valid =
    name.trim().length > 0 &&
    balance.trim() !== "" &&
    Number.isFinite(balanceValue) &&
    balanceValue >= 0 &&
    (rateValue === undefined || (Number.isFinite(rateValue) && rateValue >= 0 && rateValue <= 1)) &&
    (limitValue === undefined || (Number.isFinite(limitValue) && limitValue >= 0));

  return (
    <form
      className="mb-6 grid gap-4 rounded-[4px] bg-paper-cream p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) create.mutate({ name: name.trim(), type, balance: balanceValue, interestRate: type === "credit" ? rateValue : undefined, creditLimit: type === "credit" ? limitValue : undefined }, { onSuccess: onDone });
      }}
    >
      <label className="block sm:col-span-2">
        <FieldLabel>Name</FieldLabel>
        <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Discovery credit card" className={`${PAPER_INPUT} w-full`} maxLength={80} />
      </label>
      <label className="block">
        <FieldLabel>Type</FieldLabel>
        <select value={type} onChange={(event) => setType(event.target.value as FinancialAccount["type"])} className={`${PAPER_INPUT} w-full`}>
          {(Object.keys(TYPE_LABEL) as FinancialAccount["type"][]).map((entry) => (
            <option key={entry} value={entry}>
              {TYPE_LABEL[entry]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <FieldLabel>{type === "credit" ? "Amount you owe now (R)" : "Balance now (R)"}</FieldLabel>
        <input required type="number" min={0} step="any" inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} className={`${PAPER_INPUT} w-full`} />
      </label>
      {type === "credit" ? (
        <>
          <label className="block">
            <FieldLabel>Interest rate (% a year)</FieldLabel>
            <input type="number" min={0} max={100} step="0.1" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="From your statement" className={`${PAPER_INPUT} w-full`} />
          </label>
          <label className="block">
            <FieldLabel>Credit limit (R)</FieldLabel>
            <input type="number" min={0} step="any" inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} className={`${PAPER_INPUT} w-full`} />
          </label>
        </>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <PaperButton variant="ghost" type="submit" disabled={!valid || create.isPending}>
          {create.isPending ? "Adding…" : "Add account"}
        </PaperButton>
      </div>
      <p className="text-[12.5px] leading-5 text-paper-sage sm:col-span-2">Add the rate from your statement if you can. Without it the cost of a balance is understated, and the analyser says so.</p>
      <div className="sm:col-span-2">
        <MutationError error={create.error} />
      </div>
    </form>
  );
}

function ManageAccount({ account }: { account: FinancialAccount }) {
  const update = useUpdateAccount();
  const remove = useDeleteAccount();
  const importer = useImportStatement();
  const file = useRef<HTMLInputElement>(null);
  const [balance, setBalance] = useState(String(Math.abs(account.balance)));
  const [rate, setRate] = useState(account.interestRate === undefined ? "" : String(+(account.interestRate * 100).toFixed(2)));
  const [limit, setLimit] = useState(account.creditLimit === undefined ? "" : String(account.creditLimit));
  const [sign, setSign] = useState<"auto" | "positive-is-out" | "positive-is-in">("auto");
  const [result, setResult] = useState<StatementImportResult | undefined>();

  const manual = account.provider === "manual";
  const credit = account.type === "credit";

  const save = () =>
    update.mutate({
      accountId: account.id,
      patch: {
        ...(manual ? { balance: Number(balance) } : {}),
        ...(credit ? { interestRate: rate.trim() === "" ? null : Number(rate) / 100, creditLimit: limit.trim() === "" ? null : Number(limit) } : {}),
      },
    });

  return (
    <div className="mt-3 space-y-4 rounded-[4px] bg-paper-cream p-4">
      <div className="flex flex-wrap items-end gap-3">
        {manual ? (
          <label className="block">
            <FieldLabel>{credit ? "Amount you owe (R)" : "Balance (R)"}</FieldLabel>
            <input type="number" min={0} step="any" inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} className={`${PAPER_INPUT} w-36`} />
          </label>
        ) : null}
        {credit ? (
          <>
            <label className="block">
              <FieldLabel>Interest (% a year)</FieldLabel>
              <input type="number" min={0} max={100} step="0.1" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} className={`${PAPER_INPUT} w-32`} />
            </label>
            <label className="block">
              <FieldLabel>Limit (R)</FieldLabel>
              <input type="number" min={0} step="any" inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} className={`${PAPER_INPUT} w-36`} />
            </label>
          </>
        ) : null}
        <PaperButton variant="ghost" disabled={update.isPending} onClick={save}>
          Save
        </PaperButton>
      </div>
      <MutationError error={update.error} />

      {manual ? (
        <div className="border-t border-paper-stone pt-4">
          <p className="text-[12.5px] font-semibold tracking-[0.08em] text-paper-sage uppercase">Import a statement</p>
          <p className="mt-1 max-w-[62ch] text-[13.5px] leading-6 text-paper-char">
            Download a CSV statement from your bank and choose it here. It needs a date, a description, and an amount (or debit and credit columns). Importing the same file twice changes nothing.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <FieldLabel>Amounts in the file</FieldLabel>
              <select value={sign} onChange={(event) => setSign(event.target.value as typeof sign)} className={`${PAPER_INPUT} w-64`}>
                <option value="auto">Work it out</option>
                <option value="positive-is-out">Positive means money spent</option>
                <option value="positive-is-in">Positive means money received</option>
              </select>
            </label>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              aria-label={`Statement CSV for ${account.name}`}
              onChange={async (event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (!chosen) return;
                setResult(undefined);
                importer.mutate({ accountId: account.id, text: await chosen.text(), sign }, { onSuccess: setResult });
              }}
            />
            <PaperButton variant="ghost" disabled={importer.isPending} onClick={() => file.current?.click()}>
              {importer.isPending ? "Reading…" : "Choose CSV"}
            </PaperButton>
          </div>
          {result ? (
            <div role="status" className="mt-3 text-[13.5px] leading-6 text-paper-char">
              <p className="font-semibold text-paper-moss">
                {result.added} added{result.alreadyHad > 0 ? `, ${result.alreadyHad} already there` : ""}
                {result.skipped > 0 ? `, ${result.skipped} rows skipped` : ""}.
              </p>
              {result.from && result.to ? <p>From {result.from} to {result.to}.</p> : null}
              {result.signNote ? <p>{result.signNote}</p> : null}
            </div>
          ) : null}
          <MutationError error={importer.error} />

          <div className="mt-4 border-t border-paper-stone pt-3">
            <PaperButton
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove “${account.name}” and the payments imported into it?`)) remove.mutate(account.id);
              }}
            >
              Remove this account
            </PaperButton>
            <MutationError error={remove.error} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
