import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";

/**
 * The learning store: `~/.agentos-ui/learning/learning.db`.
 *
 * References and the person's own words only. A row names a video by its id
 * and a track by its URI; no media, transcript or artwork is ever copied
 * here. Notes are the person's, and stay here until one is promoted — then
 * the memory note it becomes lives in the vault like any other.
 */

let database: DatabaseSync | undefined;

export function learningDir(): string {
  return path.join(uiStateDir(), "learning");
}

export function learningDatabaseFile(): string {
  return path.join(learningDir(), "learning.db");
}

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS sources (
    id               TEXT PRIMARY KEY,
    kind             TEXT NOT NULL,
    external_id      TEXT NOT NULL,
    url              TEXT NOT NULL,
    title            TEXT NOT NULL,
    author           TEXT,
    thumbnail_url    TEXT,
    duration_seconds REAL,
    position_seconds REAL NOT NULL DEFAULT 0,
    watch_later      INTEGER NOT NULL DEFAULT 0,
    finished         INTEGER NOT NULL DEFAULT 0,
    archived         INTEGER NOT NULL DEFAULT 0,
    workspace_id     TEXT,
    tags             TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    last_opened_at   TEXT,
    UNIQUE (kind, external_id)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    content           TEXT NOT NULL,
    source_type       TEXT NOT NULL,
    source_url        TEXT,
    source_id         TEXT,
    source_title      TEXT,
    timestamp_seconds REAL,
    workspace_id      TEXT,
    task_id           TEXT,
    tags              TEXT NOT NULL DEFAULT '[]',
    archived          INTEGER NOT NULL DEFAULT 0,
    promoted_to       TEXT NOT NULL DEFAULT '[]',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notes_source ON notes (source_id);

  CREATE TABLE IF NOT EXISTS notebooks (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    provider         TEXT NOT NULL,
    external_url     TEXT,
    description      TEXT,
    workspace_id     TEXT,
    source_ids       TEXT NOT NULL DEFAULT '[]',
    note_ids         TEXT NOT NULL DEFAULT '[]',
    external_sources TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );
  `,
];

/** Opens the database, creating and migrating it on first use. Cached for the life of the process. */
export function learningDatabase(): DatabaseSync {
  if (database) return database;

  fs.mkdirSync(learningDir(), { recursive: true });
  const opened = new DatabaseSync(learningDatabaseFile());
  opened.exec("PRAGMA journal_mode = WAL");

  const [{ user_version: version }] = opened.prepare("PRAGMA user_version").all() as unknown as { user_version: number }[];
  for (let index = version; index < MIGRATIONS.length; index += 1) opened.exec(MIGRATIONS[index]);
  if (version < MIGRATIONS.length) opened.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);

  database = opened;
  return database;
}

/** Only tests need this. */
export function closeLearningDatabase(): void {
  database?.close();
  database = undefined;
}

export function parseList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Tags as stored: trimmed, lower-case, unique, in order. */
export function cleanTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().replace(/^#+/, "").toLowerCase()).filter(Boolean))].slice(0, 12);
}
