import type { z } from "zod";
import type { BusinessVatSchema, BusinessLedgerRecord } from "./business-ledger-types";
/** Round half-up once per document, using integer cents and basis points. */
export function calculateBusinessTotals(items: { quantity: number; unitPriceMinor: number }[], tax?: z.infer<typeof BusinessVatSchema>) {
  const sum = items.reduce((value, item) => value + BigInt(item.quantity) * BigInt(item.unitPriceMinor), 0n);
  const rate = BigInt(tax?.rateBps ?? 0);
  const divisor = tax?.mode === "inclusive" ? 10000n + rate : 10000n;
  const vat = (sum * rate + divisor / 2n) / divisor;
  const gross = tax?.mode === "exclusive" ? sum + vat : sum;
  if (gross > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Document total is too large.");
  return { amountMinor: Number(gross), vatMinor: Number(vat), subtotalMinor: Number(gross - vat) };
}
export function businessInvoicePaid(records: readonly BusinessLedgerRecord[], invoiceId: string): number {
  return records.reduce((sum, row) => row.kind === "payment" && !row.voided ? sum + row.allocations.filter((allocation) => allocation.invoiceId === invoiceId).reduce((value, allocation) => value + allocation.amountMinor, 0) : sum, 0);
}
