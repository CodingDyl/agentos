import { RecordEditor } from "./business-record-editor";
import { Field } from "./business-billing-fields";
import { money, today } from "./business-billing-format";
import { BusinessProfilePanel, BusinessRecordCorrections } from "./business-billing-controls";
import { businessInvoicePaid, calculateBusinessTotals } from "@shared/business-billing-calculations";
import { useState } from "react";
import { FinanceExpenseImport } from "./business-finance-import";
import { businessRecordLabel, type BusinessLedgerRecord } from "@shared/business-ledger-types";
import { PAPER_INPUT, PaperButton, PaperCard, PaperPagination, PaperSection } from "@/components/paper";
import { businessLedgerUrl, useBusinessLedger, useBusinessOperation } from "@/lib/agentos/business-ledger";
import { usePagination } from "@/lib/use-pagination";
export type Kind = "client" | "project" | "quote" | "invoice" | "service" | "payment" | "expense";
const labels: Record<Kind, string> = { client: "Clients", project: "Projects", quote: "Quotes", invoice: "Invoices", service: "Recurring services", payment: "Payments", expense: "Expenses" };
/**
 * One tab's share of the local ledger: the records of the kinds that tab owns
 * (Clients owns clients and projects, Quotes owns quotes, and so on).
 */
export function LedgerRecords({ entityId, entityName, kinds, entityNames }: { entityId: string; entityName: string; kinds: readonly Kind[]; entityNames?: ReadonlyMap<string, string> }) {
  const ledger = useBusinessLedger(entityId);
  const operation = useBusinessOperation(entityId);
  const [kind, setKind] = useState<Kind>(kinds[0] ?? "client");
  const [editing, setEditing] = useState<BusinessLedgerRecord | "new">();
  const [billingDate, setBillingDate] = useState(today());
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [financeImport, setFinanceImport] = useState(false);
  const [imported, setImported] = useState<number>();
  const records = ledger.data?.records ?? [];
  const run = (input: Omit<Parameters<typeof operation.mutate>[0], "revision">) => {
    if (!ledger.data) return;
    setError(undefined);
    operation.mutate({ ...input, revision: ledger.data.revision }, { onSuccess: () => setEditing(undefined) });
  };
  const paid = (invoiceId: string) => businessInvoicePaid(records, invoiceId);
  const rows = records.filter((row) => row.kind === kind && `${businessRecordLabel(row)} ${"number" in row ? row.number ?? "" : ""}`.toLowerCase().includes(query.toLowerCase()));
  const pager = usePagination(rows, `${kind}|${query}`);
  return <div className="grid gap-7">
    {kinds.length > 1 ? <nav aria-label="Record type" className="flex flex-wrap gap-2">{kinds.map((value) => <PaperButton key={value} variant={kind === value ? "amber" : "ghost"} aria-pressed={kind === value} onClick={() => { setKind(value); setEditing(undefined); operation.reset(); setError(undefined); }}>{labels[value]}</PaperButton>)}</nav> : null}
    {ledger.isPending ? <p role="status">Loading records…</p> : null}
    {error || operation.error || ledger.error ? <p role="alert" className="border border-paper-flame-deep p-3 text-paper-flame-deep">{error ?? operation.error?.message ?? ledger.error?.message}</p> : null}
    {operation.isSuccess ? <p role="status" className="text-sm text-paper-moss">Saved to your local business ledger.</p> : null}
    <PaperSection label={labels[kind]} count={rows.length}>
      <div className="mb-5 flex flex-wrap items-end gap-3"><PaperButton variant="amber" disabled={!ledger.data || operation.isPending} onClick={() => { setEditing("new"); operation.reset(); }}>New {kind}</PaperButton>{kind === "expense" ? <PaperButton disabled={!ledger.data || operation.isPending} aria-expanded={financeImport} onClick={() => { setFinanceImport((open) => !open); setImported(undefined); }}>Import from Finance</PaperButton> : null}<Field label="Search records"><input className={PAPER_INPUT} value={query} onChange={(event) => setQuery(event.target.value)} /></Field></div>
      {imported !== undefined ? <p role="status" className="mb-5 text-sm text-paper-moss">Imported {imported} business expense{imported === 1 ? "" : "s"} from Finance.</p> : null}
      {kind === "expense" && financeImport ? <FinanceExpenseImport entityId={entityId} entityName={entityName} entityNames={entityNames ?? new Map([[entityId, entityName]])} revision={ledger.data?.revision} onClose={() => setFinanceImport(false)} onImported={(count) => { setImported(count); setFinanceImport(false); }} /> : null}
      {kind === "service" ? <div className="mb-5 flex flex-wrap items-end gap-3"><Field label="Bill services due through"><input required type="date" className={PAPER_INPUT} value={billingDate} onChange={(event) => setBillingDate(event.target.value)} /></Field><PaperButton disabled={operation.isPending || !billingDate} onClick={() => run({ action: "generate", date: billingDate })}>Generate next invoice drafts</PaperButton><p className="basis-full text-sm text-paper-sage">One due period per active service per run. Review and issue each draft. No emails or charges are sent.</p></div> : null}
      {editing ? <RecordEditor key={editing === "new" ? `${kind}-new` : editing.id} kind={kind} record={editing === "new" ? undefined : editing} entityId={entityId} entityName={entityName} profile={ledger.data?.profile} records={records} busy={operation.isPending} onCancel={() => setEditing(undefined)} onSave={(record) => run({ action: "save", record })} onError={setError} /> : null}
      <div className="grid gap-3">{pager.pageItems.map((record) => {
        const document = record.kind === "quote" || record.kind === "invoice" ? record : undefined;
        const client = "clientId" in record ? records.find((row) => row.id === record.clientId) : undefined;
        return <PaperCard key={record.id}><div className="flex flex-wrap items-start justify-between gap-4 p-4"><div><h3 className="font-semibold">{businessRecordLabel(record)}{record.voided ? " · Voided" : ""}</h3>{record.voided ? <p className="text-sm text-paper-sage">{record.voided.reason}</p> : null}<p className="mt-1 text-sm text-paper-sage">{client ? businessRecordLabel(client) : record.kind === "client" ? record.email : record.kind === "expense" ? "" : "No client linked"}{document ? ` · ${document.number ?? (document.detail === "summary" ? "CRM summary" : "Draft")} · ${document.status ?? "unknown"}` : record.kind === "service" ? ` · ${record.state} · ${record.cadence ?? "No cadence"} · next ${record.nextInvoiceDate ?? "not set"}` : ""}</p>{record.kind === "payment" ? <p className="mt-1 text-sm text-paper-sage">Received {record.receivedOn} · {record.allocations.length ? "Allocated to invoice" : "Unallocated credit"}</p> : record.kind === "expense" ? <p className="mt-1 text-sm text-paper-sage">Paid {record.paidOn} · {record.category} · {record.reference}</p> : null}{document?.detail === "summary" ? <p className="mt-1 text-xs text-paper-sage">Historical summary. Create a new document to add line items.</p> : null}{record.kind === "invoice" && !record.voided && record.status === "issued" ? <p className="mt-2 text-sm">Paid {money(paid(record.id))} · Balance {money((record.amountMinor ?? 0) - paid(record.id))}{record.dueOn && record.dueOn < today() && (record.amountMinor ?? 0) > paid(record.id) ? " · Overdue" : ""}</p> : null}</div><div className="flex flex-wrap items-center gap-2">{"amountMinor" in record ? <strong className="mr-3">{money(record.amountMinor)}</strong> : null}{!record.voided && (record.kind === "client" || record.kind === "service" || document?.status === "draft") ? <PaperButton disabled={operation.isPending} onClick={() => setEditing(record)}>Edit</PaperButton> : null}{!record.voided && document?.status === "draft" ? <PaperButton disabled={operation.isPending} onClick={() => run({ action: "issue", id: record.id })}>Issue {record.kind}</PaperButton> : null}{!record.voided && record.kind === "quote" && record.status === "issued" ? <PaperButton disabled={operation.isPending} onClick={() => run({ action: "accept", id: record.id })}>Mark accepted</PaperButton> : null}{!record.voided && record.kind === "quote" && record.status === "accepted" && record.detail === "complete" ? <PaperButton disabled={operation.isPending || records.some((row) => row.kind === "invoice" && row.convertedFrom === record.id)} onClick={() => run({ action: "convert", id: record.id, date: today() })}>Create invoice</PaperButton> : null}{document?.detail === "complete" ? <a className="text-sm text-paper-blue underline" target="_blank" rel="noreferrer" href={`${businessLedgerUrl(entityId)}/documents/${encodeURIComponent(record.id)}/print`}>Print / PDF</a> : null}</div></div><BusinessRecordCorrections key={JSON.stringify(record)} record={record} records={records} busy={operation.isPending} onAction={run} /></PaperCard>;
      })}</div>{!rows.length && !ledger.isPending ? <p className="py-6 text-sm text-paper-sage">No {labels[kind].toLowerCase()} yet.</p> : null}
      <PaperPagination pager={pager} label={`${labels[kind]} pages`} />
    </PaperSection>
  </div>;
}

/** Money in, money out and what is owed, from actual recorded payments and expenses. */
export function CashFlowSummary({ entityId }: { entityId: string }) {
  const ledger = useBusinessLedger(entityId);
  const [month, setMonth] = useState(today().slice(0, 7));
  const records = ledger.data?.records ?? [];
  const paid = (invoiceId: string) => businessInvoicePaid(records, invoiceId);
  const income = records.reduce((sum, row) => sum + (row.kind === "payment" && !row.voided && row.receivedOn.startsWith(month) ? row.amountMinor : 0), 0);
  const expenses = records.reduce((sum, row) => sum + (row.kind === "expense" && !row.voided && row.paidOn.startsWith(month) ? row.amountMinor : 0), 0);
  const outstanding = records.reduce((sum, row) => sum + (row.kind === "invoice" && !row.voided && row.status === "issued" ? (row.amountMinor ?? 0) - paid(row.id) : 0), 0);
  const recurring = records.reduce((sum, row) => row.kind === "service" && row.state === "active" ? sum + calculateBusinessTotals([{ quantity: 1, unitPriceMinor: row.amountMinor ?? 0 }], row.tax).amountMinor / ({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12, "ad-hoc": Infinity }[row.cadence ?? "ad-hoc"]) : sum, 0);
  return <div className="grid gap-4">
    <PaperSection label="Cash flow">
      <p className="text-sm text-paper-sage">From payments and expenses recorded in the local ledger. Historical paid flags are excluded from cash flow until actual payment records are supplied.</p>
      <div className="my-4 max-w-52"><Field label="Cash-flow month"><input className={PAPER_INPUT} type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field></div>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Money received", income], ["Expenses paid", expenses], ["Net cash flow", income - expenses], ["Outstanding · all dates", outstanding]].map(([label, value]) => <div key={label} className="border border-paper-mist p-4"><dt className="text-sm text-paper-sage">{label}</dt><dd className="mt-2 text-2xl font-semibold text-paper-moss">{money(Number(value))}</dd></div>)}</dl>
      <p className="mt-4 text-sm text-paper-sage">Active services · {money(Math.round(recurring))} expected per month on average. This forecast is separate from payments received.</p>
    </PaperSection>
    {records.some((row) => row.kind === "invoice" && row.status === "historical_paid" && !row.voided) ? <p className="border border-paper-mist p-3 text-sm">Some historical invoices need balance reconciliation. They are excluded from outstanding totals until reviewed.</p> : null}
  </div>;
}

/** Legal name, VAT, payment instructions and the audit trail: the business's own details. */
export function BusinessDetails({ entityId, entityName }: { entityId: string; entityName: string }) {
  const ledger = useBusinessLedger(entityId);
  const operation = useBusinessOperation(entityId);
  if (!ledger.data) return ledger.isPending ? <p role="status">Loading business details…</p> : null;
  const revision = ledger.data.revision;
  return <div className="grid gap-3">
    {operation.error ? <p role="alert" className="border border-paper-flame-deep p-3 text-paper-flame-deep">{operation.error.message}</p> : null}
    {operation.isSuccess ? <p role="status" className="text-sm text-paper-moss">Saved.</p> : null}
    <BusinessProfilePanel entityId={entityId} entityName={entityName} profile={ledger.data.profile} audit={ledger.data.audit} busy={operation.isPending} onAction={(input) => operation.mutate({ ...input, revision })} />
  </div>;
}
