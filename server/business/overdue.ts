import { businessInvoicePaid } from "../../shared/business-billing-calculations";
import type { BusinessLedgerRecord } from "../../shared/business-ledger-types";
import { getBusinessLedgerStatus } from "./ledger-store";
import { readBusinessState } from "./store";

/**
 * Overdue invoices across every business's ledger, for "which invoices are
 * overdue?" from a chat or Jarvis.
 *
 * Read-only and local. Overdue means what the Billing tab means by it: an
 * issued, unvoided invoice whose due date is before today in Johannesburg and
 * whose payments don't cover it.
 */

export interface BusinessLedgerSnapshot {
  entity: { id: string; name: string };
  records: readonly BusinessLedgerRecord[];
}

export interface OverdueInvoice {
  business: string;
  businessId: string;
  number?: string;
  title: string;
  client?: string;
  dueOn: string;
  balanceMinor: number;
}

export interface OverdueInvoicesReport {
  today: string;
  /** False when no business has an invoice at all, so "none overdue" would mislead. */
  hasInvoices: boolean;
  invoices: OverdueInvoice[];
  totalMinor: number;
}

export async function readAllBusinessLedgers(): Promise<BusinessLedgerSnapshot[]> {
  const state = await readBusinessState();
  return state.entities.map((entity) => ({ entity: { id: entity.id, name: entity.name }, records: getBusinessLedgerStatus(entity.id).records }));
}

/** Today as the Billing tab reckons it: the date in Johannesburg, not the server's zone. */
export function billingToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function findOverdueInvoices(ledgers: readonly BusinessLedgerSnapshot[], today: string): OverdueInvoicesReport {
  const invoices: OverdueInvoice[] = [];
  let hasInvoices = false;
  for (const { entity, records } of ledgers) {
    const clients = new Map(records.flatMap((record) => (record.kind === "client" ? [[record.id, record.companyName ?? record.name] as const] : [])));
    for (const record of records) {
      if (record.kind !== "invoice") continue;
      hasInvoices = true;
      if (record.voided || record.status !== "issued" || !record.dueOn || record.dueOn >= today) continue;
      const balanceMinor = (record.amountMinor ?? 0) - businessInvoicePaid(records, record.id);
      if (balanceMinor <= 0) continue;
      invoices.push({
        business: entity.name,
        businessId: entity.id,
        number: record.number,
        title: record.title,
        client: record.clientName ?? (record.clientId ? clients.get(record.clientId) : undefined),
        dueOn: record.dueOn,
        balanceMinor,
      });
    }
  }
  invoices.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return { today, hasInvoices, invoices, totalMinor: invoices.reduce((sum, invoice) => sum + invoice.balanceMinor, 0) };
}

export async function overdueInvoicesReport(now = new Date(), read: () => Promise<BusinessLedgerSnapshot[]> = readAllBusinessLedgers): Promise<OverdueInvoicesReport> {
  return findOverdueInvoices(await read(), billingToday(now));
}
