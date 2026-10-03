import { z } from "zod";
import { BusinessEntitySchema } from "./business-types";

/** Local business records. Currency amounts are integer minor units, never floats. */
export const BusinessMinorAmountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(256);
const text = z.string().min(1).max(1000);
const day = z.iso.date();
const money = { currency: z.literal("ZAR"), amountMinor: BusinessMinorAmountSchema.optional() };
export const BusinessVatSchema = z.object({ rateBps: z.number().int().min(0).max(10000), mode: z.enum(["exclusive", "inclusive"]) });
export const BusinessProfileSchema = z.object({
  legalName: text, address: z.string().max(2000).default(""), email: z.string().max(320).default(""),
  vatEnabled: z.boolean().default(false), vatNumber: z.string().max(100).default(""),
  vat: BusinessVatSchema.default({ rateBps: 1500, mode: "exclusive" }),
  paymentInstructions: z.string().max(3000).default(""), defaultTerms: z.string().max(3000).default("Payment due by the due date."),
}).superRefine((profile, context) => {
  if (profile.vatEnabled && (!profile.vatNumber.trim() || !profile.address.trim())) context.addIssue({ code: "custom", message: "VAT requires the supplier address and VAT registration number." });
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
export const BusinessAuditEntrySchema = z.object({ id: z.string(), at: z.string(), action: z.string(), reason: z.string().optional(), recordIds: z.array(z.string()) });
export type BusinessAuditEntry = z.infer<typeof BusinessAuditEntrySchema>;
const common = z.object({
  id,
  entityId: BusinessEntitySchema.shape.id,
  source: z.enum(["virtec", "agentos"]),
  sourceId: id,
  voided: z.object({ at: z.iso.datetime(), reason: z.string().min(1).max(1000) }).optional(),
  locallyEdited: z.boolean().optional(),
  sourceCreatedAt: z.iso.datetime({ offset: true }).optional(),
  /** The normalized source record, retained for reconciliation; never a credential or PDF URL. */
  sourceRecord: z.record(z.string(), z.unknown()).optional(),
});

export const BusinessLedgerClientSchema = common.extend({
  kind: z.literal("client"),
  name: text,
  companyName: text.optional(),
  email: z.string().max(320).optional(),
  address: z.string().max(2000).optional(),
  vatNumber: z.string().max(100).optional(),
  active: z.boolean().optional(),
  maintenance: z.boolean().optional(),
});
export const BusinessLedgerProjectSchema = common.extend({
  kind: z.literal("project"),
  clientId: id.optional(),
  title: text,
  status: z.string().max(100).optional(),
  ...money,
});
export const BusinessLedgerServiceSchema = common.extend({
  kind: z.literal("service"),
  clientId: id.optional(),
  projectId: id.optional(),
  title: text,
  cadence: z.enum(["monthly", "quarterly", "semiannual", "annual", "ad-hoc"]).optional(),
  state: z.enum(["needs_setup", "active", "paused", "cancelled"]),
  nextInvoiceDate: day.optional(),
  tax: BusinessVatSchema.optional(),
  billingDay: z.number().int().min(1).max(31).optional(),
  ...money,
});
export const BusinessLedgerDocumentSchema = common.extend({
  kind: z.enum(["quote", "invoice"]),
  clientId: id.optional(),
  projectId: id.optional(),
  title: text,
  /** Missing for a CRM summary. Do not invent document numbers or line items. */
  number: z.string().min(1).max(100).optional(),
  items: z.array(z.object({ description: text, quantity: z.number().int().positive().max(100000), unitPriceMinor: BusinessMinorAmountSchema })).max(100).optional(),
  tax: BusinessVatSchema.optional(),
  subtotalMinor: BusinessMinorAmountSchema.optional(),
  vatMinor: BusinessMinorAmountSchema.optional(),
  issuerDetails: BusinessProfileSchema.optional(),
  clientAddress: z.string().max(2000).optional(),
  clientVatNumber: z.string().max(100).optional(),
  terms: z.string().max(5000).optional(),
  issuerName: text.optional(),
  clientName: text.optional(),
  convertedFrom: id.optional(),
  serviceId: id.optional(),
  servicePeriod: day.optional(),
  detail: z.enum(["summary", "complete"]),
  status: z.string().max(100).optional(),
  issuedOn: day.optional(),
  dueOn: day.optional(),
  ...money,
});
export const BusinessLedgerPaymentSchema = common.extend({
  kind: z.literal("payment"),
  clientId: id,
  currency: z.literal("ZAR"),
  amountMinor: BusinessMinorAmountSchema.positive(),
  receivedOn: day,
  reference: z.string().max(500).optional(),
  allocations: z.array(z.object({ invoiceId: id, amountMinor: BusinessMinorAmountSchema.positive() })).max(500),
});
export const BusinessLedgerExpenseSchema = common.extend({
  kind: z.literal("expense"),
  vendor: text,
  category: text,
  projectId: id.optional(),
  currency: z.literal("ZAR"),
  amountMinor: BusinessMinorAmountSchema,
  paidOn: day,
  reference: z.string().max(500).optional(),
});

export const BusinessLedgerRecordSchema = z.discriminatedUnion("kind", [
  BusinessLedgerClientSchema, BusinessLedgerProjectSchema, BusinessLedgerServiceSchema,
  BusinessLedgerDocumentSchema, BusinessLedgerPaymentSchema, BusinessLedgerExpenseSchema,
]);
export type BusinessLedgerRecord = z.infer<typeof BusinessLedgerRecordSchema>;
export const BUSINESS_LEDGER_KINDS = ["client", "project", "service", "quote", "invoice", "payment", "expense"] as const;
export type BusinessLedgerKind = (typeof BUSINESS_LEDGER_KINDS)[number];

export const BusinessImportIssueSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string(),
  message: z.string(),
  recordId: z.string().optional(),
});
export type BusinessImportIssue = z.infer<typeof BusinessImportIssueSchema>;
export const BusinessLedgerCountsSchema = z.record(z.enum(BUSINESS_LEDGER_KINDS), z.number().int().nonnegative());

export const BusinessImportPreviewSchema = z.object({
  id: z.uuid(),
  entityId: BusinessEntitySchema.shape.id,
  mode: z.enum(["crm", "restore", "history"]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  baseRevision: z.number().int().nonnegative(),
  ready: z.boolean(),
  counts: BusinessLedgerCountsSchema,
  changes: z.object({ added: z.number(), updated: z.number(), unchanged: z.number() }),
  issues: z.array(BusinessImportIssueSchema),
  pendingQuoteMinor: BusinessMinorAmountSchema,
  unlinkedPendingQuoteMinor: BusinessMinorAmountSchema,
  reportedPendingQuoteMinor: BusinessMinorAmountSchema.optional(),
  historyTotals: z.object({ invoices: BusinessMinorAmountSchema, payments: BusinessMinorAmountSchema, expenses: BusinessMinorAmountSchema }).optional(),
  records: z.array(z.object({ amountMinor: BusinessMinorAmountSchema.optional(), date: z.string().optional(), sourceId: z.string().optional(), id: z.string(), kind: z.enum(BUSINESS_LEDGER_KINDS), label: z.string(), change: z.enum(["added", "updated", "unchanged"]) })),
});
export type BusinessImportPreview = z.infer<typeof BusinessImportPreviewSchema>;

export const BusinessLedgerBackupSchema = z.object({
  format: z.literal("agentos-business-ledger"),
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.iso.datetime(),
  entity: BusinessEntitySchema,
  profile: BusinessProfileSchema.optional(),
  audit: z.array(BusinessAuditEntrySchema).optional(),
  records: z.array(BusinessLedgerRecordSchema).max(10_000),
});
export type BusinessLedgerBackup = z.infer<typeof BusinessLedgerBackupSchema>;
export const BusinessLedgerStatusSchema = z.object({
  profile: BusinessProfileSchema.optional(),
  audit: z.array(BusinessAuditEntrySchema).default([]),
  revision: z.number().int().nonnegative(),
  counts: BusinessLedgerCountsSchema,
  lastImport: z.object({ at: z.string(), mode: z.enum(["crm", "restore", "history"]), added: z.number(), updated: z.number(), unchanged: z.number() }).optional(),
  records: z.array(BusinessLedgerRecordSchema),
});
export type BusinessLedgerStatus = z.infer<typeof BusinessLedgerStatusSchema>;

export function countBusinessRecords(records: readonly BusinessLedgerRecord[]): z.infer<typeof BusinessLedgerCountsSchema> {
  const counts = { client: 0, project: 0, service: 0, quote: 0, invoice: 0, payment: 0, expense: 0 };
  for (const record of records) counts[record.kind] += 1;
  return counts;
}

export function businessRecordLabel(record: BusinessLedgerRecord): string {
  return record.kind === "client" ? record.companyName ?? record.name
    : record.kind === "expense" ? record.vendor
      : record.kind === "payment" ? record.reference ?? `Payment ${record.sourceId}`
        : record.title;
}
