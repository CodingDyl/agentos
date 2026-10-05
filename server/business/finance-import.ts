import { createHash } from "node:crypto";
import type { BusinessLedgerRecord } from "../../shared/business-ledger-types";
import type { BusinessEntity } from "../../shared/business-types";
import type { FinanceBusinessExpense, FinanceBusinessExpenses } from "../../shared/business-finance-import";
import type { Transaction } from "../../shared/finance-types";
import { merchantKey } from "../finance/categorise";
import { categorise } from "../finance/engine";
import { correctionMap, readCorrections, readPartner, readTransactions } from "../finance/store";
import { hasRealData } from "../finance/finance";
import { BusinessLedgerError, businessLedgerRecordOwners, mutateBusinessLedger } from "./ledger-store";

/**
 * Finance's business spending, offered to a Business ledger as expenses.
 *
 * Business spend is money out (not a transfer between your own accounts)
 * that Finance files under Business, or whose merchant you marked as
 * business in Finance. Refunds into Business are left out: they are not an
 * expense, and the ledger records amounts as positive.
 *
 * The ledger record id is derived from the Finance transaction id, and ids
 * are unique across every business, so a transaction can only ever be
 * imported once, into one business.
 */

export interface FinanceSource {
  available: () => boolean;
  transactions: () => Transaction[];
  corrections: () => ReadonlyMap<string, import("../../shared/finance-types").Category>;
  businessMerchants: () => ReadonlySet<string>;
  partnerMatch: () => string | undefined;
}

export const financeSource: FinanceSource = {
  available: hasRealData,
  transactions: readTransactions,
  corrections: correctionMap,
  businessMerchants: () =>
    new Set(readCorrections().filter((correction) => correction.scope === "business").map((correction) => merchantKey(correction.merchant))),
  partnerMatch: () => readPartner()?.match,
};

/** The ledger id for a Finance transaction. Stable, so a second import finds the first. */
export function financeExpenseRecordId(transactionId: string): string {
  return `finance-${createHash("sha256").update(transactionId).digest("hex").slice(0, 32)}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Every Finance transaction marked as business spend, newest first, with where it was imported if it was. */
export function financeBusinessExpenses(source: FinanceSource = financeSource): FinanceBusinessExpenses {
  if (!source.available()) {
    return { available: false, reason: "Finance has no real transactions yet. Connect Investec or import a statement in Finance first.", candidates: [] };
  }

  const business = source.businessMerchants();
  const candidates = categorise(source.transactions(), source.corrections(), source.partnerMatch())
    .filter((transaction) => transaction.amount < 0 && !transaction.isTransfer && DAY.test(transaction.date))
    .filter((transaction) => transaction.category === "Business" || business.has(merchantKey(transaction.merchant ?? transaction.description)))
    .map((transaction) => ({
      transactionId: transaction.id,
      date: transaction.date,
      merchant: (transaction.merchant ?? transaction.description).trim().slice(0, 1000) || "Unknown merchant",
      description: transaction.description.trim().slice(0, 500),
      category: transaction.category,
      amountMinor: Math.round(Math.abs(transaction.amount) * 100),
    }))
    .filter((candidate) => candidate.amountMinor > 0);

  const owners = businessLedgerRecordOwners(candidates.map((candidate) => financeExpenseRecordId(candidate.transactionId)));
  return {
    available: true,
    candidates: candidates
      .map((candidate): FinanceBusinessExpense => {
        const importedInto = owners.get(financeExpenseRecordId(candidate.transactionId));
        return importedInto ? { ...candidate, importedInto } : candidate;
      })
      .sort((left, right) => right.date.localeCompare(left.date)),
  };
}

/**
 * Adds the chosen Finance transactions to this business as paid expenses.
 * Only transactions Finance currently marks as business are accepted, and
 * any already imported (here or into another business) are skipped.
 */
export function importFinanceExpenses(
  entity: BusinessEntity,
  input: { revision: number; transactionIds: readonly string[]; requestId?: string },
  source: FinanceSource = financeSource,
) {
  const listed = financeBusinessExpenses(source);
  if (!listed.available) throw new BusinessLedgerError(listed.reason ?? "Finance has no transactions.", 409);

  const wanted = new Set(input.transactionIds);
  const chosen = listed.candidates.filter((candidate) => wanted.has(candidate.transactionId));
  if (chosen.length < wanted.size) {
    throw new BusinessLedgerError("Some of those transactions are no longer marked as business in Finance. Refresh and try again.", 422);
  }
  const fresh = chosen.filter((candidate) => !candidate.importedInto);
  if (fresh.length === 0) throw new BusinessLedgerError("Those expenses were already imported.", 409);

  const records: BusinessLedgerRecord[] = fresh.map((candidate) => {
    const id = financeExpenseRecordId(candidate.transactionId);
    return {
      id,
      entityId: entity.id,
      source: "agentos",
      sourceId: id,
      kind: "expense",
      vendor: candidate.merchant,
      category: candidate.category,
      currency: "ZAR",
      amountMinor: candidate.amountMinor,
      paidOn: candidate.date,
      reference: candidate.description || undefined,
      locallyEdited: true,
      // Kept for reconciliation: which Finance transaction this came from. No account numbers.
      sourceRecord: { origin: "finance", transactionId: candidate.transactionId },
    };
  });

  return mutateBusinessLedger(entity, input.revision, (current) => [...current, ...records], {
    requestId: input.requestId,
    fingerprint: createHash("sha256").update(JSON.stringify(records.map((record) => record.id).sort())).digest("hex"),
    action: "finance-import",
    reason: `Imported ${records.length} business expense${records.length === 1 ? "" : "s"} from Finance`,
  });
}
