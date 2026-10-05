import { useState } from "react";
import type { BusinessEntitySummary } from "@shared/business-types";
import { BUSINESS_LEDGER_KINDS, businessRecordLabel, type BusinessImportPreview, type BusinessLedgerKind, type BusinessLedgerRecord } from "@shared/business-ledger-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { businessLedgerUrl, useBusinessLedger, useCommitBusinessImport, usePrepareBusinessImport } from "@/lib/agentos/business-ledger";

const LABELS: Record<BusinessLedgerKind, string> = { client: "Clients", project: "Projects", service: "Service drafts", quote: "Quotes", invoice: "Invoices", payment: "Payments", expense: "Expenses" };
const rand = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 2 });
const amount = (minor: number | undefined) => minor === undefined ? "Unknown" : rand.format(minor / 100);

export function BusinessSetup({ entity }: { entity: BusinessEntitySummary }) {
  const ledger = useBusinessLedger(entity.id);
  const prepare = usePrepareBusinessImport(entity.id);
  const commit = useCommitBusinessImport(entity.id);
  const [preview, setPreview] = useState<BusinessImportPreview>();
  const [fileError, setFileError] = useState<string>();
  const [readingFile, setReadingFile] = useState(false);
  const busy = prepare.isPending || commit.isPending || readingFile;
  const startPreview = (input: Parameters<typeof prepare.mutate>[0]) => {
    setPreview(undefined); setFileError(undefined); commit.reset();
    prepare.mutate(input, { onSuccess: setPreview });
  };
  const error = fileError ?? prepare.error?.message ?? commit.error?.message ?? ledger.error?.message;
  const records = ledger.data?.records ?? [];
  return (
    <div className="grid gap-8">
      <PaperSection label="Bring your business into Agentos">
        <p className="max-w-[80ch] text-[14px] leading-6 text-paper-char">
          Review a local copy of your CRM records before moving billing here. Your current Business screens continue to read the CRM while the migration is being checked.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {entity.source === "virtec" ? <PaperButton variant="amber" disabled={busy} onClick={() => startPreview({ mode: "crm" })}>{prepare.isPending ? "Preparing preview…" : "Preview CRM import"}</PaperButton> : <p className="text-[14px] text-paper-sage">This business has no CRM connection. Create local records in Billing & cash flow.</p>}
          {ledger.data ? <a className={`text-[13px] text-paper-blue underline ${PAPER_FOCUS}`} href={`${businessLedgerUrl(entity.id)}/backup`} download>Download ledger backup</a> : null}
          {ledger.data?.lastImport ? <a className={`text-[13px] text-paper-blue underline ${PAPER_FOCUS}`} href={`${businessLedgerUrl(entity.id)}/backup?previous=1`} download>Download pre-import backup</a> : null}
        </div>
        <p className="mt-3 max-w-[85ch] text-[13px] leading-5 text-paper-sage">Available now: client, project, and quote summaries, plus service drafts for review. Use the billing-history import below for verified invoice, payment and expense exports. Original PDFs need a separate migration. Service drafts cannot bill clients.</p>
      </PaperSection>

      {error ? <p role="alert" className="border border-paper-flame-deep p-3 text-[14px] text-paper-flame-deep">{error}</p> : null}
      {commit.isSuccess ? <p role="status" className="border border-paper-mist bg-paper-cream p-3 text-[14px]">Local records saved. {commit.data.lastImport?.added} added, {commit.data.lastImport?.updated} updated, {commit.data.lastImport?.unchanged} unchanged. Use Billing & cash flow for new local transactions.</p> : null}
      {preview ? <ImportReview preview={preview} busy={busy} onApply={() => commit.mutate(preview.id, { onSuccess: () => setPreview(undefined) })} onCancel={() => setPreview(undefined)} /> : null}

      <PaperSection label="Local records" count={records.length}>
        {ledger.isPending ? <p role="status">Reading local records…</p> : ledger.data ? <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {BUSINESS_LEDGER_KINDS.map((kind) => <div key={kind}><dt className="text-[12px] text-paper-sage">{LABELS[kind]}</dt><dd className="mt-1 text-[23px] font-semibold tabular-nums">{ledger.data.counts[kind]}</dd></div>)}
          </dl>
          {ledger.data.lastImport ? <p className="mt-3 text-[12px] text-paper-sage">Last saved {new Date(ledger.data.lastImport.at).toLocaleString("en-ZA")} · Local revision {ledger.data.revision}</p> : null}
          {records.length ? <LocalRecords records={records} /> : <p className="mt-4 text-[14px] text-paper-char">No records imported yet. Preview the CRM import to see what is available and what needs attention.</p>}
        </> : null}
      </PaperSection>

      {entity.source === "virtec" ? <PaperSection label="Import billing history">
        <p className="text-sm text-paper-sage">Import reviewed invoices, actual payments and paid expenses using the billing-history JSON format. Use original CRM client IDs and integer-cent amounts. A paid invoice flag alone does not prove a payment date.</p>
        <details className="mt-3 text-sm"><summary className="cursor-pointer">History format and mapping guide</summary><p className="my-2">Every row needs its original sourceId. Invoices and payments need clientSourceId matching an imported CRM client. Amounts are integer cents (R500 = 50000). Only actual paid expenses belong here; do not expand recurring templates.</p><pre className="overflow-auto border border-paper-mist p-3 text-xs">{JSON.stringify({ format: "agentos-billing-history", version: 1, entityId: entity.id, invoices: [{ sourceId: "original-invoice-id", clientSourceId: "original-client-id", title: "Hosting", number: "original-number", issuedOn: "2026-09-25", amountMinor: 50000, status: "paid" }], payments: [{ sourceId: "original-payment-id", clientSourceId: "original-client-id", receivedOn: "2026-09-26", amountMinor: 50000, allocations: [{ invoiceSourceId: "original-invoice-id", amountMinor: 50000 }] }], expenses: [{ sourceId: "original-expense-id", vendor: "Supplier", category: "Hosting", amountMinor: 10000, paidOn: "2026-09-26" }] }, null, 2)}</pre><p className="mt-2">Example only. Replace all values with verified records or leave the corresponding array empty. Invoice status: paid, pending or cancelled.</p></details>
        <a className="mt-3 inline-block text-sm text-paper-blue underline" href={`${businessLedgerUrl(entity.id)}/history-template`} download>Download empty history template</a>
        <label className="mt-4 block"><FieldLabel>Billing history (.json)</FieldLabel><input type="file" accept=".json,application/json" disabled={busy} onChange={async (event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (!file) return;
          if (file.size > 16 * 1024 * 1024) { setFileError("Choose a history export smaller than 16 MB."); return; }
          setReadingFile(true);
          try { startPreview({ mode: "history", backup: JSON.parse(await file.text()) as unknown }); }
          catch { setFileError("The history file is not valid JSON."); }
          finally { setReadingFile(false); }
        }} /></label>
      </PaperSection> : null}
      <details className="border-t border-paper-mist pt-4">
        <summary className={`w-fit cursor-pointer text-[14px] font-semibold ${PAPER_FOCUS}`}>Restore a ledger backup</summary>
        <p className="mt-3 max-w-[75ch] text-[13px] leading-5 text-paper-sage">Restore is available when this business's local ledger is empty. You will review the backup before applying it. Existing records are never replaced. Backups cover local records, not original PDFs or CRM connection settings.</p>
        <label className="mt-3 block max-w-md"><FieldLabel>Agentos business backup (.json)</FieldLabel>
          <input type="file" accept=".json,application/json" disabled={busy || !ledger.data || records.length > 0} className={`block w-full text-[13px] ${PAPER_FOCUS}`} onChange={async (event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (!file) return;
            setFileError(undefined); setPreview(undefined); prepare.reset(); commit.reset();
            if (file.size > 16 * 1024 * 1024) { setFileError("Choose a backup smaller than 16 MB."); return; }
            setReadingFile(true);
            try { startPreview({ mode: "restore", backup: JSON.parse(await file.text()) as unknown }); }
            catch { setFileError("The selected file is not valid JSON."); }
            finally { setReadingFile(false); }
          }} />
        </label>
      </details>
    </div>
  );
}

function ImportReview({ preview, busy, onApply, onCancel }: { preview: BusinessImportPreview; busy: boolean; onApply: () => void; onCancel: () => void }) {
  const blockers = preview.issues.filter((issue) => issue.severity === "error");
  const linkedQuotes = preview.issues.filter((issue) => issue.code === "client_from_project").length;
  const checks = preview.issues.filter((issue) => issue.code !== "client_from_project");
  return (
    <PaperCard aria-label="Import review">
      <h2 className="font-paper-display text-[21px] font-bold">{preview.mode === "crm" ? "Review CRM import" : preview.mode === "history" ? "Review billing history" : "Review backup restore"}</h2>
      <p className="mt-2 text-[14px] text-paper-char">{preview.changes.added} new · {preview.changes.updated} updated · {preview.changes.unchanged} unchanged. This preview expires in 30 minutes.</p>
      {preview.mode === "crm" ? <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div><dt className="text-[12px] text-paper-sage">Known pending quote value</dt><dd className="mt-1 font-semibold">{amount(preview.pendingQuoteMinor)}</dd></div>
        <div><dt className="text-[12px] text-paper-sage">CRM summary reports</dt><dd className="mt-1 font-semibold">{amount(preview.reportedPendingQuoteMinor)}</dd></div>
        <div><dt className="text-[12px] text-paper-sage">Pending value without a client</dt><dd className="mt-1 font-semibold">{amount(preview.unlinkedPendingQuoteMinor)}</dd></div>
      </dl> : null}
      {preview.historyTotals ? <dl className="mt-4 grid gap-3 sm:grid-cols-3">{Object.entries(preview.historyTotals).map(([kind, value]) => <div key={kind}><dt className="text-sm capitalize">{kind} in file</dt><dd className="font-semibold">{amount(value)}</dd></div>)}</dl> : null}
      {linkedQuotes ? <p className="mt-3 text-[13px] text-paper-sage">{linkedQuotes} legacy quotes linked to clients through their recorded projects.</p> : null}
      <ul aria-label="Import checks" className="mt-5 grid gap-2">
        {checks.map((issue, index) => <li key={`${issue.code}-${issue.recordId ?? index}`} className="flex items-start gap-2 text-[13px] leading-5"><Tag tone={issue.severity === "error" ? "flame" : issue.severity === "warning" ? "marigold" : "muted"}>{issue.severity === "error" ? "Blocked" : issue.severity === "warning" ? "Review" : "Scope"}</Tag><span className="min-w-0 break-words">{issue.message}{issue.recordId ? <span className="block text-[12px] text-paper-sage">Source record: {issue.recordId}</span> : null}</span></li>)}
      </ul>
      <details className="mt-4"><summary className={`w-fit cursor-pointer text-[13px] text-paper-blue ${PAPER_FOCUS}`}>View {preview.records.length} records in this preview</summary><ul className="mt-2 max-h-64 overflow-auto divide-y divide-paper-mist">{preview.records.map((record) => <li key={record.id} className="flex flex-wrap justify-between gap-2 py-2 text-[13px]"><span>{record.label} · {LABELS[record.kind]}{record.amountMinor !== undefined ? ` · ${amount(record.amountMinor)}` : ""}{record.date ? ` · ${record.date}` : ""}<small className="block break-all">Source: {record.sourceId}</small></span><span>{record.change}</span></li>)}</ul></details>
      <div className="mt-5 flex flex-wrap gap-3"><PaperButton variant="amber" disabled={busy || !preview.ready} onClick={onApply}>{busy ? "Saving…" : preview.mode !== "restore" ? "Import reviewed records" : "Restore reviewed backup"}</PaperButton><PaperButton disabled={busy} onClick={onCancel}>Cancel preview</PaperButton></div>
      {blockers.length ? <p role="status" className="mt-2 text-[13px] text-paper-flame-deep">Resolve the blocking errors, then prepare a new preview.</p> : <p className="mt-2 text-[12px] text-paper-sage">Applying this preview saves local records and a pre-import backup. No invoices or client messages are sent.</p>}
    </PaperCard>
  );
}

function LocalRecords({ records }: { records: BusinessLedgerRecord[] }) {
  const [kind, setKind] = useState<BusinessLedgerKind | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = records.filter((record) => (kind === "all" || kind === record.kind) && `${businessRecordLabel(record)} ${record.sourceId}`.toLowerCase().includes(query.toLowerCase()));
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1));
  const clients = new Map(records.filter((record) => record.kind === "client").map((record) => [record.id, businessRecordLabel(record)]));
  return <div className="mt-5">
    <div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1"><FieldLabel>Search local records</FieldLabel><input type="search" className={`${PAPER_INPUT} w-full`} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label><label><FieldLabel>Record type</FieldLabel><select className={PAPER_INPUT} value={kind} onChange={(event) => { setKind(event.target.value as BusinessLedgerKind | "all"); setPage(0); }}><option value="all">All records</option>{BUSINESS_LEDGER_KINDS.map((entry) => <option key={entry} value={entry}>{LABELS[entry]}</option>)}</select></label></div>
    <ul aria-label="Imported local records" className="mt-4 divide-y divide-paper-mist border-y border-paper-mist">{filtered.slice(current * 20, (current + 1) * 20).map((record) => <li key={record.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-[13px]"><div className="min-w-0"><p className="font-semibold">{businessRecordLabel(record)}</p><p className="text-paper-sage">{LABELS[record.kind]}{"clientId" in record ? ` · ${clients.get(record.clientId ?? "") ?? "Client link needed"}` : ""}</p><p className="break-all text-[12px] text-paper-sage">{record.source} · {record.sourceId}</p></div><div className="flex flex-wrap items-center gap-2">{record.kind !== "client" ? <span className="tabular-nums">{amount(record.amountMinor)}</span> : null}{record.voided ? <Tag tone="muted">Voided</Tag> : null}{record.kind === "service" ? <Tag tone="marigold">{record.state.replaceAll("_", " ")}</Tag> : "detail" in record ? <Tag>{record.detail}</Tag> : null}</div></li>)}</ul>
    {!filtered.length ? <p className="py-3 text-[13px]">No records match.</p> : null}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-paper-sage"><span>{filtered.length ? `${current * 20 + 1}–${Math.min((current + 1) * 20, filtered.length)} of ${filtered.length}` : "0 records"}</span><div><PaperButton disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</PaperButton><PaperButton disabled={(current + 1) * 20 >= filtered.length} onClick={() => setPage(current + 1)}>Next</PaperButton></div></div>
  </div>;
}
