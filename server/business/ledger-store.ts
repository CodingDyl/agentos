import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  BusinessImportPreviewSchema, BusinessLedgerBackupSchema, BusinessLedgerRecordSchema, BusinessProfileSchema, BusinessAuditEntrySchema,
  type BusinessProfile,
  businessRecordLabel, countBusinessRecords,
  type BusinessImportPreview, type BusinessLedgerBackup, type BusinessLedgerRecord, type BusinessLedgerStatus,
} from "../../shared/business-ledger-types";
import type { BusinessEntity } from "../../shared/business-types";
import type { VirtecSnapshot } from "../../shared/virtec-types";
import { uiStateDir } from "../agentos/session-store";
import { buildCrmImport, sumMinor, validateBusinessRecords } from "./ledger-import";

export class BusinessLedgerError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

let opened: { file: string; db: DatabaseSync } | undefined;
export function closeBusinessLedger(): void { opened?.db.close(); opened = undefined; }

function database(): DatabaseSync {
  const file = path.join(uiStateDir(), "business", "ledger.db");
  if (opened?.file === file) return opened.db;
  closeBusinessLedger();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  try {
    fs.chmodSync(file, 0o600);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > 2) throw new Error("Business database was created by a newer version of Agentos.");
    if (version === 0) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE ledger_meta (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
        INSERT INTO ledger_meta VALUES (1, 0);
        CREATE TABLE ledger_records (
          id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, kind TEXT NOT NULL,
          source TEXT NOT NULL, source_id TEXT NOT NULL, payload TEXT NOT NULL,
          UNIQUE(entity_id, source, kind, source_id)
        );
        CREATE INDEX ledger_records_entity ON ledger_records(entity_id);
        CREATE TABLE ledger_previews (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, expires_at TEXT NOT NULL, preview TEXT NOT NULL, records TEXT NOT NULL);
        CREATE TABLE ledger_imports (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, imported_at TEXT NOT NULL, preview TEXT NOT NULL, before_backup TEXT NOT NULL);
        PRAGMA user_version = 1;
        COMMIT;`);
    }
    if (version < 2) db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE ledger_profiles (entity_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE ledger_audit (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, entry TEXT NOT NULL, before_backup TEXT NOT NULL, fingerprint TEXT NOT NULL);
      CREATE INDEX ledger_audit_entity ON ledger_audit(entity_id);
      ALTER TABLE ledger_previews ADD COLUMN profile TEXT;
      ALTER TABLE ledger_previews ADD COLUMN audit TEXT;
      PRAGMA user_version = 2;
      COMMIT;`);
    opened = { file, db };
    return db;
  } catch (error) { db.close(); throw error; }
}

function revision(): number { return (database().prepare("SELECT revision FROM ledger_meta WHERE id = 1").get() as { revision: number }).revision; }
function recordsFor(entityId: string): BusinessLedgerRecord[] {
  return (database().prepare("SELECT payload FROM ledger_records WHERE entity_id = ? ORDER BY kind, id").all(entityId) as { payload: string }[])
    .map((row) => BusinessLedgerRecordSchema.parse(JSON.parse(row.payload)));
}

/** Canonical serialization so object property order is not treated as a source change. */
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Which business each of these record ids belongs to. Ids are unique across every business. */
export function businessLedgerRecordOwners(ids: readonly string[]): Map<string, string> {
  const owners = new Map<string, string>();
  const find = database().prepare("SELECT entity_id FROM ledger_records WHERE id = ?");
  for (const id of new Set(ids)) {
    const row = find.get(id) as { entity_id: string } | undefined;
    if (row) owners.set(id, row.entity_id);
  }
  return owners;
}

export function getBusinessLedgerStatus(entityId: string): BusinessLedgerStatus {
  const records = recordsFor(entityId);
  const last = database().prepare("SELECT imported_at, preview FROM ledger_imports WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1").get(entityId) as { imported_at: string; preview: string } | undefined;
  const preview = last ? BusinessImportPreviewSchema.parse(JSON.parse(last.preview)) : undefined;
  return { profile: getBusinessProfile(entityId), audit: auditFor(entityId), revision: revision(), counts: countBusinessRecords(records), records,
    lastImport: last && preview ? { at: last.imported_at, mode: preview.mode, ...preview.changes } : undefined };
}

export function exportBusinessLedger(entity: BusinessEntity): BusinessLedgerBackup {
  return BusinessLedgerBackupSchema.parse({ format: "agentos-business-ledger", version: 2, exportedAt: new Date().toISOString(), entity, profile: getBusinessProfile(entity.id), audit: auditFor(entity.id), records: recordsFor(entity.id) });
}

export function previousBusinessLedgerBackup(entityId: string): BusinessLedgerBackup {
  const last = database().prepare("SELECT before_backup FROM ledger_imports WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1").get(entityId) as { before_backup: string } | undefined;
  if (!last) throw new BusinessLedgerError("There is no previous import backup for this business.", 404);
  return BusinessLedgerBackupSchema.parse(JSON.parse(last.before_backup));
}

function prepare(entity: BusinessEntity, mode: "crm" | "restore" | "history", input: ReturnType<typeof buildCrmImport>, profile?: BusinessProfile, audit?: BusinessLedgerBackup["audit"]): BusinessImportPreview {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = recordsFor(entity.id);
    const current = new Map(existing.map((record) => [record.id, record]));
    const issues = [...input.issues];
    if (mode === "restore" && existing.length > 0) throw new BusinessLedgerError("Restore requires an empty local business ledger. Existing records will not be replaced.");
    if (mode !== "restore") input.records = input.records.map((record) => {
      const local = current.get(record.id);
      if (!local?.locallyEdited) return record;
      issues.push({ severity: "info", code: "local_edit_preserved", message: "Agentos edits preserved; CRM changes were not applied to this record.", recordId: record.id });
      return local;
    });
    const changes = { added: 0, updated: 0, unchanged: 0 };
    const rows = input.records.map((record) => {
      const previous = current.get(record.id);
      if (mode === "history" && previous && !previous.locallyEdited && canonical(previous) !== canonical(record)) issues.push({ severity: "error", code: "history_changed", message: "Previously imported history changed. Correct the existing record explicitly instead of overwriting it.", recordId: record.id });
      const change = !previous ? "added" : canonical(previous) === canonical(record) ? "unchanged" : "updated";
      if (previous && (previous.source !== record.source || previous.sourceId !== record.sourceId || previous.kind !== record.kind)) issues.push({ severity: "error", code: "ownership_conflict", message: "An incoming record conflicts with a locally owned record.", recordId: record.id });
      changes[change] += 1;
      return { id: record.id, kind: record.kind, label: businessRecordLabel(record), change, sourceId: record.sourceId, amountMinor: "amountMinor" in record ? record.amountMinor : undefined, date: record.kind === "payment" ? record.receivedOn : record.kind === "expense" ? record.paidOn : "issuedOn" in record ? record.issuedOn : undefined };
    });
    const incomingIds = new Set(input.records.map((record) => record.id));
    const retained = existing.filter((record) => !incomingIds.has(record.id));
    if (mode === "crm" && retained.some((record) => record.source === "virtec")) issues.push({ severity: "warning", code: "retained_records", message: "Previously imported records missing from this read will be retained. Import never deletes history." });
    try { validateBusinessRecords([...retained, ...input.records], entity.id); }
    catch (error) { issues.push({ severity: "error", code: "invalid_ledger", message: error instanceof Error ? error.message : "The resulting ledger is invalid." }); }
    const preview = BusinessImportPreviewSchema.parse({
      id: randomUUID(), entityId: entity.id, mode, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      baseRevision: revision(), ready: !issues.some((issue) => issue.severity === "error"),
      counts: countBusinessRecords(input.records), changes, issues, records: rows,
      historyTotals: mode === "history" ? {
        invoices: sumMinor(input.records.filter((record) => record.kind === "invoice").map((record) => "amountMinor" in record ? record.amountMinor ?? 0 : 0)),
        payments: sumMinor(input.records.filter((record) => record.kind === "payment").map((record) => "amountMinor" in record ? record.amountMinor ?? 0 : 0)),
        expenses: sumMinor(input.records.filter((record) => record.kind === "expense").map((record) => "amountMinor" in record ? record.amountMinor ?? 0 : 0)),
      } : undefined,
      pendingQuoteMinor: input.pendingQuoteMinor, unlinkedPendingQuoteMinor: input.unlinkedPendingQuoteMinor, reportedPendingQuoteMinor: input.reportedPendingQuoteMinor,
    });
    db.prepare("DELETE FROM ledger_previews WHERE expires_at < ?").run(new Date().toISOString());
    db.prepare("INSERT INTO ledger_previews (id, entity_id, expires_at, preview, records, profile, audit) VALUES (?, ?, ?, ?, ?, ?, ?)").run(preview.id, entity.id, preview.expiresAt, JSON.stringify(preview), JSON.stringify(input.records), profile ? JSON.stringify(profile) : null, audit ? JSON.stringify(audit) : null);
    db.exec("COMMIT");
    return preview;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function prepareCrmLedgerImport(entity: BusinessEntity, snapshot: VirtecSnapshot): BusinessImportPreview {
  if (entity.source !== "virtec") throw new BusinessLedgerError("This business is not linked to the CRM.");
  return prepare(entity, "crm", buildCrmImport(snapshot, entity.id));
}

export function prepareBusinessLedgerRestore(entity: BusinessEntity, value: unknown): BusinessImportPreview {
  const parsed = BusinessLedgerBackupSchema.safeParse(value);
  if (!parsed.success) throw new BusinessLedgerError("This is not a supported Agentos business ledger backup.", 422);
  const backup = parsed.data;
  if (backup.entity.id !== entity.id) throw new BusinessLedgerError("The backup belongs to a different business.", 422);
  try { validateBusinessRecords(backup.records, entity.id); }
  catch (error) { throw new BusinessLedgerError(error instanceof Error ? error.message : "Invalid backup.", 422); }
  return prepare(entity, "restore", { records: backup.records, issues: [{ severity: "info", code: "restore_scope", message: "Restore includes local ledger records and their source metadata. CRM access, original PDFs, and workspace settings are managed separately." }], pendingQuoteMinor: 0, unlinkedPendingQuoteMinor: 0, reportedPendingQuoteMinor: undefined }, backup.profile, backup.audit);
}

/** Apply precisely the reviewed snapshot, atomically, with an automatic pre-import backup. */
export function commitBusinessLedgerImport(entity: BusinessEntity, previewId: string): BusinessLedgerStatus {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT preview, records, profile, audit FROM ledger_previews WHERE id = ? AND entity_id = ?").get(previewId, entity.id) as { preview: string; records: string; profile: string | null; audit: string | null } | undefined;
    if (!row) throw new BusinessLedgerError("This preview was already used or does not exist. Prepare a fresh preview.");
    const preview = BusinessImportPreviewSchema.parse(JSON.parse(row.preview));
    if (!preview.ready) throw new BusinessLedgerError("Resolve the blocking import errors before importing.");
    if (Date.parse(preview.expiresAt) <= Date.now()) throw new BusinessLedgerError("This preview expired. Prepare a fresh preview.");
    if (preview.baseRevision !== revision()) throw new BusinessLedgerError("The local ledger changed after this preview. Prepare a fresh preview.");
    if (preview.mode === "crm" && entity.source !== "virtec") throw new BusinessLedgerError("This business is no longer linked to the CRM.");
    const incoming = (JSON.parse(row.records) as unknown[]).map((record) => BusinessLedgerRecordSchema.parse(record));
    const existing = recordsFor(entity.id);
    if (preview.mode === "restore" && existing.length) throw new BusinessLedgerError("Restore requires an empty local business ledger.");
    const incomingIds = new Set(incoming.map((record) => record.id));
    validateBusinessRecords([...existing.filter((record) => !incomingIds.has(record.id)), ...incoming], entity.id);
    const backup = exportBusinessLedger(entity);
    if (preview.mode === "restore" && row.profile) writeProfile(entity.id, BusinessProfileSchema.parse(JSON.parse(row.profile)));
    if (preview.mode === "restore" && row.audit) {
      const entries = JSON.parse(row.audit) as unknown[];
      for (const item of entries) {
        const entry = BusinessAuditEntrySchema.parse(item);
        entry.id = `${entity.id}:restored:${entry.id}`;
        db.prepare("INSERT OR IGNORE INTO ledger_audit VALUES (?, ?, ?, ?, ?, ?, ?)").run(entry.id, entity.id, entry.at, entry.action, JSON.stringify(entry), "", "restored");
      }
    }
    const insert = db.prepare(`INSERT INTO ledger_records VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
      WHERE ledger_records.entity_id = excluded.entity_id AND ledger_records.source = excluded.source AND ledger_records.source_id = excluded.source_id AND ledger_records.kind = excluded.kind`);
    for (const record of incoming) {
      const result = insert.run(record.id, entity.id, record.kind, record.source, record.sourceId, JSON.stringify(record));
      if (result.changes !== 1) throw new BusinessLedgerError("A record belongs to another business or source. Import was rolled back.");
    }
    db.prepare("INSERT INTO ledger_imports VALUES (?, ?, ?, ?, ?)").run(preview.id, entity.id, new Date().toISOString(), JSON.stringify(preview), JSON.stringify(backup));
    db.prepare("DELETE FROM ledger_previews WHERE id = ?").run(preview.id);
    db.exec("UPDATE ledger_meta SET revision = revision + 1 WHERE id = 1");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getBusinessLedgerStatus(entity.id);
}

/** Native changes share the import transaction and global optimistic revision lock. */
export function mutateBusinessLedger(entity: BusinessEntity, expectedRevision: number, transform: (records: BusinessLedgerRecord[]) => BusinessLedgerRecord[], options: { requestId?: string; fingerprint?: string; action?: string; reason?: string; profile?: BusinessProfile } = {}): BusinessLedgerStatus {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const operationId = `${entity.id}:${options.requestId ?? randomUUID()}`;
    const previous = db.prepare("SELECT fingerprint FROM ledger_audit WHERE id = ? AND entity_id = ?").get(operationId, entity.id) as { fingerprint: string } | undefined;
    if (previous) {
      if (previous.fingerprint !== options.fingerprint) throw new BusinessLedgerError("This request identifier was already used for different changes.");
      db.exec("COMMIT"); return getBusinessLedgerStatus(entity.id);
    }
    const before = exportBusinessLedger(entity);
    if (revision() !== expectedRevision) throw new BusinessLedgerError("Records changed. Refresh and try again.");
    const records = transform(recordsFor(entity.id)).map((record) => BusinessLedgerRecordSchema.parse(record));
    try { validateBusinessRecords(records, entity.id); }
    catch (error) { throw new BusinessLedgerError(error instanceof Error ? error.message : "Invalid records.", 422); }
    const insert = db.prepare(`INSERT INTO ledger_records VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
      WHERE ledger_records.entity_id = excluded.entity_id AND ledger_records.source = excluded.source AND ledger_records.source_id = excluded.source_id AND ledger_records.kind = excluded.kind`);
    for (const record of records) {
      if (insert.run(record.id, entity.id, record.kind, record.source, record.sourceId, JSON.stringify(record)).changes !== 1) throw new BusinessLedgerError("Record ownership conflict.");
    }
    if (options.profile) writeProfile(entity.id, options.profile);
    const at = new Date().toISOString();
    const changed = records.filter((record) => canonical(record) !== canonical(before.records.find((old) => old.id === record.id))).map((record) => record.id);
    const entry = { id: operationId, at, action: options.action ?? "save", reason: options.reason, recordIds: changed };
    db.prepare("INSERT INTO ledger_audit VALUES (?, ?, ?, ?, ?, ?, ?)").run(operationId, entity.id, at, entry.action, JSON.stringify(entry), JSON.stringify(before), options.fingerprint ?? "");
    db.exec("UPDATE ledger_meta SET revision = revision + 1 WHERE id = 1");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getBusinessLedgerStatus(entity.id);
}

export function getBusinessProfile(entityId: string): BusinessProfile | undefined {
  const row = database().prepare("SELECT payload FROM ledger_profiles WHERE entity_id = ?").get(entityId) as { payload: string } | undefined;
  return row ? BusinessProfileSchema.parse(JSON.parse(row.payload)) : undefined;
}
function writeProfile(entityId: string, profile: BusinessProfile) {
  database().prepare("INSERT INTO ledger_profiles VALUES (?, ?) ON CONFLICT(entity_id) DO UPDATE SET payload = excluded.payload").run(entityId, JSON.stringify(profile));
}
function auditFor(entityId: string) {
  return (database().prepare("SELECT entry FROM ledger_audit WHERE entity_id = ? ORDER BY rowid DESC").all(entityId) as { entry: string }[]).map((row) => BusinessAuditEntrySchema.parse(JSON.parse(row.entry)));
}
export function businessAuditBackup(entityId: string, id: string): BusinessLedgerBackup {
  const row = database().prepare("SELECT before_backup FROM ledger_audit WHERE entity_id = ? AND id = ?").get(entityId, id) as { before_backup: string } | undefined;
  if (!row || !row.before_backup) throw new BusinessLedgerError("The earlier snapshot is unavailable for this restored audit entry.", 404);
  return BusinessLedgerBackupSchema.parse(JSON.parse(row.before_backup));
}
export function prepareBusinessHistory(entity: BusinessEntity, input: ReturnType<typeof buildCrmImport>) {
  return prepare(entity, "history", input);
}
