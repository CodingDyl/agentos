import { createHash } from "node:crypto";
import {
  BusinessLedgerRecordSchema,
  type BusinessImportIssue,
  type BusinessLedgerRecord,
} from "../../shared/business-ledger-types";
import type { VirtecSnapshot } from "../../shared/virtec-types";

export function ledgerSourceId(entityId: string, kind: string, sourceId: string): string {
  return createHash("sha256").update(JSON.stringify([entityId, "virtec", kind, sourceId])).digest("hex");
}

/** Decimal rand -> cents. Reject fractions of a cent and unsafe integers, never silently round them. */
export function randToMinor(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || value < 0 || Math.abs(value * 100 - cents) > 0.000001) {
    throw new Error("Amount must be non-negative rand with no more than two decimal places.");
  }
  return cents;
}

export function sumMinor(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The combined amount exceeds the supported limit.");
  return Number(total);
}

export function validateBusinessRecords(records: readonly BusinessLedgerRecord[], entityId: string): void {
  if (records.length > 10000) throw new Error("A business ledger supports at most 10,000 records. Split the migration before importing more.");
  sumMinor(records.map((record) => "amountMinor" in record ? record.amountMinor ?? 0 : 0));
  const byId = new Map<string, BusinessLedgerRecord>();
  const sourceKeys = new Set<string>();
  const numbers = new Set<string>();
  for (const record of records) {
    BusinessLedgerRecordSchema.parse(record);
    if (record.entityId !== entityId) throw new Error("A record belongs to a different business.");
    const sourceKey = JSON.stringify([record.source, record.kind, record.sourceId]);
    if (byId.has(record.id) || sourceKeys.has(sourceKey)) throw new Error("Duplicate record or source identifier.");
    byId.set(record.id, record);
    sourceKeys.add(sourceKey);
    if ((record.kind === "quote" || record.kind === "invoice") && record.number) {
      const key = `${record.kind}:${record.number}`;
      if (numbers.has(key)) throw new Error("Duplicate document number.");
      numbers.add(key);
    }
  }
  const allocated = new Map<string, number[]>();
  for (const record of records) {
    if ("clientId" in record && record.clientId && byId.get(record.clientId)?.kind !== "client") throw new Error("A client link does not exist in this business.");
    if ("projectId" in record && record.projectId) {
      const project = byId.get(record.projectId);
      if (project?.kind !== "project") throw new Error("A project link does not exist in this business.");
      if ("clientId" in record && record.clientId && project.clientId && record.clientId !== project.clientId) throw new Error("The client and project links disagree.");
    }
    if (record.kind === "service" && record.state === "active" && (!record.clientId || !record.cadence || record.cadence === "ad-hoc" || !record.amountMinor || !record.nextInvoiceDate)) {
      throw new Error("An active recurring service needs a client, price, cadence, and next invoice date.");
    }
    if (record.kind !== "payment" || record.voided) continue;
    const ids = new Set<string>();
    for (const allocation of record.allocations) {
      const invoice = byId.get(allocation.invoiceId);
      if (ids.has(allocation.invoiceId)) throw new Error("A payment allocates to the same invoice twice.");
      ids.add(allocation.invoiceId);
      if (invoice?.kind !== "invoice" || invoice.voided || invoice.status === "cancelled" || invoice.clientId !== record.clientId || invoice.amountMinor === undefined) throw new Error("A payment must reference an invoice for the same client with a known total.");
      allocated.set(invoice.id, [...(allocated.get(invoice.id) ?? []), allocation.amountMinor]);
    }
    if (sumMinor(record.allocations.map((entry) => entry.amountMinor)) > record.amountMinor) throw new Error("Payment allocations exceed the received amount.");
  }
  for (const [invoiceId, amounts] of allocated) {
    const invoice = byId.get(invoiceId)!;
    if ("amountMinor" in invoice && sumMinor(amounts) > invoice.amountMinor!) throw new Error("Payments exceed an invoice's total.");
  }
}

export function buildCrmImport(snapshot: VirtecSnapshot, entityId: string) {
  const records: BusinessLedgerRecord[] = [];
  const issues: BusinessImportIssue[] = [];
  const issue = (severity: BusinessImportIssue["severity"], code: string, message: string, recordId?: string) => issues.push({ severity, code, message, recordId });
  if (!snapshot.configured) issue("error", "not_connected", "Connect the CRM before preparing an import.");
  for (const name of ["clients", "projects", "quotes", "revenue"] as const) {
    const status = snapshot.sources?.[name];
    if (!status?.ok) issue("error", "source_failed", `The ${name} source could not be verified. Retry before importing.`);
    if (status?.skipped) issue("error", "source_skipped", `${status.skipped} ${name} records were unreadable. Import is blocked to prevent missing history.`);
    if (name !== "revenue" && snapshot[name].length >= 500) issue("error", "source_limit", `${name} reached the connector's 500-record limit. A paginated export is needed before importing.`);
  }
  const clients = new Map(snapshot.clients.map((client) => [client.id, client]));
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const clientLink = (sourceId: string | undefined, recordId: string) => {
    if (sourceId && clients.has(sourceId)) return ledgerSourceId(entityId, "client", sourceId);
    issue("warning", "client_unlinked", "No verified client link. The original source record will be kept for reconciliation.", recordId);
    return undefined;
  };
  const base = (kind: string, entry: { id: string; createdAt?: string }) => ({
    id: ledgerSourceId(entityId, kind, entry.id), entityId, source: "virtec", sourceId: entry.id,
    sourceCreatedAt: entry.createdAt, sourceRecord: entry,
  });
  const add = (recordId: string, build: () => unknown) => {
    try { records.push(BusinessLedgerRecordSchema.parse(build())); }
    catch { issue("error", "invalid_record", "A record has invalid fields or an amount that cannot be represented in cents. Correct the source before importing.", recordId); }
  };

  for (const client of snapshot.clients) add(client.id, () => ({
    ...base("client", client), kind: "client", name: client.name, companyName: client.companyName,
    email: client.email, active: client.active, maintenance: client.maintenance,
  }));
  for (const project of snapshot.projects) {
    const linkedClient = clientLink(project.clientId, project.id);
    add(project.id, () => ({ ...base("project", project), kind: "project", clientId: linkedClient, title: project.projectType ?? "Untitled project", status: project.status, currency: "ZAR", amountMinor: randToMinor(project.amount) }));
    const looksLikeService = project.maintenanceFrequency !== undefined || project.maintenanceAmount !== undefined || project.serviceSku !== undefined || /maintenance|hosting|seo/i.test(project.projectType ?? "");
    if (!looksLikeService) continue;
    const cadences: Record<string, string> = { monthly: "monthly", quarterly: "quarterly", "semi-annually": "semiannual", "semi-annual": "semiannual", semiannual: "semiannual", annually: "annual", annual: "annual", "ad-hoc": "ad-hoc" };
    const cadence = cadences[project.maintenanceFrequency?.toLowerCase() ?? ""];
    add(project.id, () => ({
      ...base("service", project), kind: "service", projectId: ledgerSourceId(entityId, "project", project.id), clientId: linkedClient,
      title: project.projectType ?? "Recurring service", currency: "ZAR", amountMinor: randToMinor(project.maintenanceAmount), cadence,
      // Project completion is not cancellation of the client's ongoing service.
      // The connector has no independent service status or billing anchor.
      state: "needs_setup",
    }));
    issue("warning", "billing_setup", `${clients.get(project.clientId ?? "")?.companyName ?? clients.get(project.clientId ?? "")?.name ?? project.clientName ?? project.projectType ?? "Service"}: verify the service price, billing frequency, and next invoice date. No billing schedule will be activated by import.`, project.id);
  }
  for (const quote of snapshot.quotes) {
    const project = projects.get(quote.projectId ?? "");
    const resolvedClient = quote.clientId ?? project?.clientId;
    if (!quote.clientId && project?.clientId) issue("info", "client_from_project", "Client linked through the quote's exact project ID.", quote.id);
    const linkedClient = clientLink(resolvedClient, quote.id);
    if (quote.projectId && !project) issue("warning", "project_unlinked", "The quote references a project missing from the source. Its original ID is retained.", quote.id);
    add(quote.id, () => ({
      ...base("quote", quote), kind: "quote", clientId: linkedClient,
      projectId: project ? ledgerSourceId(entityId, "project", project.id) : undefined,
      title: quote.projectType ?? "Untitled quote", status: quote.status, detail: "summary", currency: "ZAR", amountMinor: randToMinor(quote.totalAmount),
    }));
    if (quote.totalAmount === undefined) issue("warning", "unknown_amount", "Quote total is missing; it will remain unknown rather than become zero.", quote.id);
  }
  const pending = records.filter((record) => record.kind === "quote" && record.status === "pending");
  const pendingQuoteMinor = sumMinor(pending.map((record) => "amountMinor" in record ? record.amountMinor ?? 0 : 0));
  const unlinkedPendingQuoteMinor = sumMinor(pending.filter((record) => "clientId" in record && !record.clientId).map((record) => "amountMinor" in record ? record.amountMinor ?? 0 : 0));
  let reportedPendingQuoteMinor: number | undefined;
  try { reportedPendingQuoteMinor = randToMinor(snapshot.revenue?.pendingQuoteValue); }
  catch { issue("error", "invalid_revenue", "The CRM's pending quote total is not a valid monetary amount."); }
  if (reportedPendingQuoteMinor === undefined) issue("warning", "missing_revenue_total", "The CRM did not supply a pending quote total for reconciliation.");
  else if (reportedPendingQuoteMinor !== pendingQuoteMinor) issue("warning", "quote_total_mismatch", "The sum of pending quotes differs from the CRM revenue summary. Resolve this before switching to local reporting.");
  if (unlinkedPendingQuoteMinor > 0) issue("warning", "unlinked_quote_value", "Some pending quote value has no client link. Client-only totals will understate the full pipeline.");
  issue("info", "summary_only", "This connector supplies client, project, and quote summaries. Invoice history, payments, expenses, original document numbers, line items, PDFs, and contact phone numbers are not included. They need a separate migration.");
  try { validateBusinessRecords(records, entityId); }
  catch (error) { issue("error", "invalid_links", error instanceof Error ? error.message : "Records could not be validated."); }
  return { records, issues, pendingQuoteMinor, unlinkedPendingQuoteMinor, reportedPendingQuoteMinor };
}
