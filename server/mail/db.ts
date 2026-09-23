import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * The mail store — deliberately its own file, not a table in `agentos.db`.
 *
 * `agentos.db` (see `server/usage/db.ts`) has one rule: there is no column
 * for a prompt, a response, or any message content, so a future caller
 * cannot accidentally persist it. A mail subject and snippet *are* content,
 * so mixing them into that store would break the one guarantee it makes.
 * `mail.db` gets its own file instead. Deleting it loses cached mail and
 * nothing else — Gmail remains the source of truth; this is a cache.
 */

let database: DatabaseSync | undefined;

export function databaseFile(): string {
  return path.join(uiStateDir(), "mail.db");
}

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS mail_threads (
    thread_id         TEXT PRIMARY KEY,
    from_name         TEXT,
    from_email        TEXT,
    subject           TEXT NOT NULL,
    snippet           TEXT NOT NULL,
    message_date      TEXT NOT NULL,
    synced_at         TEXT NOT NULL,

    classified        INTEGER NOT NULL DEFAULT 0,
    category          TEXT,
    needs_reply       REAL,
    urgency           REAL,
    business          TEXT,
    financial         REAL,
    action_required   REAL,
    classified_at     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_mail_threads_date ON mail_threads(message_date);
  `,
];

/** Opens the database, creating and migrating it on first use. Cached for the life of the process. */
export function mailDatabase(): DatabaseSync {
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
export function closeMailDatabase(): void {
  database?.close();
  database = undefined;
}
