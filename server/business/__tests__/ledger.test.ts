import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { BusinessEntity } from "../../../shared/business-types";
import { BusinessLedgerBackupSchema, type BusinessLedgerRecord } from "../../../shared/business-ledger-types";
import type { VirtecSnapshot } from "../../../shared/virtec-types";
import { buildCrmImport, randToMinor, validateBusinessRecords } from "../ledger-import";
import { closeBusinessLedger, commitBusinessLedgerImport, exportBusinessLedger, getBusinessLedgerStatus, prepareBusinessLedgerRestore, prepareCrmLedgerImport, previousBusinessLedgerBackup } from "../ledger-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-business-ledger-"));
const entity: BusinessEntity = { id: "virtec", name: "Virtara", source: "virtec", kind: "agency", workspaces: [] };
let testDirectory = "";
beforeEach(() => { closeBusinessLedger(); testDirectory = fs.mkdtempSync(path.join(root, "case-")); process.env.AGENTOS_UI_DIR = testDirectory; });
after(() => { closeBusinessLedger(); fs.rmSync(root, { recursive: true, force: true }); });

function snapshot(): VirtecSnapshot {
  return {
    configured: true, fetchedAt: "2026-10-03T12:00:00.000Z",
    sources: Object.fromEntries(["clients", "projects", "quotes", "revenue", "leads", "inbound", "followUps"].map((name) => [name, { ok: true, skipped: 0 }])) as VirtecSnapshot["sources"],
    clients: [{ id: "c1", name: "Client", companyName: "Client Company", maintenance: true, active: true }],
    projects: [{ id: "p1", clientId: "c1", projectType: "Hosting", status: "active", maintenanceAmount: 500 }],
    quotes: [{ id: "q1", projectId: "p1", totalAmount: 4500.25, status: "pending", features: ["Hosting"], createdAt: "2026-09-25T10:00:00.000Z" }],
    revenue: { pendingQuoteValue: 4500.25 }, leads: [], inbound: [], followUps: [],
  };
}

describe("business migration planning", () => {
  it("stores cents exactly and refuses invalid or unsafe amounts", () => {
    assert.equal(randToMinor(4500.25), 450025);
    assert.equal(randToMinor(0.29), 29);
    assert.equal(randToMinor(undefined), undefined);
    for (const invalid of [-1, 1.001, Infinity, NaN, Number.MAX_SAFE_INTEGER]) assert.throws(() => randToMinor(invalid));
  });

  it("resolves client references only through exact project IDs and keeps the original source", () => {
    const planned = buildCrmImport(snapshot(), entity.id);
    const client = planned.records.find((record) => record.kind === "client")!;
    const quote = planned.records.find((record) => record.kind === "quote")!;
    assert.ok(quote.kind === "quote");
    assert.equal(quote.clientId, client.id);
    assert.equal(quote.amountMinor, 450025);
    assert.equal(quote.number, undefined);
    assert.equal(quote.sourceRecord?.projectId, "p1");
    assert.equal(quote.sourceCreatedAt, "2026-09-25T10:00:00.000Z");
    assert.equal(planned.pendingQuoteMinor, 450025);
    assert.equal(planned.unlinkedPendingQuoteMinor, 0);
  });

  it("exposes unlinked quote value and preserves an unknown total", () => {
    const source = snapshot();
    source.quotes[0].projectId = undefined;
    source.quotes.push({ id: "unknown", status: "pending", features: [] });
    const plan = buildCrmImport(source, entity.id);
    assert.equal(plan.unlinkedPendingQuoteMinor, 450025);
    const unknown = plan.records.find((record) => record.sourceId === "unknown")!;
    assert.ok("amountMinor" in unknown);
    assert.equal(unknown.amountMinor, undefined);
    assert.ok(plan.issues.some((issue) => issue.code === "unknown_amount"));
  });

  it("never activates a guessed billing schedule or fabricates financial history", () => {
    const source = snapshot();
    source.projects[0].status = "completed";
    const planned = buildCrmImport(source, entity.id);
    const service = planned.records.find((record) => record.kind === "service")!;
    assert.ok(service.kind === "service");
    assert.equal(service.state, "needs_setup");
    assert.equal(service.cadence, undefined);
    assert.equal(service.nextInvoiceDate, undefined);
    assert.equal(planned.records.some((record) => ["invoice", "payment", "expense"].includes(record.kind)), false);
  });

  it("blocks failed, skipped, truncated, invalid, and duplicate source records", () => {
    const cases = [snapshot(), snapshot(), snapshot(), snapshot(), snapshot()];
    cases[0].sources!.quotes.ok = false;
    cases[1].sources!.clients.skipped = 1;
    cases[2].clients = Array.from({ length: 500 }, (_, index) => ({ id: `c${index}`, name: `Client ${index}` }));
    cases[3].quotes[0].totalAmount = -100;
    cases[4].clients.push({ ...cases[4].clients[0] });
    for (const source of cases) {
      const preview = prepareCrmLedgerImport(entity, source);
      assert.equal(preview.ready, false);
      assert.throws(() => commitBusinessLedgerImport(entity, preview.id), /blocking/);
      assert.equal(getBusinessLedgerStatus(entity.id).records.length, 0);
    }
  });
});

describe("business ledger persistence", () => {
  it("previews without changing records and imports repeatedly without duplicates", () => {
    const first = prepareCrmLedgerImport(entity, snapshot());
    assert.equal(first.ready, true);
    assert.equal(getBusinessLedgerStatus(entity.id).records.length, 0);
    const committed = commitBusinessLedgerImport(entity, first.id);
    assert.equal(committed.records.length, 4);
    assert.equal(committed.lastImport?.added, 4);
    const repeat = prepareCrmLedgerImport(entity, snapshot());
    assert.deepEqual(repeat.changes, { added: 0, updated: 0, unchanged: 4 });
    commitBusinessLedgerImport(entity, repeat.id);
    assert.equal(getBusinessLedgerStatus(entity.id).records.length, 4);
    assert.throws(() => commitBusinessLedgerImport(entity, repeat.id), /already used/);
  });

  it("updates the same source identity and retains records absent from a later source", () => {
    commitBusinessLedgerImport(entity, prepareCrmLedgerImport(entity, snapshot()).id);
    const source = snapshot(); source.clients[0].companyName = "Changed Company"; source.quotes = [];
    const preview = prepareCrmLedgerImport(entity, source);
    assert.equal(preview.changes.updated, 1);
    assert.ok(preview.issues.some((issue) => issue.code === "retained_records"));
    const result = commitBusinessLedgerImport(entity, preview.id);
    assert.equal(result.records.length, 4);
    assert.equal(result.counts.quote, 1);
    assert.equal(previousBusinessLedgerBackup(entity.id).records.filter((record) => record.kind === "client")[0].companyName, "Client Company");
  });

  it("rejects stale previews and leaves the ledger unchanged", () => {
    const one = prepareCrmLedgerImport(entity, snapshot());
    const two = prepareCrmLedgerImport(entity, snapshot());
    commitBusinessLedgerImport(entity, one.id);
    assert.throws(() => commitBusinessLedgerImport(entity, two.id), /changed after/);
    assert.equal(getBusinessLedgerStatus(entity.id).revision, 1);
  });

  it("rejects expired previews", () => {
    const preview = prepareCrmLedgerImport(entity, snapshot());
    closeBusinessLedger();
    const db = new DatabaseSync(path.join(testDirectory, "business", "ledger.db"));
    db.prepare("UPDATE ledger_previews SET preview = ? WHERE id = ?").run(JSON.stringify({ ...preview, expiresAt: "2020-01-01T00:00:00.000Z" }), preview.id);
    db.close();
    assert.throws(() => commitBusinessLedgerImport(entity, preview.id), /expired/);
    assert.equal(getBusinessLedgerStatus(entity.id).records.length, 0);
  });

  it("survives closing and reopening the database", () => {
    commitBusinessLedgerImport(entity, prepareCrmLedgerImport(entity, snapshot()).id);
    const before = getBusinessLedgerStatus(entity.id);
    closeBusinessLedger();
    assert.deepEqual(getBusinessLedgerStatus(entity.id), before);
  });

  it("exports and restores records, source IDs, and monetary values into an empty ledger", () => {
    commitBusinessLedgerImport(entity, prepareCrmLedgerImport(entity, snapshot()).id);
    const backup = exportBusinessLedger(entity);
    assert.ok(BusinessLedgerBackupSchema.safeParse(backup).success);
    assert.throws(() => prepareBusinessLedgerRestore(entity, backup), /empty/);
    closeBusinessLedger(); process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, "restored-"));
    const preview = prepareBusinessLedgerRestore(entity, JSON.parse(JSON.stringify(backup)));
    assert.equal(preview.ready, true);
    const restored = commitBusinessLedgerImport(entity, preview.id);
    assert.deepEqual(restored.records, backup.records);
    assert.equal(previousBusinessLedgerBackup(entity.id).records.length, 0);
  });

  it("keeps entities isolated and rejects a backup for another business", () => {
    const preview = prepareCrmLedgerImport(entity, snapshot());
    const other = { ...entity, id: "other" };
    assert.throws(() => commitBusinessLedgerImport(other, preview.id), /does not exist/);
    commitBusinessLedgerImport(entity, preview.id);
    assert.equal(getBusinessLedgerStatus(other.id).records.length, 0);
    assert.throws(() => prepareBusinessLedgerRestore(other, exportBusinessLedger(entity)), /different business/);
  });

  it("rolls back every record when an ID collides with another entity", () => {
    commitBusinessLedgerImport(entity, prepareCrmLedgerImport(entity, snapshot()).id);
    const backup = exportBusinessLedger(entity);
    const other = { ...entity, id: "other" };
    const altered = { ...backup, entity: other, records: backup.records.map((record) => ({ ...record, entityId: other.id })) };
    const preview = prepareBusinessLedgerRestore(other, altered);
    assert.throws(() => commitBusinessLedgerImport(other, preview.id), /rolled back/);
    assert.equal(getBusinessLedgerStatus(other.id).records.length, 0);
    assert.equal(getBusinessLedgerStatus(entity.id).records.length, 4);
  });
});

describe("business ledger relationships", () => {
  const base = { entityId: "virtec", source: "agentos" as const };
  const client: BusinessLedgerRecord = { ...base, kind: "client", id: "client", sourceId: "client", name: "Client" };
  const invoice: BusinessLedgerRecord = { ...base, kind: "invoice", id: "invoice", sourceId: "invoice", clientId: "client", title: "Hosting", detail: "summary", number: "VRT-2026-0038", currency: "ZAR", amountMinor: 50000 };
  const payment: BusinessLedgerRecord = { ...base, kind: "payment", id: "payment", sourceId: "payment", clientId: "client", currency: "ZAR", amountMinor: 25000, receivedOn: "2026-10-03", allocations: [{ invoiceId: "invoice", amountMinor: 25000 }] };
  it("accepts partial payments but rejects over-allocation and wrong-client payments", () => {
    validateBusinessRecords([client, invoice, payment], "virtec");
    assert.throws(() => validateBusinessRecords([client, invoice, { ...payment, amountMinor: 10000 }], "virtec"), /exceed/);
    assert.throws(() => validateBusinessRecords([client, invoice, payment, { ...payment, id: "p2", sourceId: "p2", amountMinor: 30000, allocations: [{ invoiceId: "invoice", amountMinor: 30000 }] }], "virtec"), /exceed/);
    const otherClient = { ...client, id: "other", sourceId: "other" };
    assert.throws(() => validateBusinessRecords([client, otherClient, invoice, { ...payment, clientId: "other" }], "virtec"), /same client/);
  });
  it("rejects duplicate document numbers and dangling references", () => {
    assert.throws(() => validateBusinessRecords([client, invoice, { ...invoice, id: "second", sourceId: "second" }], "virtec"), /document number/);
    assert.throws(() => validateBusinessRecords([invoice], "virtec"), /client link/);
  });
  it("preserves invoice numbers, payment dates, and expenses in backup round trips", () => {
    const expense: BusinessLedgerRecord = { ...base, kind: "expense", id: "expense", sourceId: "expense", vendor: "Hosting provider", category: "Hosting", currency: "ZAR", amountMinor: 12345, paidOn: "2026-09-28" };
    const backup = { format: "agentos-business-ledger", version: 1, exportedAt: new Date().toISOString(), entity, records: [client, invoice, payment, expense] };
    const preview = prepareBusinessLedgerRestore(entity, backup);
    commitBusinessLedgerImport(entity, preview.id);
    const exported = exportBusinessLedger(entity);
    const savedInvoice = exported.records.find((record) => record.kind === "invoice");
    assert.ok(savedInvoice?.kind === "invoice");
    assert.equal(savedInvoice.number, "VRT-2026-0038");
    assert.equal(exported.records.find((record) => record.kind === "payment")?.receivedOn, "2026-10-03");
    assert.equal(exported.records.find((record) => record.kind === "expense")?.amountMinor, 12345);
  });
});

it("preserves locally edited CRM records during later imports", async () => {
  const { applyBusinessOperation } = await import("../ledger-operations");
  const preview = prepareCrmLedgerImport(entity, snapshot());
  const imported = commitBusinessLedgerImport(entity, preview.id);
  const client = imported.records.find((record) => record.kind === "client")!;
  assert.ok(client.kind === "client");
  applyBusinessOperation(entity, { revision: imported.revision, action: "save", record: { ...client, name: "Locally corrected" } });
  const second = prepareCrmLedgerImport(entity, snapshot());
  assert.ok(second.issues.some((issue) => issue.code === "local_edit_preserved"));
  const result = commitBusinessLedgerImport(entity, second.id).records.find((record) => record.id === client.id)!;
  assert.ok(result.kind === "client"); assert.equal(result.name, "Locally corrected");
});
