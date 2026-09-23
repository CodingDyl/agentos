import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * The telemetry store.
 *
 * The first place in AgentOS where a database is genuinely warranted. Every
 * other store here is a log or a handful of documents, read whole — but usage
 * is asked questions rather than read: *what did Pantry Pilot cost in
 * September, by agent, excluding cached tokens?* Answering that from JSONL
 * means loading the year to summarise a month, and it gets worse every week.
 *
 * The division of labour is unchanged by this:
 *
 * ```text
 * ~/AgentOS/*.md        project and business truth, human-authored
 * ~/.agentos-ui/*.json  small UI state and execution history
 * agentos.db            telemetry — queryable, disposable, never authoritative
 * ```
 *
 * Nothing here is a source of truth. Delete the database and AgentOS loses its
 * spending history and nothing else; no job, task or decision lives in it.
 *
 * **Privacy is enforced by the schema, not by discipline.** There is no column
 * for a prompt, a response, an API key, or a header. A future caller cannot
 * accidentally persist message content, because there is nowhere to put it.
 */

let database: DatabaseSync | undefined;

export function databaseFile(): string {
  return path.join(uiStateDir(), "agentos.db");
}

/**
 * The schema, applied in order.
 *
 * Migrations are append-only and tracked with SQLite's own `user_version`, so
 * an existing database is upgraded in place rather than rebuilt. Indexes cover
 * the three questions actually asked of this table — by time, by project, by
 * job — because a scan over a year of runs is the thing the database was
 * introduced to avoid.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS usage_events (
    id            TEXT PRIMARY KEY,
    timestamp     TEXT NOT NULL,
    source        TEXT NOT NULL,
    operation     TEXT NOT NULL,
    agent         TEXT NOT NULL,
    provider      TEXT,
    model         TEXT,
    project       TEXT,
    task_id       TEXT,
    job_id        TEXT,
    run_id        TEXT,
    input_tokens      INTEGER,
    output_tokens     INTEGER,
    cached_tokens     INTEGER,
    reasoning_tokens  INTEGER,
    total_tokens      INTEGER,
    cost_usd      REAL,
    status        TEXT NOT NULL,
    cost_status   TEXT NOT NULL,
    duration_ms   INTEGER,
    context_files      INTEGER,
    context_characters INTEGER,
    context_estimated_tokens INTEGER
  );

  CREATE INDEX IF NOT EXISTS usage_events_timestamp ON usage_events (timestamp);
  CREATE INDEX IF NOT EXISTS usage_events_project   ON usage_events (project);
  CREATE INDEX IF NOT EXISTS usage_events_job       ON usage_events (job_id);
  CREATE INDEX IF NOT EXISTS usage_events_agent     ON usage_events (agent);

  CREATE TABLE IF NOT EXISTS subscriptions (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    provider      TEXT,
    type          TEXT NOT NULL,
    price         REAL,
    currency      TEXT NOT NULL DEFAULT 'USD',
    billing_cycle TEXT,
    renewal_date  TEXT,
    balance_usd   REAL,
    balance_checked_at TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    notes         TEXT
  );

  CREATE TABLE IF NOT EXISTS budgets (
    scope           TEXT NOT NULL,
    scope_id        TEXT NOT NULL DEFAULT '',
    monthly_usd     REAL NOT NULL,
    warning_percent REAL NOT NULL DEFAULT 80,
    PRIMARY KEY (scope, scope_id)
  );
  `,
];

/**
 * Opens the database, creating and migrating it on first use.
 *
 * Cached for the life of the process. WAL is on because the adapter reads this
 * while workers are writing to it, and the default journal would make a report
 * wait on a running job's ledger write.
 */
export function usageDatabase(): DatabaseSync {
  if (database) return database;

  fs.mkdirSync(uiStateDir(), { recursive: true });

  const opened = new DatabaseSync(databaseFile());

  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA foreign_keys = ON");

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

/**
 * Closes the handle.
 *
 * Only tests need this — the adapter holds one connection for its lifetime.
 */
export function closeUsageDatabase(): void {
  database?.close();
  database = undefined;
}
