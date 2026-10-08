import { businessInvoicePaid } from "../../../shared/business-billing-calculations";
import type { BusinessLedgerRecord } from "../../../shared/business-ledger-types";
import { formatRandAmount } from "../../../shared/finance-types";
import { getBusinessLedgerStatus } from "../../business/ledger-store";
import { readBusinessState } from "../../business/store";
import type { JarvisWorker } from "../jarvis-worker-registry";

/**
 * "Which invoices are overdue?", answered from the local business ledger.
 *
 * Read-only and local: nothing leaves this machine and no connector is used.
 * Overdue means exactly what the Billing tab means by it: an issued, unvoided
 * invoice whose due date has passed and whose payments do not cover it.
 * Nothing is estimated; an empty ledger is said to be empty.
 */

export interface BusinessLedgerSnapshot {
  entity: { id: string; name: string };
  records: BusinessLedgerRecord[];
}

export interface OverdueInvoice {
  business: string;
  number?: string;
  title: string;
  client?: string;
  dueOn: string;
  balanceMinor: number;
}

export async function readAllBusinessLedgers(): Promise<BusinessLedgerSnapshot[]> {
  const state = await readBusinessState();
  return state.entities.map((entity) => ({ entity: { id: entity.id, name: entity.name }, records: getBusinessLedgerStatus(entity.id).records }));
}

export function findOverdueInvoices(ledgers: readonly BusinessLedgerSnapshot[], today: string): OverdueInvoice[] {
  const overdue: OverdueInvoice[] = [];
  for (const { entity, records } of ledgers) {
    const clients = new Map(records.flatMap((record) => (record.kind === "client" ? [[record.id, record.companyName ?? record.name] as const] : [])));
    for (const record of records) {
      if (record.kind !== "invoice" || record.voided || record.status !== "issued" || !record.dueOn || record.dueOn >= today) continue;
      const balanceMinor = (record.amountMinor ?? 0) - businessInvoicePaid(records, record.id);
      if (balanceMinor <= 0) continue;
      overdue.push({
        business: entity.name,
        number: record.number,
        title: record.title,
        client: record.clientName ?? (record.clientId ? clients.get(record.clientId) : undefined),
        dueOn: record.dueOn,
        balanceMinor,
      });
    }
  }
  return overdue.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export function formatRand(minor: number): string {
  return formatRandAmount(minor / 100, { cents: true });
}

/** Today as the Billing tab reckons it: the date in Johannesburg, not the server's zone. */
function billingToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function overdueInvoicesWorker(
  readLedgers: () => Promise<BusinessLedgerSnapshot[]> = readAllBusinessLedgers,
  now: () => Date = () => new Date(),
): JarvisWorker {
  return {
    id: "business.overdue_invoices",
    name: "Overdue invoices",
    description: "Lists overdue invoices and their unpaid balances from the local business ledger (Virtec, Pantry Pilot, Voxmachine).",
    capabilities: ["business-ledger:read"],
    intents: ["retrieve"],
    requiredInputs: [],
    optionalInputs: [{ name: "business", description: "Only this business, by name" }],
    safeRetry: true,
    async run({ inputs }) {
      let ledgers: BusinessLedgerSnapshot[];
      try {
        ledgers = await readLedgers();
      } catch (error) {
        return { status: "failed", reply: `I couldn't read the business ledger: ${error instanceof Error ? error.message : "unknown error"}.` };
      }

      const only = typeof inputs.business === "string" ? inputs.business.trim().toLowerCase() : "";
      const scoped = only ? ledgers.filter(({ entity }) => entity.name.toLowerCase().includes(only) || entity.id === only) : ledgers;
      if (only && scoped.length === 0) {
        return { status: "needs_input", reply: `I don't know a business called ${inputs.business}. I have ${ledgers.map(({ entity }) => entity.name).join(", ")}.` };
      }
      if (!scoped.some(({ records }) => records.some((record) => record.kind === "invoice"))) {
        return { status: "completed", reply: "There are no invoices in the business ledger yet, so nothing can be overdue. Invoices appear once they're issued or imported on the Business page." };
      }

      const overdue = findOverdueInvoices(scoped, billingToday(now()));
      if (overdue.length === 0) return { status: "completed", reply: "No invoices are overdue." };

      const total = overdue.reduce((sum, invoice) => sum + invoice.balanceMinor, 0);
      const lines = overdue.map(
        (invoice) => `- ${invoice.number ?? "Unnumbered"} · ${invoice.client ?? "no client"} · ${invoice.title} · due ${invoice.dueOn} · ${formatRand(invoice.balanceMinor)} outstanding (${invoice.business})`,
      );
      const spoken = overdue
        .slice(0, 3)
        .map((invoice) => `${invoice.client ?? invoice.title}, ${formatRand(invoice.balanceMinor)}, due ${invoice.dueOn}`)
        .join("; ");
      const more = overdue.length > 3 ? `, and ${overdue.length - 3} more on screen` : "";
      return {
        status: "completed",
        reply: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}, ${formatRand(total)} outstanding: ${spoken}${more}.`,
        display: lines.join("\n"),
      };
    },
  };
}
