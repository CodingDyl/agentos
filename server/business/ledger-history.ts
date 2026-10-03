import { z } from "zod";
import { BusinessMinorAmountSchema, type BusinessLedgerRecord, type BusinessImportIssue } from "../../shared/business-ledger-types";
import { ledgerSourceId } from "./ledger-import";
import { BusinessLedgerError } from "./ledger-store";
const id = z.string().trim().min(1).max(256);
const text = z.string().trim().min(1).max(1000);
/** Explicit export contract: dates and integer cents, never recurring expense projections. */
export const BusinessHistorySchema = z.object({
  format: z.literal("agentos-billing-history"), version: z.literal(1), entityId: id,
  invoices: z.array(z.object({ sourceId: id, clientSourceId: id, title: text, number: text.optional(), issuedOn: z.iso.date(), dueOn: z.iso.date().optional(), amountMinor: BusinessMinorAmountSchema, status: z.enum(["paid", "pending", "cancelled"]) }).strict()).max(5000),
  payments: z.array(z.object({ sourceId: id, clientSourceId: id, amountMinor: BusinessMinorAmountSchema.positive(), receivedOn: z.iso.date(), reference: z.string().max(500).optional(), allocations: z.array(z.object({ invoiceSourceId: id, amountMinor: BusinessMinorAmountSchema.positive() }).strict()).max(500) }).strict()).max(5000),
  expenses: z.array(z.object({ sourceId: id, vendor: text, category: text, amountMinor: BusinessMinorAmountSchema, paidOn: z.iso.date(), reference: z.string().max(500).optional() }).strict()).max(5000),
}).strict();
export function buildBusinessHistory(value: unknown, entityId: string, existing: BusinessLedgerRecord[]) {
  const parsed = BusinessHistorySchema.safeParse(value);
  if (!parsed.success) throw new BusinessLedgerError("Choose a billing-history JSON export with source IDs, integer-cent amounts and explicit transaction dates. Receipt URLs and credentials are not accepted.", 422);
  const data = parsed.data;
  if (data.entityId !== entityId) throw new BusinessLedgerError("This history export belongs to another business.", 422);
  const clients = new Map(existing.filter((row) => row.kind === "client" && row.source === "virtec").map((row) => [row.sourceId, row.id]));
  const client = (source: string) => {
    const result = clients.get(source);
    if (!result) throw new BusinessLedgerError(`Import or link the CRM client with source ID ${source} before importing its billing history.`, 422);
    return result;
  };
  const common = (kind: string, sourceId: string) => ({ id: ledgerSourceId(entityId, kind, `history:${sourceId}`), sourceId: `history:${sourceId}`, source: "virtec" as const, entityId });
  const records: BusinessLedgerRecord[] = [];
  const issues: BusinessImportIssue[] = [{ severity: "info", code: "history_scope", message: "Only explicit invoice, payment and paid-expense records in this file will be imported. Recurring expense projections and paid-invoice flags never create payments." }];
  for (const invoice of data.invoices) {
    records.push({ ...common("invoice", invoice.sourceId), kind: "invoice", clientId: client(invoice.clientSourceId), title: invoice.title, number: invoice.number, issuedOn: invoice.issuedOn, dueOn: invoice.dueOn, amountMinor: invoice.amountMinor, currency: "ZAR", detail: "summary", status: invoice.status === "paid" ? "historical_paid" : invoice.status === "pending" ? "issued" : "cancelled", sourceRecord: invoice });
    if (invoice.status === "paid") issues.push({ severity: "warning", code: "unverified_payment", message: `${invoice.number ?? invoice.title}: CRM says paid. No payment is inferred; its balance stays outside outstanding totals until reconciled.`, recordId: common("invoice", invoice.sourceId).id });
  }
  for (const payment of data.payments) records.push({ ...common("payment", payment.sourceId), kind: "payment", clientId: client(payment.clientSourceId), amountMinor: payment.amountMinor, currency: "ZAR", receivedOn: payment.receivedOn, reference: payment.reference, allocations: payment.allocations.map((entry) => ({ invoiceId: common("invoice", entry.invoiceSourceId).id, amountMinor: entry.amountMinor })), sourceRecord: payment });
  for (const expense of data.expenses) records.push({ ...common("expense", expense.sourceId), kind: "expense", vendor: expense.vendor, category: expense.category, amountMinor: expense.amountMinor, currency: "ZAR", paidOn: expense.paidOn, reference: expense.reference, sourceRecord: expense });
  if (records.length > 10000) throw new BusinessLedgerError("Import fewer than 10,001 records at a time.", 422);
  return { records, issues, pendingQuoteMinor: 0, unlinkedPendingQuoteMinor: 0, reportedPendingQuoteMinor: undefined };
}
