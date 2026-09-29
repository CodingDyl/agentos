import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * The finance store: its own file, on this machine, and nowhere else.
 *
 * Not a table in `agentos.db` (which promises it holds no content) and not in
 * the vault (which is Markdown that agents read). Banking data lives here and
 * only here, so "no banking data in Markdown" is a property of where the file
 * is rather than of anyone remembering not to write it.
 *
 * What it never holds: API secrets, tokens, logins, or a full account number.
 * Investec's access token is kept in memory by `investec.ts` and dies with the
 * process. Deleting this file loses the cache, the goals, and the corrections
 * you made; the bank remains the source of truth for everything else.
 */

let database: DatabaseSync | undefined;

export function financeDatabaseFile(): string {
  return path.join(uiStateDir(), "finance.db");
}

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    currency    TEXT NOT NULL,
    balance     REAL NOT NULL,
    mask        TEXT,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL,
    date         TEXT NOT NULL,
    description  TEXT NOT NULL,
    amount       REAL NOT NULL,
    merchant     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);

  CREATE TABLE IF NOT EXISTS goals (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    target_amount  REAL NOT NULL,
    current_amount REAL NOT NULL,
    target_date    TEXT,
    type           TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'goal',
    created_at     TEXT NOT NULL
  );

  -- What you told Finance a merchant is. The closest thing it has to learning:
  -- applied to every payment to that merchant, past and future.
  CREATE TABLE IF NOT EXISTS corrections (
    merchant_key  TEXT PRIMARY KEY,
    merchant      TEXT NOT NULL,
    category      TEXT NOT NULL,
    scope         TEXT,
    corrected_at  TEXT NOT NULL
  );

  -- Keep / reviewing / cancelled. "Keep" is what stops the nagging.
  CREATE TABLE IF NOT EXISTS subscription_decisions (
    merchant_key  TEXT PRIMARY KEY,
    decision      TEXT NOT NULL,
    note          TEXT,
    decided_at    TEXT NOT NULL
  );

  -- Jev's read of a subscription, cached until the amount changes.
  CREATE TABLE IF NOT EXISTS subscription_assessments (
    merchant_key  TEXT PRIMARY KEY,
    signature     TEXT NOT NULL,
    assessment    TEXT NOT NULL,
    assessed_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
  `
  -- How a goal's money is held, which sets the return its projection assumes.
  -- Null means no growth is assumed.
  ALTER TABLE goals ADD COLUMN risk_profile TEXT;
  ALTER TABLE goals ADD COLUMN annual_return REAL;

  -- A monthly limit per category, set by you.
  CREATE TABLE IF NOT EXISTS budgets (
    category  TEXT PRIMARY KEY,
    amount    REAL NOT NULL
  );
  `,
  `
  -- What you told us about an account: the rate a card charges and its limit.
  -- Kept apart from what the bank reports, so a sync never overwrites them.
  ALTER TABLE accounts ADD COLUMN interest_rate REAL;
  ALTER TABLE accounts ADD COLUMN credit_limit REAL;
  `,
];

/** Opens the database, creating and migrating it on first use. Cached for the life of the process. */
export function financeDatabase(): DatabaseSync {
  if (database) return database;

  fs.mkdirSync(uiStateDir(), { recursive: true });

  const opened = new DatabaseSync(financeDatabaseFile());
  opened.exec("PRAGMA journal_mode = WAL");

  const [{ user_version: version }] = opened.prepare("PRAGMA user_version").all() as unknown as { user_version: number }[];

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
export function closeFinanceDatabase(): void {
  database?.close();
  database = undefined;
}
