import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { BusinessLedgerRecordSchema, BusinessProfileSchema, BusinessLedgerPaymentSchema, type BusinessLedgerRecord } from "../../shared/business-ledger-types";
import type { BusinessEntity } from "../../shared/business-types";
import { calculateBusinessTotals, businessInvoicePaid } from "../../shared/business-billing-calculations";
import { BusinessLedgerError, getBusinessProfile, mutateBusinessLedger } from "./ledger-store";

export const BusinessOperationSchema = z.object({
  revision: z.number().int().nonnegative(),
  action: z.enum(["save", "issue", "accept", "convert", "generate", "void", "allocate", "profile", "reconcile"]),
  requestId: z.uuid().optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
  profile: BusinessProfileSchema.optional(),
  allocations: BusinessLedgerPaymentSchema.shape.allocations.optional(),
  record: BusinessLedgerRecordSchema.optional(),
  id: z.string().max(256).optional(),
  date: z.iso.date().optional(),
}).strict();
export type BusinessOperation = z.infer<typeof BusinessOperationSchema>;
const reject = (message: string): never => { throw new BusinessLedgerError(message, 422); };
function totals(record: BusinessLedgerRecord) {
  if ((record.kind !== "quote" && record.kind !== "invoice") || !record.items?.length) return reject("Add at least one line item.");
  try { return calculateBusinessTotals(record.items, record.tax); }
  catch { return reject("Document total is too large."); }
}
export function nextServiceDate(date: string, months: number, anchorDay?: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDay ?? day, last));
  return target.toISOString().slice(0, 10);
}
export function applyBusinessOperation(entity: BusinessEntity, input: BusinessOperation) {
  if (input.action === "profile" && !input.profile) return reject("Business details are required.");
  return mutateBusinessLedger(entity, input.revision, (records) => {
    const profile = getBusinessProfile(entity.id);
    const current = records.find((record) => record.id === input.id);
    const appendDocument = (base: BusinessLedgerRecord, extras: object) => {
      const id = randomUUID();
      const document = BusinessLedgerRecordSchema.parse({ ...base, ...extras, id, entityId: entity.id, source: "agentos", sourceId: id, sourceRecord: undefined, sourceCreatedAt: undefined, number: undefined, status: "draft", locallyEdited: true });
      records.push(document);
    };
    if (input.action === "profile") return records;
    if (["void", "allocate", "reconcile"].includes(input.action)) {
      if (!current || current.voided) return reject("Choose an active record.");
      if (!input.reason) return reject("Enter a reason so the correction can be audited.");
      if (input.action === "void") {
        if (!["payment", "expense", "quote", "invoice"].includes(current.kind)) return reject("This record cannot be voided.");
        if (current.kind === "invoice" && (businessInvoicePaid(records, current.id) > 0 || current.status === "historical_paid")) return reject("Reconcile or remove payment allocations before voiding this invoice.");
        if (current.kind === "quote" && records.some((row) => row.kind === "invoice" && row.convertedFrom === current.id && !row.voided)) return reject("Void the linked invoice before voiding its quote.");
        current.voided = { at: new Date().toISOString(), reason: input.reason };
      } else if (input.action === "allocate") {
        if (current.kind !== "payment" || !input.allocations) return reject("Choose a payment and its new allocations.");
        for (const allocation of input.allocations) {
          const invoice = records.find((row) => row.id === allocation.invoiceId);
          if (!invoice || invoice.kind !== "invoice" || invoice.status !== "issued" || invoice.voided) return reject("Allocate only to active issued invoices.");
        }
        current.allocations = input.allocations;
      } else {
        if (current.kind !== "invoice" || current.status !== "historical_paid") return reject("Only historical paid invoices need balance reconciliation.");
        current.status = "issued";
      }
      current.locallyEdited = true;
      return records;
    }
    if (input.action === "save") {
      if (!input.record) return reject("A record is required.");
      let record = input.record;
      const old = records.find((row) => row.id === record.id);
      if (record.entityId !== entity.id || record.kind === "project") return reject("Invalid business record.");
      if (old && (old.kind !== record.kind || old.source !== record.source || old.sourceId !== record.sourceId)) return reject("Record identity cannot change.");
      if (!old && (record.source !== "agentos" || record.id !== record.sourceId)) return reject("New records must be owned by Agentos.");
      if (old?.voided) return reject("Voided records cannot be edited.");
      if (old && (old.kind === "payment" || old.kind === "expense" || ((old.kind === "quote" || old.kind === "invoice") && old.status !== "draft"))) return reject("Posted records cannot be edited. Preserve the original financial history.");
      if (record.kind === "invoice" || record.kind === "quote") {
        record = { ...record, status: "draft", detail: "complete", number: undefined, ...totals(record), issuerDetails: profile, issuerName: record.tax ? profile?.legalName ?? entity.name : record.issuerName ?? profile?.legalName ?? entity.name, convertedFrom: old && (old.kind === "quote" || old.kind === "invoice") ? old.convertedFrom : undefined, serviceId: old && (old.kind === "quote" || old.kind === "invoice") ? old.serviceId : undefined, servicePeriod: old && (old.kind === "quote" || old.kind === "invoice") ? old.servicePeriod : undefined };
      }
      if ((record.kind === "quote" || record.kind === "invoice" || record.kind === "service") && record.tax && !profile?.vatEnabled) return reject("Enable VAT in Business details before applying it.");
      if (record.kind === "payment") for (const allocation of record.allocations) {
        const invoice = records.find((row) => row.id === allocation.invoiceId);
        if (!invoice || invoice.kind !== "invoice" || invoice.status !== "issued" || invoice.voided) return reject("Payments can only be allocated to issued invoices.");
      }
      if (record.kind === "service" && record.nextInvoiceDate && (!old || old.kind !== "service" || old.nextInvoiceDate !== record.nextInvoiceDate)) record.billingDay = Number(record.nextInvoiceDate.slice(8));
      record = { ...record, voided: undefined, locallyEdited: true, sourceRecord: old?.sourceRecord, sourceCreatedAt: old?.sourceCreatedAt };
      return [...records.filter((row) => row.id !== record.id), record];
    }
    if (input.action === "generate") {
      if (!input.date) return reject("Choose a billing date.");
      for (const service of [...records]) {
        if (service.kind !== "service" || service.state !== "active" || !service.nextInvoiceDate || service.nextInvoiceDate > input.date) continue;
        const period = service.nextInvoiceDate;
        if (records.some((row) => row.kind === "invoice" && row.serviceId === service.id && row.servicePeriod === period)) return reject("An invoice already exists for this service period.");
        const months = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, "ad-hoc": 0 }[service.cadence ?? "ad-hoc"];
        if (!months || !service.clientId || !service.amountMinor) return reject("Complete the service schedule first.");
        appendDocument(service, { kind: "invoice", detail: "complete", serviceId: service.id, servicePeriod: period, issuedOn: period, dueOn: nextServiceDate(period, 1), items: [{ description: `${service.title} — ${period}`, quantity: 1, unitPriceMinor: service.amountMinor }], ...calculateBusinessTotals([{ quantity: 1, unitPriceMinor: service.amountMinor }], service.tax), tax: service.tax, issuerDetails: profile, issuerName: profile?.legalName ?? entity.name, terms: profile?.defaultTerms ?? "Payment due by the due date." });
        service.billingDay ??= Number(period.slice(8));
        service.nextInvoiceDate = nextServiceDate(period, months, service.billingDay); service.locallyEdited = true;
      }
      return records;
    }
    if (!current || current.voided || (current.kind !== "quote" && current.kind !== "invoice")) return reject("Document not found.");
    if (input.action === "issue") {
      if (current.status !== "draft" || current.detail !== "complete" || !current.clientId || !current.issuedOn || !current.dueOn) return reject("A draft needs a client, issue date, due date and line items.");
      if (current.dueOn < current.issuedOn) return reject("The due date cannot precede the issue date.");
      Object.assign(current, totals(current));
      if (current.tax && (!current.issuerDetails?.vatEnabled || !current.issuerDetails.vatNumber || !current.issuerDetails.address)) return reject("Save this draft with a complete VAT-enabled business profile first.");
      const client = records.find((row) => row.id === current.clientId);
      if (!client || client.kind !== "client") return reject("Choose a valid client.");
      if (current.tax && !client.address?.trim()) return reject("Add the client's billing address before issuing a VAT document.");
      current.clientAddress = client.address; current.clientVatNumber = client.vatNumber;
      current.clientName = client.companyName ?? client.name;
      const prefix = `AG-${current.kind === "quote" ? "Q" : "I"}-${current.issuedOn.slice(0,4)}-`;
      let sequence = 1;
      while (records.some((row) => (row.kind === "quote" || row.kind === "invoice") && row.number === `${prefix}${String(sequence).padStart(5,"0")}`)) sequence++;
      current.number = `${prefix}${String(sequence).padStart(5,"0")}`;
      current.status = "issued";
    } else if (input.action === "accept") {
      if (current.kind !== "quote" || current.status !== "issued") return reject("Only an issued quote can be accepted.");
      current.status = "accepted";
    } else if (input.action === "convert") {
      if (current.kind !== "quote" || current.status !== "accepted" || current.detail !== "complete") return reject("Only a complete accepted quote can become an invoice.");
      if (records.some((row) => row.kind === "invoice" && row.convertedFrom === current.id)) return reject("This quote already has an invoice.");
      appendDocument(current, { kind: "invoice", convertedFrom: current.id, issuedOn: input.date ?? current.issuedOn });
    }
    current.locallyEdited = true;
    return records;
  }, { requestId: input.requestId, fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"), action: input.action, reason: input.reason, profile: input.action === "profile" ? input.profile : undefined });
}
