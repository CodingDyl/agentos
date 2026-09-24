import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * The SEO audit store — its own file, same reasoning as `mail.db` (see
 * `server/mail/db.ts`): this is a cache of what a crawl found, keyed by
 * project, and deleting it loses history and nothing else. The live site
 * stays the source of truth.
 */

let database: DatabaseSync | undefined;

export function databaseFile(): string {
  return path.join(uiStateDir(), "seo.db");
}

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS seo_audits (
    id             TEXT PRIMARY KEY,
    project_slug   TEXT NOT NULL,
    target_url     TEXT NOT NULL,
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    status         TEXT NOT NULL,
    error          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_seo_audits_project ON seo_audits(project_slug, started_at);

  CREATE TABLE IF NOT EXISTS seo_findings (
    id             TEXT PRIMARY KEY,
    audit_id       TEXT NOT NULL,
    project_slug   TEXT NOT NULL,
    category       TEXT NOT NULL,
    severity       TEXT NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL,
    page_url       TEXT NOT NULL,
    task_id        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_seo_findings_audit ON seo_findings(audit_id);
  `,
];

/** Opens the database, creating and migrating it on first use. Cached for the life of the process. */
export function seoDatabase(): DatabaseSync {
  if (database) return database;

  fs.mkdirSync(uiStateDir(), { recursive: true });

  const opened = new DatabaseSync(databaseFile());
  opened.exec("PRAGMA journal_mode = WAL");

  const [{ user_version: version }] = opened
    .prepare("PRAGMA user_version")
    .all() as unknown as { user_version: number }[];

  for (let index = version; index < MIGRATIONS.length; index += 1) {
    opened.exec(MIGRATIONS[index]);
  }

  if (version < MIGRATIONS.length) {
    opened.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  }

  database = opened;
  return database;
}

/** Only tests need this — the server holds one connection for its lifetime. */
export function closeSeoDatabase(): void {
  database?.close();
  database = undefined;
}
