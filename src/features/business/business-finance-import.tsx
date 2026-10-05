import { useMemo, useState } from "react";
import { PaperButton, PaperCard } from "@/components/paper";
import { useFinanceBusinessExpenses, useImportFinanceExpenses } from "@/lib/agentos/business-ledger";
import { money } from "./business-billing-format";

interface FinanceExpenseImportProps {
  entityId: string;
  entityName: string;
  /** Every business, so an expense imported elsewhere can say where. */
  entityNames: ReadonlyMap<string, string>;
  revision: number | undefined;
  onClose: () => void;
  onImported: (count: number) => void;
}

/**
 * Pick Finance transactions marked as business and add them here as paid
 * expenses. Nothing is chosen until the list loads; everything not yet
 * imported starts ticked, and already-imported rows are shown but locked.
 */
export function FinanceExpenseImport({ entityId, entityName, entityNames, revision, onClose, onImported }: FinanceExpenseImportProps) {
  const finance = useFinanceBusinessExpenses(entityId, true);
  const importExpenses = useImportFinanceExpenses(entityId);
  const candidates = useMemo(() => finance.data?.candidates ?? [], [finance.data]);
  const open = useMemo(() => candidates.filter((candidate) => !candidate.importedInto), [candidates]);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());

  const chosen = open.filter((candidate) => !unticked.has(candidate.transactionId));
  const total = chosen.reduce((sum, candidate) => sum + candidate.amountMinor, 0);

  const toggle = (transactionId: string) =>
    setUnticked((current) => {
      const next = new Set(current);
      if (next.has(transactionId)) next.delete(transactionId);
      else next.add(transactionId);
      return next;
    });

  const allTicked = chosen.length === open.length;
  const toggleAll = () => setUnticked(allTicked ? new Set(open.map((candidate) => candidate.transactionId)) : new Set());

  const submit = () => {
    if (revision === undefined || chosen.length === 0) return;
    importExpenses.mutate(
      { revision, transactionIds: chosen.map((candidate) => candidate.transactionId) },
      { onSuccess: () => onImported(chosen.length) },
    );
  };

  return (
    <PaperCard className="mb-5 p-4" role="region" aria-labelledby={`finance-import-${entityId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`finance-import-${entityId}`} className="font-semibold">
            Import business expenses from Finance
          </h3>
          <p className="mt-1 max-w-[75ch] text-sm text-paper-sage">
            Money out that Finance files under Business, or from a merchant you marked as business. Each one is added to {entityName} as a
            paid expense and can only be imported once, into one business.
          </p>
        </div>
        <PaperButton onClick={onClose} disabled={importExpenses.isPending}>
          Close
        </PaperButton>
      </div>

      {finance.isPending ? (
        <p role="status" className="mt-4 text-sm">
          Reading Finance…
        </p>
      ) : finance.error ? (
        <p role="alert" className="mt-4 border border-paper-flame-deep p-3 text-paper-flame-deep">
          {finance.error.message}
        </p>
      ) : !finance.data?.available ? (
        <p className="mt-4 text-sm">{finance.data?.reason}</p>
      ) : candidates.length === 0 ? (
        <p className="mt-4 text-sm">
          Finance has no transactions marked as business. In Finance, move a payment's merchant into the Business category, then come
          back.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            {open.length > 0 ? (
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={allTicked} onChange={toggleAll} />
                Select all {open.length} not yet imported
              </label>
            ) : (
              <span>Everything Finance marks as business is already imported.</span>
            )}
            <span>
              {chosen.length} selected · <strong>{money(total)}</strong>
            </span>
          </div>

          <ul className="mt-3 grid max-h-[420px] gap-1 overflow-y-auto" aria-label="Business transactions in Finance">
            {candidates.map((candidate) => {
              const done = Boolean(candidate.importedInto);
              const where = candidate.importedInto === entityId ? "here" : `into ${entityNames.get(candidate.importedInto ?? "") ?? "another business"}`;
              return (
                <li key={candidate.transactionId}>
                  <label
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 border border-paper-mist px-3 py-2 text-sm ${done ? "opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      disabled={done || importExpenses.isPending}
                      checked={!done && !unticked.has(candidate.transactionId)}
                      onChange={() => toggle(candidate.transactionId)}
                    />
                    <time dateTime={candidate.date} className="w-24 shrink-0 tabular-nums">
                      {candidate.date}
                    </time>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{candidate.merchant}</span>
                      <span className="block truncate text-xs text-paper-sage">
                        {candidate.category}
                        {candidate.description && candidate.description !== candidate.merchant ? ` · ${candidate.description}` : ""}
                      </span>
                    </span>
                    {done ? <span className="text-xs text-paper-sage">Imported {where}</span> : null}
                    <strong className="tabular-nums">{money(candidate.amountMinor)}</strong>
                  </label>
                </li>
              );
            })}
          </ul>

          {importExpenses.error ? (
            <p role="alert" className="mt-3 border border-paper-flame-deep p-3 text-paper-flame-deep">
              {importExpenses.error.message}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PaperButton variant="amber" disabled={chosen.length === 0 || revision === undefined || importExpenses.isPending} onClick={submit}>
              {importExpenses.isPending ? "Importing…" : `Import ${chosen.length} expense${chosen.length === 1 ? "" : "s"}`}
            </PaperButton>
            <p className="text-xs text-paper-sage">
              Imported expenses are posted records: void one with a reason if it should not be here.
            </p>
          </div>
        </>
      )}
    </PaperCard>
  );
}
