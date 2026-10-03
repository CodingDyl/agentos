import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, it } from "node:test";
import { BusinessProfileSchema, type BusinessLedgerRecord } from "../../../shared/business-ledger-types";
import type { BusinessEntity } from "../../../shared/business-types";
import { buildBusinessHistory } from "../ledger-history";
import { applyBusinessOperation } from "../ledger-operations";
import { closeBusinessLedger, commitBusinessLedgerImport, exportBusinessLedger, getBusinessLedgerStatus, prepareBusinessHistory, prepareBusinessLedgerRestore } from "../ledger-store";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-billing-history-"));
const entity: BusinessEntity = { id: "virtec", name: "Test", kind: "agency", source: "virtec", workspaces: [] };
const client: BusinessLedgerRecord = { id: "crm-client", sourceId: "c1", source: "virtec", entityId: "virtec", kind: "client", name: "Client" };
beforeEach(() => { closeBusinessLedger(); process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, "case-")); const preview = prepareBusinessLedgerRestore(entity, { format: "agentos-business-ledger", version: 1, exportedAt: new Date().toISOString(), entity, records: [client] }); commitBusinessLedgerImport(entity, preview.id); });
after(() => { closeBusinessLedger(); fs.rmSync(root, { recursive: true, force: true }); });
const history = () => ({ format: "agentos-billing-history", version: 1, entityId: "virtec", invoices: [{ sourceId: "i1", clientSourceId: "c1", title: "Hosting", number: "VRT-1", amountMinor: 50000, issuedOn: "2026-09-25", status: "paid" }], payments: [], expenses: [{ sourceId: "e1", vendor: "Hosting supplier", category: "Hosting", amountMinor: 5000, paidOn: "2026-09-26" }] });
function prepare(value: unknown) { return prepareBusinessHistory(entity, buildBusinessHistory(value, entity.id, getBusinessLedgerStatus(entity.id).records)); }
it("imports paid flags without inventing cash receipts and protects history from overwrite", () => {
  let preview = prepare(history()); assert.equal(preview.ready, true); assert.deepEqual(preview.historyTotals, { invoices: 50000, payments: 0, expenses: 5000 }); assert.ok(preview.issues.some((issue) => issue.code === "unverified_payment"));
  let result = commitBusinessLedgerImport(entity, preview.id); assert.equal(result.counts.payment, 0);
  const invoice = result.records.find((row) => row.kind === "invoice")!; assert.ok(invoice.kind === "invoice"); assert.equal(invoice.status, "historical_paid");
  preview = prepare(history()); assert.equal(preview.changes.added, 0); assert.equal(preview.changes.updated, 0);
  const changed = history(); changed.invoices[0].amountMinor = 60000; assert.equal(prepare(changed).ready, false);
  result = applyBusinessOperation(entity, { revision: result.revision, action: "reconcile", id: invoice.id, reason: "Checked bank records: still unpaid" });
  const local = result.records.find((row) => row.id === invoice.id)!; assert.ok(local.kind === "invoice"); assert.equal(local.status, "issued");
  preview = prepare(history()); assert.ok(preview.issues.some((issue) => issue.code === "local_edit_preserved"));
});
it("rejects missing clients, ambiguous dates, source URLs, duplicate numbers and invalid allocations", () => {
  const wrong = history(); wrong.invoices[0].clientSourceId = "missing"; assert.throws(() => prepare(wrong), /source ID/);
  assert.throws(() => prepare({ ...history(), expenses: [{ ...history().expenses[0], paidOn: "next month" }] }), /transaction dates/);
  assert.throws(() => prepare({ ...history(), invoices: [{ ...history().invoices[0], pdfUrl: "https://example.com/private" }] }), /credentials/);
  assert.equal(prepare({ ...history(), invoices: [history().invoices[0], { ...history().invoices[0], sourceId: "i2" }] }).ready, false);
  assert.equal(prepare({ ...history(), payments: [{ sourceId: "p1", clientSourceId: "c1", amountMinor: 60000, receivedOn: "2026-09-26", allocations: [{ invoiceSourceId: "i1", amountMinor: 60000 }] }] }).ready, false);
});
it("restores profile, void reasons and audit summaries in a version-two backup", () => {
  let state = getBusinessLedgerStatus(entity.id);
  const profile = BusinessProfileSchema.parse({ legalName: "Test profile" });
  state = applyBusinessOperation(entity, { revision: state.revision, action: "profile", profile });
  state = applyBusinessOperation(entity, { revision: state.revision, action: "save", record: { id: "expense", sourceId: "expense", source: "agentos", entityId: "virtec", kind: "expense", vendor: "Mistake", category: "Other", amountMinor: 100, currency: "ZAR", paidOn: "2026-10-03" } });
  applyBusinessOperation(entity, { revision: state.revision, action: "void", id: "expense", reason: "Duplicate" });
  const backup = exportBusinessLedger(entity); assert.equal(backup.version, 2);
  closeBusinessLedger(); process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, "restore-"));
  const restored = commitBusinessLedgerImport(entity, prepareBusinessLedgerRestore(entity, backup).id);
  assert.equal(restored.profile?.legalName, "Test profile"); assert.equal(restored.audit.length, 3);
  assert.equal(restored.records.find((row) => row.id === "expense")?.voided?.reason, "Duplicate");
});

it("upgrades a version-one database without changing its records", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const before = getBusinessLedgerStatus(entity.id).records;
  const file = path.join(process.env.AGENTOS_UI_DIR!, "business", "ledger.db");
  closeBusinessLedger();
  const database = new DatabaseSync(file);
  database.exec("DROP TABLE ledger_profiles; DROP TABLE ledger_audit; ALTER TABLE ledger_previews DROP COLUMN profile; ALTER TABLE ledger_previews DROP COLUMN audit; PRAGMA user_version = 1;");
  database.close();
  const migrated = getBusinessLedgerStatus(entity.id);
  assert.deepEqual(migrated.records, before); assert.deepEqual(migrated.audit, []);
  const saved = applyBusinessOperation(entity, { revision: migrated.revision, action: "profile", profile: BusinessProfileSchema.parse({ legalName: "After upgrade" }) });
  assert.equal(saved.profile?.legalName, "After upgrade");
});
