import type { BusinessLedgerRecord } from "../../shared/business-ledger-types";
import { readAllBusinessLedgers } from "../business/overdue";
import { getBusiness } from "../business/business";
import { readCompass } from "../compass/compass";
import { readUsage } from "../usage/ledger";
import { listJobs } from "../workers/job-store";
import { readOwnerHours } from "./hours-store";
import type { OutcomeInputs } from "./compute";

/**
 * Where the scorecard's figures come from, read once per request.
 *
 * The one judgement here is which business client a ledger payment belongs to.
 * A ledger client record carries the CRM's own client id as its `sourceId`
 * (the ledger record id is a hash of it), and a business client's id *is* that
 * CRM id. So the join is, in order:
 *   1. the ledger client's `sourceId` equals a business client's id, in the same business;
 *   2. an exact name match (case and spacing ignored) on the client's name or
 *      company name, only when exactly one business client has it;
 *   3. otherwise the payment is unattributed.
 * Never a fuzzy match: a wrong attribution would put one client's money on
 * another's row, which is worse than saying "unattributed".
 */

interface BusinessClientRef {
  id: string;
  entityId: string;
  name: string;
  companyName?: string;
}

const normal = (value: string | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function matchPayments(
  ledgers: ReadonlyArray<{ entityId: string; records: readonly BusinessLedgerRecord[] }>,
  businessClients: readonly BusinessClientRef[],
): { payments: OutcomeInputs["payments"][number][]; unmatched: number } {
  const payments: OutcomeInputs["payments"][number][] = [];
  let unmatched = 0;

  for (const ledger of ledgers) {
    const mine = businessClients.filter((client) => client.entityId === ledger.entityId);
    const byId = new Set(mine.map((client) => client.id));
    const ledgerClients = new Map<string, Extract<BusinessLedgerRecord, { kind: "client" }>>();
    for (const record of ledger.records) if (record.kind === "client") ledgerClients.set(record.id, record);

    const resolve = (ledgerClientId: string): string | undefined => {
      const owner = ledgerClients.get(ledgerClientId);
      if (!owner) return undefined;
      if (owner.source === "virtec" && byId.has(owner.sourceId)) return owner.sourceId;
      const names = [normal(owner.name), normal(owner.companyName)].filter(Boolean);
      const candidates = mine.filter((client) => names.includes(normal(client.name)) || (client.companyName !== undefined && names.includes(normal(client.companyName))));
      return candidates.length === 1 ? candidates[0].id : undefined;
    };

    for (const record of ledger.records) {
      if (record.kind !== "payment" || record.voided) continue;
      const clientKey = resolve(record.clientId);
      if (!clientKey) unmatched += 1;
      payments.push({ id: record.id, receivedOn: record.receivedOn, amountMinor: record.amountMinor, clientKey });
    }
  }

  return { payments, unmatched };
}

/** The first instant of a YYYY-MM month in South African time (UTC+2, no daylight saving). */
function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00+02:00`);
}

export async function gatherOutcomeInputs(month: string): Promise<OutcomeInputs> {
  const warnings: string[] = [];

  const [compass, ledgers, business, jobs, hours] = await Promise.all([
    readCompass().catch(() => undefined),
    readAllBusinessLedgers().catch(() => {
      warnings.push("The business ledger could not be read, so no payments are shown.");
      return [];
    }),
    getBusiness().catch(() => undefined),
    listJobs(500).catch(() => {
      warnings.push("Worker jobs could not be read, so no agent work is shown.");
      return [];
    }),
    readOwnerHours(),
  ]);

  const businessClients = business?.clients ?? [];
  if (!business) warnings.push("Business clients could not be read, so every payment is shown as unattributed.");

  const { payments, unmatched } = matchPayments(ledgers.map((ledger) => ({ entityId: ledger.entity.id, records: ledger.records })), businessClients);
  if (unmatched > 0) {
    warnings.push(`${unmatched} payment${unmatched === 1 ? "" : "s"} could not be matched to a client, and ${unmatched === 1 ? "is" : "are"} shown as unattributed.`);
  }

  const [year, number] = month.split("-").map(Number);
  const next = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}`;
  const usage = (() => {
    try {
      return readUsage({ from: monthStart(month).toISOString(), to: monthStart(next).toISOString() });
    } catch {
      warnings.push("AI usage could not be read, so AI cost is not shown.");
      return [];
    }
  })();

  return {
    goals: compass?.compass.goals ?? [],
    clients: businessClients.map((client) => ({ id: client.id, name: client.companyName ?? client.name, workspace: client.workspace ?? null })),
    payments,
    jobs: jobs.map((job) => ({ id: job.id, project: job.project, status: job.status, attempt: job.revision ?? 1, completedAt: job.completedAt })),
    usage: usage.map((record) => ({ project: record.project, costUsd: record.costUsd })),
    hours,
    warnings,
  };
}
