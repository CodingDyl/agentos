import { useState, type FormEvent } from "react";
import type { BusinessAuditEntry, BusinessLedgerRecord, BusinessProfile } from "@shared/business-ledger-types";
import { businessRecordLabel } from "@shared/business-ledger-types";
import { PAPER_INPUT, PaperButton } from "@/components/paper";
import { businessLedgerUrl, type useBusinessOperation } from "@/lib/agentos/business-ledger";
import { businessInvoicePaid } from "@shared/business-billing-calculations";
import { Field } from "./business-billing-fields";
import { minor, money } from "./business-billing-format";
type Action = Omit<Parameters<ReturnType<typeof useBusinessOperation>["mutate"]>[0], "revision">;
export function BusinessProfilePanel({ entityId, entityName, profile, audit, busy, onAction }: { entityId: string; entityName: string; profile?: BusinessProfile; audit: BusinessAuditEntry[]; busy: boolean; onAction: (input: Action) => void }) {
  const [error, setError] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    try {
      setError("");
      onAction({ action: "profile", profile: { legalName: text("legalName"), address: text("address"), email: text("email"), vatEnabled: data.get("vatEnabled") === "on", vatNumber: text("vatNumber"), vat: { rateBps: minor(text("rate")), mode: text("mode") as "exclusive" | "inclusive" }, paymentInstructions: text("paymentInstructions"), defaultTerms: text("defaultTerms") } });
    } catch (error) { setError(error instanceof Error ? error.message : "Check the profile fields."); }
  }
  return <div className="grid gap-4 border-t border-paper-mist pt-5"><details><summary className="cursor-pointer font-semibold">Business details & VAT</summary>
    <p className="mt-3 text-sm text-paper-sage">Save your supplier details and payment instructions for new documents. Existing issued documents keep their original details. Enable VAT only for your registered business.</p>
    <form key={JSON.stringify(profile)} onSubmit={save} className="mt-4 grid gap-4"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      <Field label="Legal / trading name"><input required name="legalName" className={PAPER_INPUT} defaultValue={profile?.legalName ?? entityName} /></Field>
      <Field label="Business email"><input name="email" type="email" className={PAPER_INPUT} defaultValue={profile?.email} /></Field>
      <Field label="Business address"><textarea name="address" className={PAPER_INPUT} defaultValue={profile?.address} /></Field>
      <Field label="Payment instructions"><textarea name="paymentInstructions" className={PAPER_INPUT} defaultValue={profile?.paymentInstructions} /></Field>
      <Field label="Default document terms"><textarea name="defaultTerms" className={PAPER_INPUT} defaultValue={profile?.defaultTerms ?? "Payment due by the due date."} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="vatEnabled" defaultChecked={profile?.vatEnabled ?? false} />This business is VAT registered — enable VAT</label>
      <Field label="VAT registration number"><input name="vatNumber" className={PAPER_INPUT} defaultValue={profile?.vatNumber} /></Field>
      <Field label="Default VAT rate (%)"><input required name="rate" type="number" min="0" max="100" step="0.01" className={PAPER_INPUT} defaultValue={(profile?.vat.rateBps ?? 1500) / 100} /></Field>
      <Field label="Default price basis"><select name="mode" className={PAPER_INPUT} defaultValue={profile?.vat.mode ?? "exclusive"}><option value="exclusive">Prices exclude VAT</option><option value="inclusive">Prices include VAT</option></select></Field>
    </fieldset>{error ? <p role="alert">{error}</p> : null}<div><PaperButton type="submit" disabled={busy} variant="amber">Save business details</PaperButton></div></form>
  </details><details><summary className="cursor-pointer font-semibold">Change history · {audit.length}</summary><p className="mt-3 text-sm text-paper-sage">Changes retain a prior-state backup. Voids correct mistaken entries; they do not refund money or create tax credit notes.</p><ol className="mt-3 divide-y divide-paper-mist">{audit.slice(0,50).map((entry) => <li key={entry.id} className="py-3 text-sm"><strong>{entry.action}</strong> · {new Date(entry.at).toLocaleString("en-ZA")} · {entry.recordIds.length} record(s){entry.reason ? <p>{entry.reason}</p> : null}{!entry.id.includes(":restored:") ? <a className="text-paper-blue underline" href={`${businessLedgerUrl(entityId)}/audit/${encodeURIComponent(entry.id)}/backup`} download>Download state before change</a> : <p>Restored audit summary; original snapshot is not included.</p>}</li>)}</ol>{audit.length > 50 ? <p className="text-xs">Showing the latest 50 changes. Download a ledger backup for the complete audit summary.</p> : null}</details></div>;
}
export function BusinessRecordCorrections({ record, records, busy, onAction }: { record: BusinessLedgerRecord; records: BusinessLedgerRecord[]; busy: boolean; onAction: (input: Action) => void }) {
  const [action, setAction] = useState<"void" | "allocate" | "reconcile">();
  const [error, setError] = useState("");
  if (record.voided || !["invoice", "quote", "payment", "expense"].includes(record.kind)) return null;
  const invoices = records.filter((row) => row.kind === "invoice" && !row.voided && row.status === "issued" && record.kind === "payment" && row.clientId === record.clientId);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const allocations = action === "allocate" ? invoices.map((row) => ({ invoiceId: row.id, amountMinor: minor(data.get(row.id) || "0") })).filter((entry) => entry.amountMinor > 0) : undefined;
      setError(""); onAction({ action: action!, id: record.id, reason: String(data.get("reason") ?? "").trim(), allocations });
    } catch (error) { setError(error instanceof Error ? error.message : "Check allocations."); }
  }
  return <div className="border-t border-paper-mist px-4 py-3"><div className="flex flex-wrap gap-2"><PaperButton variant="ghost" disabled={busy} onClick={() => setAction("void")}>Void incorrect entry</PaperButton>{record.kind === "payment" ? <PaperButton variant="ghost" disabled={busy} onClick={() => setAction("allocate")}>Manage allocations</PaperButton> : null}{record.kind === "invoice" && record.status === "historical_paid" ? <PaperButton disabled={busy} onClick={() => setAction("reconcile")}>Review historical balance</PaperButton> : null}</div>
    {action ? <form onSubmit={submit} className="mt-3 grid gap-3"><p className="text-sm text-paper-sage">{action === "void" ? "Use only to correct an incorrect entry. The original stays in history and is excluded from totals. This does not return money or issue a credit note." : action === "reconcile" ? "Confirm the balance after recording known payments. This invoice will enter outstanding totals using its total less actual payment allocations." : "Enter how much of this payment belongs to each invoice. Zero removes an allocation. Cash received is unchanged."}</p>
      <fieldset disabled={busy} className="grid gap-3">{action === "allocate" && record.kind === "payment" ? <><p className="text-sm">Payment received: {money(record.amountMinor)}</p>{invoices.map((invoice) => <Field key={invoice.id} label={`${"number" in invoice ? invoice.number ?? "" : ""} ${businessRecordLabel(invoice)} · current balance ${money(("amountMinor" in invoice ? invoice.amountMinor ?? 0 : 0) - businessInvoicePaid(records, invoice.id))}`}><input type="number" name={invoice.id} className={PAPER_INPUT} min="0" step="0.01" defaultValue={(record.allocations.find((entry) => entry.invoiceId === invoice.id)?.amountMinor ?? 0) / 100} /></Field>)}</> : null}<Field label="Reason for correction"><input required maxLength={1000} name="reason" className={PAPER_INPUT} /></Field></fieldset>{error ? <p role="alert">{error}</p> : null}<div className="flex gap-2"><PaperButton type="submit" disabled={busy}>Apply {action === "allocate" ? "allocations" : action === "void" ? "void" : "reviewed balance"}</PaperButton><PaperButton type="button" disabled={busy} onClick={() => setAction(undefined)}>Cancel</PaperButton></div></form> : null}
  </div>;
}
