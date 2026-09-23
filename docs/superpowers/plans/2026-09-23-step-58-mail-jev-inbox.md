# Step 58 — Mail (Gmail read-only + Jev classification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new **Mail** screen that reads Gmail read-only, classifies each thread through Jev (TypeSafe's typed-decision model), and groups threads into Needs you / FYI / Low priority — the first Universal Inbox move, scoped narrowly per `docs/superpowers/specs/2026-09-23-step-58-mail-jev-inbox-design.md`.

**Architecture:** A manual-refresh sync (`POST /api/mail/sync`) fetches new INBOX thread metadata from Gmail, classifies anything unclassified through Jev, and stores both in a new, separate `mail.db` (SQLite via `node:sqlite`, mirroring the existing usage ledger's pattern but kept apart from `agentos.db` because that store's whole design guarantees no column exists for message content). `GET /api/mail` always reads from `mail.db` — the page never triggers a live Gmail or Jev call just by opening. Bucketing is a pure, unit-tested function, not a model call, matching `mission-control/attention.ts`'s philosophy.

**Tech Stack:** Express + `node:sqlite` (server, already in use), Gmail REST API + Google OAuth2 (plain `fetch`, no new SDK), TypeSafe's Jev REST API (plain `fetch`, mirrors `server/hermes/client.ts`), React + TanStack Query + React Router (frontend, already in use), Zod for the wire schema.

**Two deliberate additions beyond the written spec**, found while planning — flagging both here rather than silently expanding scope:

1. **A separate `mail.db`, not a table in `agentos.db`.** The spec said "one new table in the existing `agentos.db`", but that store's own doc comment states its entire privacy model is "no column for a prompt, a response... a future caller cannot accidentally persist message content." A mail subject and snippet *are* content, so they get their own file. Deleting `mail.db` loses cached mail and nothing else.
2. **An on-demand `GET /api/mail/:threadId/body` route.** The spec's "expand inline" decision implies showing the full message, but sync only ever fetches a snippet (by design — "never the full message body"). Reconciled by fetching the full plain-text body only when a person actually expands one thread, never during sync and never stored — the read-only, minimum-data principle holds for the 100 threads on the list, and the one thread someone opens gets read in full, the way opening an email in Gmail itself would.
3. **A Mail-specific empty state, not the shared `EmptyState` component.** The spec named the existing component, but it's styled with the current AgentOS design tokens (`text-os-muted`, dashed gray borders) — dropped into this screen's warm paper surface, it would look like a mistake rather than a deliberate empty state. `MailEmptyState` (Task 17) is a few lines, styled with `mail.css` like everything else on this screen.

---

## File Structure

**New files:**
- `shared/mail-types.ts` — wire schema (Zod) shared by server and frontend.
- `server/mail/db.ts` — the `mail.db` connection and schema migration.
- `server/mail/store.ts` — reads and writes `mail_threads`; assembles the bucketed `MailData` response.
- `server/mail/bucketing.ts` — pure function: which bucket a classified thread belongs in, and the sort within each.
- `server/mail/gmail-auth.ts` — OAuth: consent URL, code exchange, refresh-token storage, access-token minting.
- `server/mail/gmail-client.ts` — Gmail REST calls: list INBOX thread ids, read one thread's metadata, read one thread's full body (on demand only).
- `server/mail/jev-client.ts` — one Jev call per thread, question schema, failure classification.
- `server/mail/sync.ts` — orchestrates a sync: diff against what's stored, fetch new, classify unclassified.
- `server/mail/__tests__/*.test.ts` — one file per module above except `sync.ts`, plus `sync.test.ts`.
- `src/features/mail/mail-model.ts` — pure view-model helpers (sender line, avatar initial, tag list).
- `src/features/mail/__tests__/mail-model.test.ts`
- `src/features/mail/bucket-section.tsx`, `thread-row.tsx`, `mail-empty-state.tsx`, `mail-page.tsx`, `index.ts`.
- `src/styles/mail.css` — the scoped visual language approved in brainstorming, namespaced under `.mail-*`.

**Modified files:**
- `.env.example` — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AGENTOS_WEB_ORIGIN`, `JEV_API_KEY`.
- `server/index.ts` — six new routes.
- `src/lib/agentos/client.ts` — `getMailStatus`, `getMail`, `getMailThreadBody`, `syncMail`, `disconnectMail`, `mailConnectUrl`.
- `src/lib/agentos/queries.ts` — `useMailStatus`, `useMail`, `useMailThreadBody`, `useSyncMail`, `useDisconnectMail`.
- `src/config/navigation.ts` — new **Mail** entry.
- `src/App.tsx` — new `/mail` route.
- `package.json` / `package-lock.json` — two new font packages.

---

## Task 1: Shared Mail types

**Files:**
- Create: `shared/mail-types.ts`

- [ ] **Step 1: Write the schema**

```ts
import { z } from "zod";

/**
 * The vocabulary Jev classifies every thread into.
 *
 * Fixed and small on purpose — Jev's `category` question is a `choice`
 * question, and a choice question needs a closed set of options to choose
 * between.
 */
export const MailCategorySchema = z.enum([
  "client",
  "sales",
  "finance",
  "admin",
  "notification",
  "newsletter",
  "personal",
  "spam",
]);

/**
 * One cached Gmail thread, with whatever Jev has made of it so far.
 *
 * `classified` is false until Jev succeeds. A thread is never dropped just
 * because its classification call failed or hasn't run yet — the next sync
 * retries it, and until then it is shown, not hidden.
 */
export const MailThreadSchema = z.object({
  threadId: z.string(),
  fromName: z.string().optional(),
  fromEmail: z.string().optional(),
  subject: z.string(),
  snippet: z.string(),
  /** ISO 8601. */
  messageDate: z.string(),
  classified: z.boolean(),
  category: MailCategorySchema.optional(),
  /** 0..1 probability that this thread needs a reply. */
  needsReply: z.number().min(0).max(1).optional(),
  /** 0..4, continuous — Jev's score against a 5-point urgency rubric. */
  urgency: z.number().min(0).max(4).optional(),
  /** A live AgentOS project name, or `"none"`. */
  business: z.string().optional(),
  /** 0..1 probability that this thread involves money. */
  financial: z.number().min(0).max(1).optional(),
  /** 0..1 probability that this thread needs an action beyond a reply. */
  actionRequired: z.number().min(0).max(1).optional(),
});

/**
 * The Mail page's whole read, pre-bucketed and pre-sorted server-side — the
 * client never re-derives which bucket a thread belongs in.
 */
export const MailDataSchema = z.object({
  generatedAt: z.string(),
  needsYou: z.array(MailThreadSchema),
  fyi: z.array(MailThreadSchema),
  lowPriority: z.array(MailThreadSchema),
});

/** Whether Mail is usable at all, established without contacting Gmail or Jev. */
export const MailStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  lastSyncedAt: z.string().optional(),
  threadCount: z.number().int().nonnegative(),
});

export const MailSyncResultSchema = z.object({
  added: z.number().int().nonnegative(),
  classified: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const MailThreadBodySchema = z.object({
  body: z.string(),
});

export type MailCategory = z.infer<typeof MailCategorySchema>;
export type MailThread = z.infer<typeof MailThreadSchema>;
export type MailData = z.infer<typeof MailDataSchema>;
export type MailStatus = z.infer<typeof MailStatusSchema>;
export type MailSyncResult = z.infer<typeof MailSyncResultSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (this file has no consumers yet, so nothing else changes).

- [ ] **Step 3: Commit**

```bash
git add shared/mail-types.ts
git commit -m "feat(mail): add shared Mail wire types"
```

---

## Task 2: Bucketing logic (TDD)

**Files:**
- Create: `server/mail/bucketing.ts`
- Test: `server/mail/__tests__/bucketing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailThread } from "../../../shared/mail-types";
import { bucketFor, buildMailBuckets } from "../bucketing";

function thread(overrides: Partial<MailThread>): MailThread {
  return {
    threadId: "t1",
    subject: "Subject",
    snippet: "Snippet",
    messageDate: "2026-09-20T09:00:00.000Z",
    classified: true,
    ...overrides,
  };
}

describe("bucketFor", () => {
  it("puts an unclassified thread in fyi", () => {
    assert.equal(bucketFor(thread({ classified: false })), "fyi");
  });

  it("puts a thread that needs a reply in needs_you", () => {
    assert.equal(bucketFor(thread({ needsReply: 0.8 })), "needs_you");
  });

  it("puts a thread that requires action in needs_you, even with a low reply score", () => {
    assert.equal(
      bucketFor(thread({ needsReply: 0.1, actionRequired: 0.9 })),
      "needs_you",
    );
  });

  it("puts a financial thread with no reply needed in fyi", () => {
    assert.equal(
      bucketFor(thread({ needsReply: 0.1, financial: 0.9 })),
      "fyi",
    );
  });

  it("puts a client-category thread with no reply needed in fyi", () => {
    assert.equal(
      bucketFor(thread({ needsReply: 0.0, category: "client" })),
      "fyi",
    );
  });

  it("puts a plain newsletter in low_priority", () => {
    assert.equal(
      bucketFor(
        thread({ needsReply: 0.0, financial: 0.0, category: "newsletter" }),
      ),
      "low_priority",
    );
  });
});

describe("buildMailBuckets", () => {
  it("sorts needs_you by urgency descending, then by date descending", () => {
    const low = thread({ threadId: "low", needsReply: 0.9, urgency: 1, messageDate: "2026-09-20T09:00:00.000Z" });
    const high = thread({ threadId: "high", needsReply: 0.9, urgency: 4, messageDate: "2026-09-19T09:00:00.000Z" });
    const tieNewer = thread({ threadId: "tie-newer", needsReply: 0.9, urgency: 4, messageDate: "2026-09-21T09:00:00.000Z" });

    const { needsYou } = buildMailBuckets([low, high, tieNewer]);

    assert.deepEqual(
      needsYou.map((t) => t.threadId),
      ["tie-newer", "high", "low"],
    );
  });

  it("pins unclassified threads to the top of fyi, newest first among the rest", () => {
    const older = thread({ threadId: "older", category: "client", messageDate: "2026-09-18T09:00:00.000Z" });
    const newer = thread({ threadId: "newer", category: "finance", messageDate: "2026-09-19T09:00:00.000Z" });
    const unclassified = thread({ threadId: "unclassified", classified: false, messageDate: "2026-09-01T09:00:00.000Z" });

    const { fyi } = buildMailBuckets([older, newer, unclassified]);

    assert.deepEqual(
      fyi.map((t) => t.threadId),
      ["unclassified", "newer", "older"],
    );
  });

  it("sorts low_priority by date descending", () => {
    const older = thread({ threadId: "older", category: "newsletter", messageDate: "2026-09-18T09:00:00.000Z" });
    const newer = thread({ threadId: "newer", category: "spam", messageDate: "2026-09-19T09:00:00.000Z" });

    const { lowPriority } = buildMailBuckets([older, newer]);

    assert.deepEqual(
      lowPriority.map((t) => t.threadId),
      ["newer", "older"],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test server/mail/__tests__/bucketing.test.ts`
Expected: FAIL — `Cannot find module '../bucketing'`

- [ ] **Step 3: Write the implementation**

```ts
import type { MailBucket, MailThread } from "../../shared/mail-types";
```

Wait — `MailBucket` is not exported from `shared/mail-types` (Task 1 doesn't define it as a type; the bucket is expressed as which array a thread lands in, not a field on the thread). Define the bucket key locally in this file instead:

```ts
import type { MailThread } from "../../shared/mail-types";

export type MailBucketKey = "needs_you" | "fyi" | "low_priority";

const NEEDS_REPLY_THRESHOLD = 0.5;
const FINANCIAL_THRESHOLD = 0.5;
const FYI_CATEGORIES = new Set(["client", "sales", "finance", "admin"]);

/**
 * Which bucket a classified thread belongs in — ordinary code, not a second
 * model call, so the screen says the same thing twice in a row.
 *
 * An unclassified thread (Jev hasn't succeeded yet) goes to `fyi` rather than
 * `low_priority`, so a failed classification stays visible instead of being
 * mistaken for something genuinely unimportant.
 */
export function bucketFor(thread: MailThread): MailBucketKey {
  if (!thread.classified) return "fyi";

  if (
    (thread.needsReply ?? 0) >= NEEDS_REPLY_THRESHOLD ||
    (thread.actionRequired ?? 0) >= NEEDS_REPLY_THRESHOLD
  ) {
    return "needs_you";
  }

  if (
    (thread.financial ?? 0) >= FINANCIAL_THRESHOLD ||
    (thread.category !== undefined && FYI_CATEGORIES.has(thread.category))
  ) {
    return "fyi";
  }

  return "low_priority";
}

function byDateDescending(a: MailThread, b: MailThread): number {
  return Date.parse(b.messageDate) - Date.parse(a.messageDate);
}

function byUrgencyThenDate(a: MailThread, b: MailThread): number {
  const urgencyDiff = (b.urgency ?? 0) - (a.urgency ?? 0);
  return urgencyDiff !== 0 ? urgencyDiff : byDateDescending(a, b);
}

export interface MailBuckets {
  needsYou: MailThread[];
  fyi: MailThread[];
  lowPriority: MailThread[];
}

/** Groups and sorts a flat list of threads into the three buckets the Mail page renders. */
export function buildMailBuckets(threads: readonly MailThread[]): MailBuckets {
  const needsYou: MailThread[] = [];
  const fyi: MailThread[] = [];
  const lowPriority: MailThread[] = [];

  for (const thread of threads) {
    const bucket = bucketFor(thread);
    if (bucket === "needs_you") needsYou.push(thread);
    else if (bucket === "fyi") fyi.push(thread);
    else lowPriority.push(thread);
  }

  needsYou.sort(byUrgencyThenDate);

  // Unclassified threads sort first (as `false < true`), newest first within
  // each group — a retry-pending thread should never hide behind old mail.
  fyi.sort((a, b) => {
    if (a.classified !== b.classified) return a.classified ? 1 : -1;
    return byDateDescending(a, b);
  });

  lowPriority.sort(byDateDescending);

  return { needsYou, fyi, lowPriority };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test server/mail/__tests__/bucketing.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add server/mail/bucketing.ts server/mail/__tests__/bucketing.test.ts
git commit -m "feat(mail): add deterministic bucketing logic"
```

---

## Task 3: Mail database connection

**Files:**
- Create: `server/mail/db.ts`

- [ ] **Step 1: Write the module**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/mail/db.ts
git commit -m "feat(mail): add the mail.db connection and schema"
```

---

## Task 4: Mail store (TDD)

**Files:**
- Create: `server/mail/store.ts`
- Test: `server/mail/__tests__/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const {
  existingThreadIds,
  insertThreadIfNew,
  listUnclassifiedThreadIds,
  readMailData,
  readThreadSummary,
  storeClassification,
  threadCount,
} = await import("../store");

before(() => {
  mailDatabase();
});

after(() => {
  closeMailDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("insertThreadIfNew", () => {
  it("stores a new thread as unclassified", () => {
    insertThreadIfNew({
      threadId: "t1",
      fromName: "Gavin",
      fromEmail: "gavin@example.com",
      subject: "Vaja configurator",
      snippet: "Can we push pricing live?",
      messageDate: "2026-09-23T09:42:00.000Z",
    });

    assert.equal(threadCount(), 1);
    assert.deepEqual(listUnclassifiedThreadIds(), ["t1"]);
  });

  it("never overwrites a thread that is already stored", () => {
    insertThreadIfNew({
      threadId: "t1",
      subject: "A different subject entirely",
      snippet: "Should not land",
      messageDate: "2026-09-24T09:42:00.000Z",
    });

    const summary = readThreadSummary("t1");
    assert.equal(summary?.subject, "Vaja configurator");
  });

  it("is included in existingThreadIds", () => {
    assert.ok(existingThreadIds().has("t1"));
    assert.equal(existingThreadIds().has("unknown"), false);
  });
});

describe("storeClassification", () => {
  it("marks the thread classified and removes it from the unclassified list", () => {
    storeClassification("t1", {
      category: "client",
      needsReply: 0.9,
      urgency: 3.2,
      business: "Vaja",
      financial: 0.1,
      actionRequired: 0.2,
    });

    assert.deepEqual(listUnclassifiedThreadIds(), []);
  });

  it("is reflected in readMailData's needs_you bucket", () => {
    const data = readMailData();
    assert.equal(data.needsYou.length, 1);
    assert.equal(data.needsYou[0].threadId, "t1");
    assert.equal(data.needsYou[0].category, "client");
    assert.equal(data.needsYou[0].urgency, 3.2);
  });
});

describe("readMailData", () => {
  it("puts a never-classified thread in fyi, unclassified", () => {
    insertThreadIfNew({
      threadId: "t2",
      subject: "Pending",
      snippet: "Not classified yet",
      messageDate: "2026-09-23T10:00:00.000Z",
    });

    const data = readMailData();
    const pending = data.fyi.find((thread) => thread.threadId === "t2");

    assert.ok(pending);
    assert.equal(pending?.classified, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test server/mail/__tests__/store.test.ts`
Expected: FAIL — `Cannot find module '../store'`

- [ ] **Step 3: Write the implementation**

```ts
import type { MailCategory, MailData, MailThread } from "../../shared/mail-types";
import { buildMailBuckets } from "./bucketing";
import { mailDatabase } from "./db";

/** What Gmail gave us for a thread — the input to `insertThreadIfNew`. */
export interface ThreadSummaryInput {
  threadId: string;
  fromName?: string;
  fromEmail?: string;
  subject: string;
  snippet: string;
  /** ISO 8601. */
  messageDate: string;
}

/** What Jev returned for one thread — the input to `storeClassification`. */
export interface ClassificationInput {
  category: MailCategory;
  needsReply: number;
  urgency: number;
  business: string;
  financial: number;
  actionRequired: number;
}

function text(value: string | null): string | undefined {
  return value ?? undefined;
}

function num(value: number | null): number | undefined {
  return value === null ? undefined : value;
}

interface MailThreadRow {
  thread_id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string;
  snippet: string;
  message_date: string;
  synced_at: string;
  classified: number;
  category: string | null;
  needs_reply: number | null;
  urgency: number | null;
  business: string | null;
  financial: number | null;
  action_required: number | null;
  classified_at: string | null;
}

function toMailThread(row: MailThreadRow): MailThread {
  return {
    threadId: row.thread_id,
    fromName: text(row.from_name),
    fromEmail: text(row.from_email),
    subject: row.subject,
    snippet: row.snippet,
    messageDate: row.message_date,
    classified: row.classified === 1,
    category: text(row.category) as MailCategory | undefined,
    needsReply: num(row.needs_reply),
    urgency: num(row.urgency),
    business: text(row.business),
    financial: num(row.financial),
    actionRequired: num(row.action_required),
  };
}

const INSERT_SUMMARY = `
  INSERT OR IGNORE INTO mail_threads (
    thread_id, from_name, from_email, subject, snippet, message_date, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Stores a thread's Gmail summary, if it is not already known.
 *
 * `INSERT OR IGNORE` rather than upsert: once a thread is cached, only
 * `storeClassification` may change it. A summary is never overwritten by a
 * later sync, so a classification in progress can never be raced by a
 * refreshed subject line.
 */
export function insertThreadIfNew(summary: ThreadSummaryInput): void {
  mailDatabase()
    .prepare(INSERT_SUMMARY)
    .run(
      summary.threadId,
      summary.fromName ?? null,
      summary.fromEmail ?? null,
      summary.subject,
      summary.snippet,
      summary.messageDate,
      new Date().toISOString(),
    );
}

/** Every thread id already cached, for diffing against Gmail's list. */
export function existingThreadIds(): Set<string> {
  const rows = mailDatabase()
    .prepare("SELECT thread_id FROM mail_threads")
    .all() as unknown as { thread_id: string }[];

  return new Set(rows.map((row) => row.thread_id));
}

/** Threads with no successful Jev classification yet — new, or previously failed. */
export function listUnclassifiedThreadIds(): string[] {
  const rows = mailDatabase()
    .prepare("SELECT thread_id FROM mail_threads WHERE classified = 0")
    .all() as unknown as { thread_id: string }[];

  return rows.map((row) => row.thread_id);
}

/** One thread's cached summary — what Jev needs in order to classify it. */
export function readThreadSummary(threadId: string): ThreadSummaryInput | undefined {
  const rows = mailDatabase()
    .prepare(
      "SELECT thread_id, from_name, from_email, subject, snippet, message_date FROM mail_threads WHERE thread_id = ?",
    )
    .all(threadId) as unknown as {
    thread_id: string;
    from_name: string | null;
    from_email: string | null;
    subject: string;
    snippet: string;
    message_date: string;
  }[];

  const row = rows[0];
  if (!row) return undefined;

  return {
    threadId: row.thread_id,
    fromName: text(row.from_name),
    fromEmail: text(row.from_email),
    subject: row.subject,
    snippet: row.snippet,
    messageDate: row.message_date,
  };
}

const UPDATE_CLASSIFICATION = `
  UPDATE mail_threads
  SET classified = 1, category = ?, needs_reply = ?, urgency = ?, business = ?,
      financial = ?, action_required = ?, classified_at = ?
  WHERE thread_id = ?
`;

export function storeClassification(threadId: string, result: ClassificationInput): void {
  mailDatabase()
    .prepare(UPDATE_CLASSIFICATION)
    .run(
      result.category,
      result.needsReply,
      result.urgency,
      result.business,
      result.financial,
      result.actionRequired,
      new Date().toISOString(),
      threadId,
    );
}

export function threadCount(): number {
  const rows = mailDatabase()
    .prepare("SELECT COUNT(*) as count FROM mail_threads")
    .all() as unknown as { count: number }[];

  return rows[0]?.count ?? 0;
}

export function lastSyncedAt(): string | undefined {
  const rows = mailDatabase()
    .prepare("SELECT MAX(synced_at) as latest FROM mail_threads")
    .all() as unknown as { latest: string | null }[];

  return rows[0]?.latest ?? undefined;
}

/** The bucketed view the Mail page reads. Never a live Gmail or Jev call. */
export function readMailData(): MailData {
  const rows = mailDatabase()
    .prepare("SELECT * FROM mail_threads ORDER BY message_date DESC")
    .all() as unknown as MailThreadRow[];

  const threads = rows.map(toMailThread);
  const { needsYou, fyi, lowPriority } = buildMailBuckets(threads);

  return {
    generatedAt: new Date().toISOString(),
    needsYou,
    fyi,
    lowPriority,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test server/mail/__tests__/store.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add server/mail/store.ts server/mail/__tests__/store.test.ts
git commit -m "feat(mail): add the mail thread store"
```

---

## Task 5: Gmail auth (TDD)

**Files:**
- Create: `server/mail/gmail-auth.ts`
- Test: `server/mail/__tests__/gmail-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-auth-"));
process.env.AGENTOS_UI_DIR = directory;

const {
  buildConsentUrl,
  completeGmailConnection,
  disconnectGmail,
  getAccessToken,
  GmailAuthError,
  isGmailConfigured,
  isGmailConnected,
  resetAccessTokenCache,
} = await import("../gmail-auth");

const authFile = path.join(directory, "mail-auth.json");
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  resetAccessTokenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  fs.rmSync(authFile, { force: true });
});

describe("configuration", () => {
  it("is configured once both env vars are set", () => {
    assert.equal(isGmailConfigured(), true);
  });

  it("is not configured when the secret is missing", () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    assert.equal(isGmailConfigured(), false);
  });
});

describe("buildConsentUrl", () => {
  it("points at Google's consent screen with a read-only scope", () => {
    const url = new URL(buildConsentUrl());

    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), "client-id");
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
  });

  it("throws not-configured when there is no client id", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    assert.throws(() => buildConsentUrl(), (error: unknown) => {
      assert.ok(error instanceof GmailAuthError);
      assert.equal(error.reason, "not-configured");
      return true;
    });
  });
});

describe("connection lifecycle", () => {
  it("is not connected before completing a connection", async () => {
    assert.equal(await isGmailConnected(), false);
  });

  it("stores a refresh token after completing the connection", async () => {
    globalThis.fetch = mock.fn(() =>
      jsonResponse({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" }),
    ) as unknown as typeof fetch;

    await completeGmailConnection("auth-code");

    assert.equal(await isGmailConnected(), true);
  });

  it("mints an access token from the stored refresh token", async () => {
    globalThis.fetch = mock.fn(() =>
      jsonResponse({ access_token: "at-2", expires_in: 3600 }),
    ) as unknown as typeof fetch;

    assert.equal(await getAccessToken(), "at-2");
  });

  it("caches the access token rather than refreshing on every call", async () => {
    let calls = 0;
    globalThis.fetch = mock.fn(() => {
      calls += 1;
      return jsonResponse({ access_token: "at-3", expires_in: 3600 });
    }) as unknown as typeof fetch;

    await getAccessToken();
    await getAccessToken();

    assert.equal(calls, 1);
  });

  it("disconnects and reports unauthorized when the refresh token is revoked", async () => {
    resetAccessTokenCache();
    globalThis.fetch = mock.fn(() => jsonResponse({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;

    await assert.rejects(() => getAccessToken(), (error: unknown) => {
      assert.ok(error instanceof GmailAuthError);
      assert.equal(error.reason, "unauthorized");
      return true;
    });

    assert.equal(await isGmailConnected(), false);
  });

  it("disconnect is safe to call when already disconnected", async () => {
    await disconnectGmail();
    await disconnectGmail();
    assert.equal(await isGmailConnected(), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test server/mail/__tests__/gmail-auth.test.ts`
Expected: FAIL — `Cannot find module '../gmail-auth'`

- [ ] **Step 3: Write the implementation**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentFailureReason } from "../../shared/agentos-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Gmail OAuth, kept to one file.
 *
 * The refresh token is the only secret this module stores, and it never
 * leaves this process — the browser is only ever redirected, never handed
 * the token itself.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export class GmailAuthError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "GmailAuthError";
  }
}

function authFile(): string {
  return path.join(uiStateDir(), "mail-auth.json");
}

interface StoredMailAuth {
  refreshToken: string;
  obtainedAt: string;
}

export function isGmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

function requireClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new GmailAuthError(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Copy .env.example to .env and add them.",
      "not-configured",
    );
  }

  return { clientId, clientSecret };
}

/** The Express server's own address — where Google is told to send the browser back. */
function redirectUri(): string {
  const port = Number(process.env.AGENTOS_PORT ?? 8787);
  return `http://127.0.0.1:${port}/api/mail/oauth/callback`;
}

/** Where the browser is sent to grant read-only Gmail access. */
export function buildConsentUrl(): string {
  const { clientId } = requireClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    // Forces Google to hand back a refresh token on every connect, even for
    // an account that has consented before.
    prompt: "consent",
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function readStoredAuth(): Promise<StoredMailAuth | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(authFile(), "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredMailAuth).refreshToken === "string"
    ) {
      return parsed as StoredMailAuth;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function writeStoredAuth(auth: StoredMailAuth): Promise<void> {
  await fs.mkdir(uiStateDir(), { recursive: true });
  const target = authFile();
  const temporaryFile = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, target);
}

export async function isGmailConnected(): Promise<boolean> {
  return (await readStoredAuth()) !== undefined;
}

export async function disconnectGmail(): Promise<void> {
  try {
    await fs.unlink(authFile());
  } catch {
    // Already disconnected.
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

/** Exchanges a consent code for tokens and stores the refresh token. */
export async function completeGmailConnection(code: string): Promise<void> {
  const { clientId, clientSecret } = requireClientCredentials();

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
  } catch {
    throw new GmailAuthError("Could not reach Google to complete the Gmail connection.", "offline");
  }

  if (!response.ok) {
    throw new GmailAuthError("Google rejected that authorization code.", "unauthorized");
  }

  const payload = (await response.json()) as TokenResponse;

  if (!payload.refresh_token) {
    throw new GmailAuthError(
      "Google did not return a refresh token. Disconnect and reconnect to force a fresh consent.",
      "failed",
    );
  }

  await writeStoredAuth({ refreshToken: payload.refresh_token, obtainedAt: new Date().toISOString() });
}

let cachedAccessToken: { token: string; expiresAt: number } | undefined;

/** A fresh access token, minted from the stored refresh token. Cached until near-expiry. */
export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token;
  }

  const stored = await readStoredAuth();
  if (!stored) {
    throw new GmailAuthError("Gmail is not connected.", "unauthorized");
  }

  const { clientId, clientSecret } = requireClientCredentials();

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: stored.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GmailAuthError("Could not reach Google to refresh the Gmail token.", "offline");
  }

  if (!response.ok) {
    // A revoked or expired refresh token reads as disconnected, not a crash.
    await disconnectGmail();
    throw new GmailAuthError("Gmail's access has expired or been revoked. Reconnect Gmail.", "unauthorized");
  }

  const payload = (await response.json()) as TokenResponse;
  cachedAccessToken = { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  return cachedAccessToken.token;
}

/** Test-only: clears the in-memory access-token cache between cases. */
export function resetAccessTokenCache(): void {
  cachedAccessToken = undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test server/mail/__tests__/gmail-auth.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add server/mail/gmail-auth.ts server/mail/__tests__/gmail-auth.test.ts
git commit -m "feat(mail): add Gmail OAuth (consent, token exchange, refresh)"
```

---

## Task 6: Gmail client (TDD)

**Files:**
- Create: `server/mail/gmail-client.ts`
- Test: `server/mail/__tests__/gmail-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-gmail-"));
process.env.AGENTOS_UI_DIR = directory;
process.env.GOOGLE_CLIENT_ID = "client-id";
process.env.GOOGLE_CLIENT_SECRET = "client-secret";

fs.writeFileSync(
  path.join(directory, "mail-auth.json"),
  JSON.stringify({ refreshToken: "stored-refresh-token", obtainedAt: new Date().toISOString() }),
);

const { resetAccessTokenCache } = await import("../gmail-auth");
const { getThreadBody, getThreadSummary, listInboxThreadIds, parseFromHeader } = await import("../gmail-client");

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Every gmail-client call refreshes a token first; this answers both legs by URL. */
function stubGoogle(gmailHandler: (url: URL) => Response) {
  globalThis.fetch = mock.fn((input: string | URL) => {
    const url = new URL(input);
    if (url.hostname === "oauth2.googleapis.com") {
      return jsonResponse({ access_token: "at-1", expires_in: 3600 });
    }
    return gmailHandler(url);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetAccessTokenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseFromHeader", () => {
  it("splits a display name and address", () => {
    assert.deepEqual(parseFromHeader("Gavin Smith <gavin@example.com>"), {
      name: "Gavin Smith",
      email: "gavin@example.com",
    });
  });

  it("falls back to the bare address when there is no display name", () => {
    assert.deepEqual(parseFromHeader("gavin@example.com"), { email: "gavin@example.com" });
  });

  it("returns an empty object for an absent header", () => {
    assert.deepEqual(parseFromHeader(undefined), {});
  });
});

describe("listInboxThreadIds", () => {
  it("returns the thread ids from Gmail's list response", async () => {
    stubGoogle(() => jsonResponse({ threads: [{ id: "t1" }, { id: "t2" }] }));

    assert.deepEqual(await listInboxThreadIds(), ["t1", "t2"]);
  });

  it("returns an empty list when the inbox has nothing", async () => {
    stubGoogle(() => jsonResponse({}));

    assert.deepEqual(await listInboxThreadIds(), []);
  });
});

describe("getThreadSummary", () => {
  it("reads the latest message's sender, subject, snippet and date", async () => {
    stubGoogle(() =>
      jsonResponse({
        messages: [
          {
            snippet: "First message",
            payload: { headers: [{ name: "From", value: "old@example.com" }] },
          },
          {
            snippet: "Can we push pricing live?",
            payload: {
              headers: [
                { name: "From", value: "Gavin Smith <gavin@example.com>" },
                { name: "Subject", value: "Vaja configurator" },
                { name: "Date", value: "Wed, 23 Sep 2026 09:42:00 +0000" },
              ],
            },
          },
        ],
      }),
    );

    const summary = await getThreadSummary("t1");

    assert.equal(summary.fromName, "Gavin Smith");
    assert.equal(summary.fromEmail, "gavin@example.com");
    assert.equal(summary.subject, "Vaja configurator");
    assert.equal(summary.snippet, "Can we push pricing live?");
    assert.equal(summary.messageDate, "2026-09-23T09:42:00.000Z");
  });
});

describe("getThreadBody", () => {
  it("decodes the latest message's plain-text body", async () => {
    const encoded = Buffer.from("Hello — the tiers are ready.", "utf8").toString("base64url");

    stubGoogle(() =>
      jsonResponse({
        messages: [
          { payload: { mimeType: "text/plain", body: { data: encoded } } },
        ],
      }),
    );

    assert.equal(await getThreadBody("t1"), "Hello — the tiers are ready.");
  });

  it("finds a plain-text part nested inside a multipart message", async () => {
    const encoded = Buffer.from("Nested body text.", "utf8").toString("base64url");

    stubGoogle(() =>
      jsonResponse({
        messages: [
          {
            payload: {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/html", body: { data: "aWdub3JlZA" } },
                { mimeType: "text/plain", body: { data: encoded } },
              ],
            },
          },
        ],
      }),
    );

    assert.equal(await getThreadBody("t1"), "Nested body text.");
  });

  it("reports a placeholder when no plain-text part exists", async () => {
    stubGoogle(() => jsonResponse({ messages: [{ payload: { mimeType: "text/html", body: {} } }] }));

    assert.match(await getThreadBody("t1"), /no plain-text body/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test server/mail/__tests__/gmail-client.test.ts`
Expected: FAIL — `Cannot find module '../gmail-client'`

- [ ] **Step 3: Write the implementation**

```ts
import type { AgentFailureReason } from "../../shared/agentos-types";
import { getAccessToken } from "./gmail-auth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

async function gmailFetch(path: string): Promise<unknown> {
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new GmailError("Could not reach Gmail.", "offline");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new GmailError("Gmail rejected the request.", "unauthorized");
    }
    throw new GmailError(`Gmail responded with ${response.status}.`, "failed");
  }

  return response.json();
}

interface GmailThreadListResponse {
  threads?: { id: string }[];
}

/** Up to 100 most recent INBOX thread ids, newest first. */
export async function listInboxThreadIds(): Promise<string[]> {
  const payload = (await gmailFetch("/threads?labelIds=INBOX&maxResults=100")) as GmailThreadListResponse;
  return (payload.threads ?? []).map((thread) => thread.id);
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  snippet?: string;
  payload?: { headers?: GmailHeader[] } & GmailMessagePart;
}

interface GmailThreadResponse {
  messages?: GmailMessage[];
}

export interface GmailThreadSummary {
  threadId: string;
  fromName?: string;
  fromEmail?: string;
  subject: string;
  snippet: string;
  /** ISO 8601. */
  messageDate: string;
}

function header(message: GmailMessage, name: string): string | undefined {
  return message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;
}

/** `"Gavin Smith <gavin@example.com>"` → `{ name, email }`. A bare address has no name. */
export function parseFromHeader(value: string | undefined): { name?: string; email?: string } {
  if (!value) return {};

  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, "").trim();
    return { name: name.length > 0 ? name : undefined, email: match[2].trim() };
  }

  return { email: value.trim() };
}

/** Metadata and snippet only for the thread's latest message — never the full body. */
export async function getThreadSummary(threadId: string): Promise<GmailThreadSummary> {
  const payload = (await gmailFetch(
    `/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
  )) as GmailThreadResponse;

  const messages = payload.messages ?? [];
  const latest = messages[messages.length - 1];

  if (!latest) {
    throw new GmailError(`Thread ${threadId} has no messages.`, "failed");
  }

  const { name, email } = parseFromHeader(header(latest, "From"));
  const dateHeader = header(latest, "Date");

  return {
    threadId,
    fromName: name,
    fromEmail: email,
    subject: header(latest, "Subject") ?? "(no subject)",
    snippet: latest.snippet ?? "",
    messageDate: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
  };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractPlainText(part: GmailMessagePart | undefined): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = extractPlainText(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * The latest message's plain-text body.
 *
 * Fetched only when a person opens one specific thread — never during sync,
 * and never stored. Everything else in this module reads metadata only.
 */
export async function getThreadBody(threadId: string): Promise<string> {
  const payload = (await gmailFetch(`/threads/${threadId}?format=full`)) as GmailThreadResponse;
  const messages = payload.messages ?? [];
  const latest = messages[messages.length - 1];

  return extractPlainText(latest?.payload) ?? "(No plain-text body was found for this message.)";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test server/mail/__tests__/gmail-client.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add server/mail/gmail-client.ts server/mail/__tests__/gmail-client.test.ts
git commit -m "feat(mail): add the Gmail metadata and body client"
```

---

## Task 7: Jev client (TDD)

**Files:**
- Create: `server/mail/jev-client.ts`
- Test: `server/mail/__tests__/jev-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

// An empty, isolated vault: `classifyThread` reads live projects for its
// `business` question, and this test must never touch the real ~/AgentOS.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-jev-root-"));
process.env.AGENTOS_ROOT = root;

const { classifyThread, isJevConfigured, JevError } = await import("../jev-client");

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fullAnswerSet() {
  return {
    model: "jev-1.0.0",
    answers: {
      category: { type: "choice", choice: "client", probabilities: { client: 0.9 }, confidence: 0.9 },
      needs_reply: { type: "noul", noul: 0.85 },
      urgency: { type: "score", score: 3.4, legend: {}, probabilities: {}, confidence: 0.7 },
      business: { type: "choice", choice: "none", probabilities: { none: 1 }, confidence: 0.6 },
      financial: { type: "noul", noul: 0.1 },
      action_required: { type: "noul", noul: 0.2 },
    },
  };
}

beforeEach(() => {
  process.env.JEV_API_KEY = "jev-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.JEV_API_KEY;
});

describe("isJevConfigured", () => {
  it("is false without an API key", () => {
    delete process.env.JEV_API_KEY;
    assert.equal(isJevConfigured(), false);
  });

  it("is true with one", () => {
    assert.equal(isJevConfigured(), true);
  });
});

describe("classifyThread", () => {
  it("sends only sender, subject, snippet and date as state — never a body", async () => {
    let sentBody: string | undefined;
    globalThis.fetch = mock.fn((_url: string, init: RequestInit) => {
      sentBody = init.body as string;
      return jsonResponse(fullAnswerSet());
    }) as unknown as typeof fetch;

    await classifyThread({
      from: "gavin@example.com",
      subject: "Vaja configurator",
      snippet: "Can we push pricing live?",
      date: "2026-09-23T09:42:00.000Z",
    });

    const parsed = JSON.parse(sentBody ?? "{}");
    assert.deepEqual(parsed.state, {
      from: "gavin@example.com",
      subject: "Vaja configurator",
      snippet: "Can we push pricing live?",
      date: "2026-09-23T09:42:00.000Z",
    });
    assert.deepEqual(Object.keys(parsed.questions).sort(), [
      "action_required",
      "business",
      "category",
      "financial",
      "needs_reply",
      "urgency",
    ]);
  });

  it("posts to the Jev endpoint with a bearer token", async () => {
    let calledUrl: string | undefined;
    let authHeader: string | undefined;
    globalThis.fetch = mock.fn((url: string, init: RequestInit) => {
      calledUrl = url;
      authHeader = (init.headers as Record<string, string>).Authorization;
      return jsonResponse(fullAnswerSet());
    }) as unknown as typeof fetch;

    await classifyThread({ from: "a@b.com", subject: "s", snippet: "sn", date: "2026-09-23T00:00:00.000Z" });

    assert.equal(calledUrl, "https://api.typesafe.ai/v1/systemone");
    assert.equal(authHeader, "Bearer jev-secret");
  });

  it("maps a full answer set onto the classification result", async () => {
    globalThis.fetch = mock.fn(() => jsonResponse(fullAnswerSet())) as unknown as typeof fetch;

    const result = await classifyThread({
      from: "a@b.com",
      subject: "s",
      snippet: "sn",
      date: "2026-09-23T00:00:00.000Z",
    });

    assert.deepEqual(result, {
      category: "client",
      needsReply: 0.85,
      urgency: 3.4,
      business: "none",
      financial: 0.1,
      actionRequired: 0.2,
    });
  });

  it("throws not-configured without an API key", async () => {
    delete process.env.JEV_API_KEY;

    await assert.rejects(
      () => classifyThread({ from: "a@b.com", subject: "s", snippet: "sn", date: "2026-09-23T00:00:00.000Z" }),
      (error: unknown) => {
        assert.ok(error instanceof JevError);
        assert.equal(error.reason, "not-configured");
        return true;
      },
    );
  });

  it("classifies a 401 as unauthorized", async () => {
    globalThis.fetch = mock.fn(() => jsonResponse({}, 401)) as unknown as typeof fetch;

    await assert.rejects(
      () => classifyThread({ from: "a@b.com", subject: "s", snippet: "sn", date: "2026-09-23T00:00:00.000Z" }),
      (error: unknown) => {
        assert.ok(error instanceof JevError);
        assert.equal(error.reason, "unauthorized");
        return true;
      },
    );
  });

  it("throws failed when an answer is missing", async () => {
    globalThis.fetch = mock.fn(() => jsonResponse({ model: "jev", answers: {} })) as unknown as typeof fetch;

    await assert.rejects(
      () => classifyThread({ from: "a@b.com", subject: "s", snippet: "sn", date: "2026-09-23T00:00:00.000Z" }),
      (error: unknown) => {
        assert.ok(error instanceof JevError);
        assert.equal(error.reason, "failed");
        return true;
      },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test server/mail/__tests__/jev-client.test.ts`
Expected: FAIL — `Cannot find module '../jev-client'`

- [ ] **Step 3: Write the implementation**

```ts
import type { AgentFailureReason } from "../../shared/agentos-types";
import type { MailCategory } from "../../shared/mail-types";
import { getProjects } from "../agentos/projects";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const REQUEST_TIMEOUT_MS = 30_000;

export class JevError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export function isJevConfigured(): boolean {
  return Boolean(process.env.JEV_API_KEY?.trim());
}

function requireApiKey(): string {
  const apiKey = process.env.JEV_API_KEY?.trim();
  if (!apiKey) {
    throw new JevError("JEV_API_KEY is not set. Copy .env.example to .env and add your key.", "not-configured");
  }
  return apiKey;
}

type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

interface JevRequestBody {
  model: string;
  state: Record<string, string>;
  questions: Record<string, JevQuestion>;
}

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
interface JevScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
interface JevNoulAnswer {
  type: "noul";
  noul: number;
}
type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

interface JevResponseBody {
  model: string;
  answers: Record<string, JevAnswer>;
}

async function sendToJev(body: JevRequestBody): Promise<JevResponseBody> {
  const apiKey = requireApiKey();

  let response: Response;
  try {
    response = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new JevError(`Jev did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`, "timed-out");
    }
    throw new JevError("Could not reach Jev.", "offline");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new JevError("Jev rejected the API key.", "unauthorized");
    }
    throw new JevError(`Jev responded with ${response.status}.`, "failed");
  }

  try {
    return (await response.json()) as JevResponseBody;
  } catch {
    throw new JevError("Jev returned an unreadable response.", "failed");
  }
}

const CATEGORY_CRITERIA: Record<MailCategory, string> = {
  client: "From or about a paying client or prospective client",
  sales: "A sales inquiry, pricing question, or new business lead",
  finance: "Invoices, payments, receipts, or other money matters",
  admin: "Operational or administrative — vendors, tools, scheduling",
  notification: "An automated notification from a service or platform",
  newsletter: "A subscribed newsletter or digest",
  personal: "Personal correspondence unrelated to work",
  spam: "Unsolicited or promotional mail",
};

function isMailCategory(value: string): value is MailCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_CRITERIA, value);
}

export interface ClassifyThreadInput {
  from: string;
  subject: string;
  snippet: string;
  /** ISO 8601. */
  date: string;
}

export interface ClassificationResult {
  category: MailCategory;
  needsReply: number;
  urgency: number;
  business: string;
  financial: number;
  actionRequired: number;
}

function answerAs<T extends JevAnswer["type"]>(
  answers: Record<string, JevAnswer>,
  key: string,
  type: T,
): Extract<JevAnswer, { type: T }> {
  const answer = answers[key];
  if (!answer || answer.type !== type) {
    throw new JevError("Jev returned an answer in an unexpected shape.", "failed");
  }
  return answer as Extract<JevAnswer, { type: T }>;
}

/**
 * Classifies one thread through Jev.
 *
 * `state` is deliberately narrow — sender, subject, snippet, date, never a
 * full body. `business`'s criteria are rebuilt from the live project list on
 * every call, so a project added or renamed in AgentOS is reflected the next
 * time a thread is classified, with no separate sync step of its own.
 */
export async function classifyThread(input: ClassifyThreadInput): Promise<ClassificationResult> {
  const projects = await getProjects("live");

  const businessCriteria: Record<string, string> = {
    none: "Not related to any tracked project or business",
  };
  for (const project of projects) {
    businessCriteria[project.name] = `Related to the ${project.name} project`;
  }

  const body: JevRequestBody = {
    model: JEV_MODEL,
    state: { from: input.from, subject: input.subject, snippet: input.snippet, date: input.date },
    questions: {
      category: {
        type: "choice",
        instructions: "Which category best describes this email?",
        criteria: CATEGORY_CRITERIA,
      },
      needs_reply: {
        type: "noul",
        instructions: "Does this email require a reply from the recipient?",
        criteria: {
          true: "The sender expects or is waiting on a reply",
          false: "No reply is expected",
        },
      },
      urgency: {
        type: "score",
        instructions: "How urgent is this for the recipient to act on?",
        criteria: ["Not urgent", "Low", "Medium", "High", "Critical"],
      },
      business: {
        type: "choice",
        instructions: "Which tracked project or business does this relate to, if any?",
        criteria: businessCriteria,
      },
      financial: {
        type: "noul",
        instructions: "Does this email involve money — an invoice, payment, receipt, or financial decision?",
        criteria: {
          true: "Involves an invoice, payment, receipt, or financial decision",
          false: "Not related to money",
        },
      },
      action_required: {
        type: "noul",
        instructions:
          "Does this email require the recipient to take an action beyond replying, such as approving, paying, signing, or reviewing something?",
        criteria: {
          true: "Requires an action beyond a reply",
          false: "No action required beyond an optional reply",
        },
      },
    },
  };

  const response = await sendToJev(body);

  const category = answerAs(response.answers, "category", "choice");
  const needsReply = answerAs(response.answers, "needs_reply", "noul");
  const urgency = answerAs(response.answers, "urgency", "score");
  const business = answerAs(response.answers, "business", "choice");
  const financial = answerAs(response.answers, "financial", "noul");
  const actionRequired = answerAs(response.answers, "action_required", "noul");

  return {
    category: isMailCategory(category.choice) ? category.choice : "admin",
    needsReply: needsReply.noul,
    urgency: urgency.score,
    business: business.choice,
    financial: financial.noul,
    actionRequired: actionRequired.noul,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test server/mail/__tests__/jev-client.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add server/mail/jev-client.ts server/mail/__tests__/jev-client.test.ts
git commit -m "feat(mail): add the Jev classification client"
```

---

## Task 8: Mail sync orchestration (TDD)

**Files:**
- Create: `server/mail/sync.ts`
- Test: `server/mail/__tests__/sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ClassificationResult, ClassifyThreadInput } from "../jev-client";
import type { GmailThreadSummary } from "../gmail-client";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-sync-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeMailDatabase, mailDatabase } = await import("../db");
const { readMailData, threadCount } = await import("../store");
const { runMailSync } = await import("../sync");

before(() => {
  mailDatabase();
});

after(() => {
  closeMailDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

function fakeSummary(threadId: string): GmailThreadSummary {
  return {
    threadId,
    fromName: "Gavin",
    fromEmail: "gavin@example.com",
    subject: `Subject for ${threadId}`,
    snippet: "A snippet",
    messageDate: "2026-09-23T09:00:00.000Z",
  };
}

const alwaysNeedsReply: ClassificationResult = {
  category: "client",
  needsReply: 0.9,
  urgency: 3,
  business: "none",
  financial: 0.1,
  actionRequired: 0.1,
};

describe("runMailSync", () => {
  it("inserts every new remote thread and classifies it", async () => {
    const result = await runMailSync({
      listInboxThreadIds: async () => ["t1", "t2"],
      getThreadSummary: async (id: string) => fakeSummary(id),
      classifyThread: async (_input: ClassifyThreadInput) => alwaysNeedsReply,
    });

    assert.deepEqual(result, { added: 2, classified: 2, failed: 0 });
    assert.equal(threadCount(), 2);
    assert.equal(readMailData().needsYou.length, 2);
  });

  it("does not re-fetch a thread already stored, but does retry its classification if unclassified", async () => {
    let summaryCalls = 0;

    const result = await runMailSync({
      listInboxThreadIds: async () => ["t1", "t2"],
      getThreadSummary: async (id: string) => {
        summaryCalls += 1;
        return fakeSummary(id);
      },
      classifyThread: async (_input: ClassifyThreadInput) => alwaysNeedsReply,
    });

    // Both threads were already classified in the previous test, so nothing
    // is fetched or re-classified.
    assert.equal(summaryCalls, 0);
    assert.deepEqual(result, { added: 0, classified: 0, failed: 0 });
  });

  it("stores a new thread even when its classification fails, and counts the failure", async () => {
    const result = await runMailSync({
      listInboxThreadIds: async () => ["t1", "t2", "t3"],
      getThreadSummary: async (id: string) => fakeSummary(id),
      classifyThread: async () => {
        throw new Error("Jev is unreachable");
      },
    });

    assert.deepEqual(result, { added: 1, classified: 0, failed: 1 });
    assert.equal(threadCount(), 3);

    const data = readMailData();
    const pending = data.fyi.find((thread) => thread.threadId === "t3");
    assert.equal(pending?.classified, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test server/mail/__tests__/sync.test.ts`
Expected: FAIL — `Cannot find module '../sync'`

- [ ] **Step 3: Write the implementation**

```ts
import type { MailSyncResult } from "../../shared/mail-types";
import { getThreadSummary, listInboxThreadIds, type GmailThreadSummary } from "./gmail-client";
import { classifyThread, type ClassificationResult, type ClassifyThreadInput } from "./jev-client";
import {
  existingThreadIds,
  insertThreadIfNew,
  listUnclassifiedThreadIds,
  readThreadSummary,
  storeClassification,
} from "./store";

/**
 * The three calls a sync needs, injected so tests can exercise the real
 * store against fake Gmail/Jev instead of mocking module internals.
 */
export interface MailSyncDeps {
  listInboxThreadIds: () => Promise<string[]>;
  getThreadSummary: (threadId: string) => Promise<GmailThreadSummary>;
  classifyThread: (input: ClassifyThreadInput) => Promise<ClassificationResult>;
}

const defaultDeps: MailSyncDeps = { listInboxThreadIds, getThreadSummary, classifyThread };

/**
 * Fetches new INBOX threads and classifies anything not yet classified.
 *
 * Two passes, deliberately: diffing against what is already stored costs one
 * Gmail list call, but classifying costs a Jev call per thread — so only
 * threads that are genuinely new or previously failed ever reach Jev. One
 * failed classification never aborts the sync; it is counted and left for
 * the next Refresh to retry.
 */
export async function runMailSync(deps: MailSyncDeps = defaultDeps): Promise<MailSyncResult> {
  const remoteIds = await deps.listInboxThreadIds();
  const known = existingThreadIds();
  const newIds = remoteIds.filter((id) => !known.has(id));

  for (const threadId of newIds) {
    const summary = await deps.getThreadSummary(threadId);
    insertThreadIfNew(summary);
  }

  const pending = listUnclassifiedThreadIds();
  let classified = 0;
  let failed = 0;

  for (const threadId of pending) {
    const summary = readThreadSummary(threadId);
    if (!summary) continue;

    try {
      const result = await deps.classifyThread({
        from: summary.fromEmail ?? summary.fromName ?? "unknown",
        subject: summary.subject,
        snippet: summary.snippet,
        date: summary.messageDate,
      });
      storeClassification(threadId, result);
      classified += 1;
    } catch {
      failed += 1;
    }
  }

  return { added: newIds.length, classified, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test server/mail/__tests__/sync.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add server/mail/sync.ts server/mail/__tests__/sync.test.ts
git commit -m "feat(mail): add sync orchestration"
```

---

## Task 9: Environment configuration

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append the new variables**

Add to the end of `.env.example`:

```bash

# Mail: Gmail (read-only) + Jev classification.
#
# GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET come from a Google Cloud OAuth
# client (type: Desktop app). Read by the Node server only — never by Vite,
# and never exposed to the browser.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Where the browser is sent back to after completing Google's consent
# screen. Defaults to the Vite dev server's own address; only used for that
# one redirect.
# AGENTOS_WEB_ORIGIN=http://127.0.0.1:1420

# TypeSafe's Jev, used to classify each new mail thread. Read by the Node
# server only.
JEV_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "feat(mail): document Mail's environment variables"
```

---

## Task 10: Server routes

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add the imports**

Find this import block near the top of `server/index.ts`:

```ts
import { getAutomation, getAutomations } from "./hermes/automations";
import { getCapabilities } from "./hermes/capabilities";
import { getHermesStatus, HermesError, sendToHermes } from "./hermes/client";
```

Add directly after it:

```ts
import {
  buildConsentUrl,
  completeGmailConnection,
  disconnectGmail,
  GmailAuthError,
  isGmailConfigured,
  isGmailConnected,
} from "./mail/gmail-auth";
import { getThreadBody, GmailError } from "./mail/gmail-client";
import { isJevConfigured, JevError } from "./mail/jev-client";
import { runMailSync } from "./mail/sync";
import { lastSyncedAt, readMailData, threadCount } from "./mail/store";
```

- [ ] **Step 2: Add the routes**

Find this route in `server/index.ts` (the end of the `/api/dashboard` handler):

```ts
app.get("/api/dashboard", async (_request, response) => {
  try {
    response.json(await getDashboardData());
  } catch (error) {
    console.error("[agentos] dashboard read failed:", error);
    response.status(500).json({ error: "Unable to load AgentOS dashboard" });
  }
});
```

Insert immediately after it (before `app.get("/api/projects", ...)`):

```ts
/**
 * Mail: Gmail, read-only, classified by Jev.
 *
 * Opening the page never calls Gmail or Jev — every route here except
 * `/sync` reads from `mail.db`. Access is `gmail.readonly` only; nothing in
 * this file can send, label, or delete anything in the connected account.
 */
app.get("/api/mail/status", async (_request, response) => {
  try {
    const configured = isGmailConfigured() && isJevConfigured();
    const connected = configured && (await isGmailConnected());

    response.json({
      configured,
      connected,
      lastSyncedAt: lastSyncedAt(),
      threadCount: threadCount(),
    });
  } catch (error) {
    console.error("[agentos] mail status failed:", error);
    response.status(500).json({ error: "Unable to read mail status" });
  }
});

app.get("/api/mail/connect", (_request, response) => {
  try {
    response.redirect(buildConsentUrl());
  } catch (error) {
    response.status(409).json({
      error: error instanceof Error ? error.message : "Gmail is not configured.",
    });
  }
});

/** Where Google sends the browser back after consent. Never called by the frontend directly. */
app.get("/api/mail/oauth/callback", async (request, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : undefined;

  if (!code) {
    response.status(400).send("Missing authorization code.");
    return;
  }

  try {
    await completeGmailConnection(code);
    response.redirect(`${process.env.AGENTOS_WEB_ORIGIN ?? "http://127.0.0.1:1420"}/mail`);
  } catch (error) {
    console.error("[agentos] gmail connection failed:", error);
    response.status(502).send("Could not complete the Gmail connection. Return to AgentOS and try again.");
  }
});

app.post("/api/mail/disconnect", async (_request, response) => {
  await disconnectGmail();
  response.json({ ok: true });
});

/** A manual sync: fetches new INBOX threads and classifies anything unclassified. */
app.post("/api/mail/sync", async (_request, response) => {
  try {
    response.json(await runMailSync());
  } catch (error) {
    if (error instanceof GmailAuthError || error instanceof GmailError || error instanceof JevError) {
      response.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    console.error("[agentos] mail sync failed:", error);
    response.status(500).json({ error: "Unable to sync mail" });
  }
});

app.get("/api/mail", (_request, response) => {
  try {
    response.json(readMailData());
  } catch (error) {
    console.error("[agentos] mail read failed:", error);
    response.status(500).json({ error: "Unable to read mail" });
  }
});

/** One thread's full plain-text body — fetched only when a person opens it, never stored. */
app.get("/api/mail/:threadId/body", async (request, response) => {
  try {
    const body = await getThreadBody(request.params.threadId);
    response.json({ body });
  } catch (error) {
    if (error instanceof GmailAuthError || error instanceof GmailError) {
      response.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    console.error("[agentos] mail body read failed:", error);
    response.status(500).json({ error: "Unable to read that message" });
  }
});

```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run the full server test suite**

Run: `npm test`
Expected: PASS — every existing test plus the seven new Mail test files.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat(mail): wire the Mail routes into the server"
```

---

## Task 11: Frontend API client

**Files:**
- Modify: `src/lib/agentos/client.ts`

- [ ] **Step 1: Add the schema import**

Find the last `import { ... } from "@shared/validation-sprint-types"` block near the top of `src/lib/agentos/client.ts` and add directly after it:

```ts
import {
  MailDataSchema,
  MailStatusSchema,
  MailSyncResultSchema,
  MailThreadBodySchema,
  type MailData,
  type MailStatus,
  type MailSyncResult,
} from "@shared/mail-types";
```

- [ ] **Step 2: Add the functions**

Find `export function getDashboard(): Promise<DashboardData> { ... }` in `src/lib/agentos/client.ts` and add directly after it:

```ts
/**
 * Mail's whole state: pre-bucketed, pre-sorted. Never triggers a Gmail or
 * Jev call — that only happens from `syncMail`.
 */
export function getMail(): Promise<MailData> {
  return readVault("/api/mail", (value) => MailDataSchema.safeParse(value));
}

export function getMailStatus(): Promise<MailStatus> {
  return readVault("/api/mail/status", (value) => MailStatusSchema.safeParse(value));
}

/** A specific thread's full plain-text body, read only when it is opened. */
export function getMailThreadBody(threadId: string): Promise<{ body: string }> {
  return readVault(`/api/mail/${encodeURIComponent(threadId)}/body`, (value) =>
    MailThreadBodySchema.safeParse(value),
  );
}

export function syncMail(): Promise<MailSyncResult> {
  return workerRequest("/api/mail/sync", { method: "POST" }, (value) =>
    MailSyncResultSchema.safeParse(value),
  );
}

export function disconnectMail(): Promise<unknown> {
  return workerRequest("/api/mail/disconnect", { method: "POST" });
}

/** Not a fetch — a real navigation, since it hands the browser to Google's own consent screen. */
export function mailConnectUrl(): string {
  return "/api/mail/connect";
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/agentos/client.ts
git commit -m "feat(mail): add the frontend Mail API client"
```

---

## Task 12: Frontend query hooks

**Files:**
- Modify: `src/lib/agentos/queries.ts`

- [ ] **Step 1: Add the import**

Find `import { retryWorkerJob } from "./client";` near the top of `src/lib/agentos/queries.ts` and add directly after it:

```ts
import { disconnectMail, getMail, getMailStatus, getMailThreadBody, syncMail } from "./client";
```

- [ ] **Step 2: Add the query keys**

Find in the `agentosKeys` object:

```ts
  dashboard: () => [...agentosKeys.all, "dashboard"] as const,
```

Add directly after it:

```ts
  mail: () => [...agentosKeys.all, "mail"] as const,
  mailStatus: () => [...agentosKeys.all, "mail-status"] as const,
  mailBody: (threadId: string) => [...agentosKeys.all, "mail-body", threadId] as const,
```

- [ ] **Step 3: Add the hooks**

Find `export function useDashboard() { ... }` in `src/lib/agentos/queries.ts` and add directly after its closing brace:

```ts
/** Mail's stored, bucketed state. Cheap and safe to poll — never a Gmail/Jev call. */
export function useMailStatus() {
  return useQuery({
    queryKey: agentosKeys.mailStatus(),
    queryFn: getMailStatus,
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

export function useMail() {
  return useQuery({
    queryKey: agentosKeys.mail(),
    queryFn: getMail,
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

/** A thread's full body — only fetched once the row is actually expanded. */
export function useMailThreadBody(threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: agentosKeys.mailBody(threadId),
    queryFn: () => getMailThreadBody(threadId),
    enabled,
    staleTime: 60_000,
    retry: 1,
    networkMode: "always",
  });
}

/** The only thing that ever triggers a live Gmail + Jev call. */
export function useSyncMail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncMail,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.mail() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.mailStatus() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useDisconnectMail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectMail,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.mailStatus() });
    },
    networkMode: "always",
    retry: 0,
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentos/queries.ts
git commit -m "feat(mail): add the frontend Mail query hooks"
```

---

## Task 13: Navigation entry

**Files:**
- Modify: `src/config/navigation.ts`

- [ ] **Step 1: Add the Mail item**

Replace the full file contents with:

```ts
import {
  Activity,
  Bot,
  Cpu,
  Gauge,
  CalendarClock,
  FolderKanban,
  Home,
  Images,
  Mail as MailIcon,
  SwatchBook,
} from "lucide-react";
import type { AppShellNavigationItem } from "@/components/os";

/** Primary workspace navigation, shared by every AgentOS screen. */
export const navigationItems: AppShellNavigationItem[] = [
  // The name of the screen, not of the route. `/` is where the day starts,
  // and what is there is Mission Control.
  { label: "Mission control", href: "/", icon: Home },
  // Positioned right after Mission Control: mail is an attention source, the
  // same layer as "what needs me", not a project-management tool.
  { label: "Mail", href: "/mail", icon: MailIcon },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Designs", href: "/designs", icon: Images },
  { label: "Agent", href: "/agent", icon: Bot },
  { label: "Automations", href: "/automations", icon: CalendarClock },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Workers", href: "/workers", icon: Cpu },
  // The third management layer: Mission Control asks what needs attention,
  // Projects asks what work there is, Operations asks what the workforce is
  // costing and how well it is doing.
  { label: "Operations", href: "/operations", icon: Gauge },
  { label: "Design system", href: "/design-system", icon: SwatchBook },
];
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/config/navigation.ts
git commit -m "feat(mail): add Mail to the primary navigation"
```

---

## Task 14: Font packages

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run:

```bash
npm install @fontsource-variable/inter-tight @fontsource/ibm-plex-sans
```

Expected: two packages added to `dependencies` in `package.json`; `package-lock.json` updated.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(mail): add Inter Tight and IBM Plex Sans for the Mail screen"
```

---

## Task 15: Mail stylesheet

**Files:**
- Create: `src/styles/mail.css`

- [ ] **Step 1: Write the stylesheet**

```css
/**
 * Mail — a scoped visual trial, independent of the shared AgentOS design
 * tokens in `agentos.css`. Every rule is namespaced under `.mail-*`, so
 * nothing here can leak into another screen. If this style is adopted more
 * broadly later, that is a deliberate follow-up step, not a side effect of
 * this file existing.
 *
 * Fonts are pulled in with `@import`, the same convention `agentos.css` and
 * `App.css` already use for Fontsource packages — never a JS-side import.
 */

@import "@fontsource-variable/inter-tight";
@import "@fontsource/ibm-plex-sans/latin-400.css";
@import "@fontsource/ibm-plex-sans/latin-500.css";
@import "@fontsource/ibm-plex-sans/latin-600.css";
@import "@fontsource/ibm-plex-sans/latin-700.css";

:root {
  --mail-sandy-desk: #e1d7c2;
  --mail-paper-white: #ffffff;
  --mail-cream-paper: #fdfdf8;
  --mail-soft-linen: #eeefe9;
  --mail-pale-stone: #e5e7e0;
  --mail-deep-moss: #23251d;
  --mail-olive-char: #4d4f46;
  --mail-sage-gray: #65675e;
  --mail-ash-green: #9ea096;
  --mail-warm-mist: #bfc1b7;
  --mail-amber-glow: #eb9d2a;
  --mail-dark-amber: #cd8407;
  --mail-burnished-gold: #b17816;
  --mail-marigold: #f1a82c;
  --mail-flame-orange: #f54e00;
  --mail-moss-green: #6aa84f;
  --mail-font-heading: "Inter Tight Variable", "Inter Tight", ui-sans-serif, system-ui, sans-serif;
  --mail-font-ui: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --mail-font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

.mail-stage {
  background: var(--mail-sandy-desk);
  color: var(--mail-deep-moss);
  font-family: var(--mail-font-ui);
  min-height: 100%;
  padding: 28px 32px 40px;
  display: flex;
  justify-content: center;
}

.mail-window {
  width: 100%;
  max-width: 860px;
  height: fit-content;
  background: var(--mail-paper-white);
  border: 1px solid var(--mail-warm-mist);
  border-radius: 6px;
}

.mail-titlebar {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border-bottom: 1px solid var(--mail-warm-mist);
  background: rgba(255, 255, 255, 0.7);
  border-radius: 6px 6px 0 0;
}

.mail-titlebar-dots {
  position: absolute;
  left: 14px;
  display: flex;
  gap: 6px;
}

.mail-titlebar-dots span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--mail-warm-mist);
  display: block;
}

.mail-titlebar-filename {
  font-family: var(--mail-font-mono);
  font-size: 12.5px;
  color: var(--mail-sage-gray);
}

.mail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  gap: 12px;
}

.mail-title {
  font-family: var(--mail-font-heading);
  font-weight: 800;
  font-size: 24px;
  letter-spacing: -0.6px;
  margin: 0;
}

.mail-meta {
  font-size: 13px;
  color: var(--mail-sage-gray);
  margin-top: 2px;
}

.mail-toolbar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.mail-btn-amber {
  background: var(--mail-amber-glow);
  color: var(--mail-deep-moss);
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-family: var(--mail-font-ui);
  font-weight: 600;
  font-size: 13.5px;
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
}

.mail-btn-amber:hover {
  background: var(--mail-dark-amber);
  color: #fff;
}

.mail-btn-amber:disabled {
  opacity: 0.6;
  cursor: default;
}

.mail-btn-ghost {
  background: transparent;
  color: var(--mail-burnished-gold);
  border: 1.5px solid var(--mail-burnished-gold);
  border-radius: 4px;
  padding: 8px 16px;
  font-family: var(--mail-font-ui);
  font-weight: 600;
  font-size: 13.5px;
  cursor: pointer;
}

.mail-btn-ghost:hover {
  background: var(--mail-soft-linen);
}

.mail-content {
  padding: 4px 24px 24px;
}

.mail-bucket {
  margin-bottom: 22px;
}

.mail-bucket-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mail-font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 10px;
  color: var(--mail-sage-gray);
}

.mail-bucket-label--needs {
  color: var(--mail-flame-orange);
}

.mail-bucket-count {
  background: var(--mail-ash-green);
  color: #fff;
  border-radius: 9999px;
  padding: 1px 8px;
  font-size: 11px;
}

.mail-bucket-label--needs .mail-bucket-count {
  background: var(--mail-flame-orange);
}

.mail-thread {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: var(--mail-cream-paper);
  border: 1px solid var(--mail-warm-mist);
  border-radius: 4px;
  padding: 12px 14px;
  margin-bottom: 8px;
  cursor: pointer;
}

.mail-thread--needs {
  border-left: 3px solid var(--mail-flame-orange);
}

.mail-thread--low {
  opacity: 0.72;
}

.mail-thread-avatar {
  width: 34px;
  height: 34px;
  border-radius: 4px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mail-font-heading);
  font-weight: 700;
  font-size: 13px;
  background: var(--mail-soft-linen);
  color: var(--mail-olive-char);
}

.mail-thread-body {
  flex: 1;
  min-width: 0;
}

.mail-thread-sender {
  font-family: var(--mail-font-heading);
  font-weight: 700;
  font-size: 14.5px;
  letter-spacing: -0.01em;
}

.mail-thread-snippet {
  font-size: 13px;
  color: var(--mail-sage-gray);
  margin-top: 1px;
}

.mail-tags {
  display: flex;
  gap: 6px;
  margin-top: 7px;
  flex-wrap: wrap;
}

.mail-tag {
  font-family: var(--mail-font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  border-radius: 9999px;
  padding: 2px 9px;
}

.mail-tag--client {
  background: var(--mail-flame-orange);
  color: #fff;
}

.mail-tag--finance {
  background: var(--mail-marigold);
  color: var(--mail-deep-moss);
}

.mail-tag--reply {
  background: transparent;
  color: var(--mail-burnished-gold);
  border: 1.3px solid var(--mail-burnished-gold);
}

.mail-tag--noreply {
  background: var(--mail-moss-green);
  color: #fff;
}

.mail-tag--muted {
  background: var(--mail-pale-stone);
  color: var(--mail-sage-gray);
}

.mail-thread-expanded-body {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--mail-warm-mist);
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--mail-olive-char);
  white-space: pre-wrap;
}

.mail-thread-when {
  font-family: var(--mail-font-mono);
  font-size: 11.5px;
  color: var(--mail-ash-green);
  white-space: nowrap;
  margin-top: 2px;
}

.mail-empty {
  padding: 40px 8px;
  text-align: left;
}

.mail-empty-title {
  font-family: var(--mail-font-heading);
  font-weight: 700;
  font-size: 17px;
  margin: 0 0 8px;
}

.mail-empty-description {
  font-size: 14px;
  color: var(--mail-sage-gray);
  max-width: 52ch;
  margin: 0 0 16px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/mail.css
git commit -m "feat(mail): add the scoped Mail stylesheet"
```

---

## Task 16: Mail view-model helpers (TDD)

**Files:**
- Create: `src/features/mail/mail-model.ts`
- Test: `src/features/mail/__tests__/mail-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailThread } from "@shared/mail-types";
import { threadInitial, threadSender, threadTags } from "../mail-model";

function thread(overrides: Partial<MailThread>): MailThread {
  return {
    threadId: "t1",
    subject: "Subject",
    snippet: "Snippet",
    messageDate: "2026-09-23T09:00:00.000Z",
    classified: true,
    ...overrides,
  };
}

describe("threadSender", () => {
  it("prefers the display name", () => {
    assert.equal(threadSender(thread({ fromName: "Gavin", fromEmail: "gavin@example.com" })), "Gavin");
  });

  it("falls back to the address", () => {
    assert.equal(threadSender(thread({ fromEmail: "gavin@example.com" })), "gavin@example.com");
  });

  it("falls back to a label when neither is known", () => {
    assert.equal(threadSender(thread({})), "Unknown sender");
  });
});

describe("threadInitial", () => {
  it("takes the first letter of the sender's name", () => {
    assert.equal(threadInitial(thread({ fromName: "gavin" })), "G");
  });
});

describe("threadTags", () => {
  it("shows a single tag for an unclassified thread", () => {
    assert.deepEqual(threadTags(thread({ classified: false })), [
      { label: "NOT YET CLASSIFIED", tone: "muted" },
    ]);
  });

  it("shows the category and reply-needed tags together", () => {
    assert.deepEqual(threadTags(thread({ category: "client", needsReply: 0.9 })), [
      { label: "CLIENT", tone: "client" },
      { label: "REPLY NEEDED", tone: "reply" },
    ]);
  });

  it("shows no-reply for a financial thread with no reply needed", () => {
    assert.deepEqual(
      threadTags(thread({ category: "finance", needsReply: 0.1, financial: 0.9 })),
      [
        { label: "FINANCE", tone: "finance" },
        { label: "NO REPLY", tone: "noreply" },
      ],
    );
  });

  it("shows only the category for a low-priority thread", () => {
    assert.deepEqual(threadTags(thread({ category: "newsletter", needsReply: 0, financial: 0 })), [
      { label: "NEWSLETTER", tone: "muted" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/features/mail/__tests__/mail-model.test.ts`
Expected: FAIL — `Cannot find module '../mail-model'`

- [ ] **Step 3: Write the implementation**

```ts
import type { MailCategory, MailThread } from "@shared/mail-types";

/** The sender line shown in a row — the display name when Gmail gave one, else the address. */
export function threadSender(thread: MailThread): string {
  return thread.fromName ?? thread.fromEmail ?? "Unknown sender";
}

/** A single-letter avatar glyph. */
export function threadInitial(thread: MailThread): string {
  const source = threadSender(thread);
  return source.trim().charAt(0).toUpperCase() || "?";
}

export type MailTagTone = "client" | "finance" | "reply" | "noreply" | "muted";

export interface MailTag {
  label: string;
  tone: MailTagTone;
}

const CATEGORY_LABEL: Record<MailCategory, string> = {
  client: "CLIENT",
  sales: "SALES",
  finance: "FINANCE",
  admin: "ADMIN",
  notification: "NOTIFICATION",
  newsletter: "NEWSLETTER",
  personal: "PERSONAL",
  spam: "SPAM",
};

const CATEGORY_TONE: Record<MailCategory, MailTagTone> = {
  client: "client",
  sales: "client",
  finance: "finance",
  admin: "finance",
  notification: "muted",
  newsletter: "muted",
  personal: "muted",
  spam: "muted",
};

const REPLY_THRESHOLD = 0.5;

/** The small tag row under a thread's snippet — category, then reply status. */
export function threadTags(thread: MailThread): MailTag[] {
  if (!thread.classified) {
    return [{ label: "NOT YET CLASSIFIED", tone: "muted" }];
  }

  const tags: MailTag[] = [];

  if (thread.category) {
    tags.push({ label: CATEGORY_LABEL[thread.category], tone: CATEGORY_TONE[thread.category] });
  }

  const wantsReply =
    (thread.needsReply ?? 0) >= REPLY_THRESHOLD || (thread.actionRequired ?? 0) >= REPLY_THRESHOLD;

  if (wantsReply) {
    tags.push({ label: "REPLY NEEDED", tone: "reply" });
  } else if ((thread.financial ?? 0) >= REPLY_THRESHOLD) {
    tags.push({ label: "NO REPLY", tone: "noreply" });
  }

  return tags;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/features/mail/__tests__/mail-model.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/features/mail/mail-model.ts src/features/mail/__tests__/mail-model.test.ts
git commit -m "feat(mail): add Mail view-model helpers"
```

---

## Task 17: Mail components

**Files:**
- Create: `src/features/mail/bucket-section.tsx`, `src/features/mail/thread-row.tsx`, `src/features/mail/mail-empty-state.tsx`

- [ ] **Step 1: Write `mail-empty-state.tsx`**

```tsx
interface MailEmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface MailEmptyStateProps {
  title: string;
  description: string;
  action?: MailEmptyStateAction;
}

/**
 * Mail's own empty state, styled with `mail.css` rather than the shared
 * `EmptyState` — that component carries the existing AgentOS design tokens,
 * which would look inconsistent inside this screen's warm paper surface.
 */
export function MailEmptyState({ title, description, action }: MailEmptyStateProps) {
  return (
    <div className="mail-empty">
      <p className="mail-empty-title">{title}</p>
      <p className="mail-empty-description">{description}</p>
      {action ? (
        action.href ? (
          <a className="mail-btn-amber" href={action.href}>
            {action.label}
          </a>
        ) : (
          <button type="button" className="mail-btn-amber" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Write `thread-row.tsx`**

```tsx
import { useState } from "react";
import type { MailThread } from "@shared/mail-types";
import { formatRelativeTime } from "@/lib/format";
import { useMailThreadBody } from "@/lib/agentos/queries";
import { threadInitial, threadSender, threadTags } from "./mail-model";
import type { MailBucketTone } from "./bucket-section";

interface ThreadRowProps {
  thread: MailThread;
  tone: MailBucketTone;
}

/** One thread. Clicking it expands the row in place to fetch and show the full body. */
export function ThreadRow({ thread, tone }: ThreadRowProps) {
  const [expanded, setExpanded] = useState(false);
  const body = useMailThreadBody(thread.threadId, expanded);

  const toggle = () => setExpanded((value) => !value);

  return (
    <div
      className={`mail-thread mail-thread--${tone}`}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <div className="mail-thread-avatar">{threadInitial(thread)}</div>
      <div className="mail-thread-body">
        <div className="mail-thread-sender">{threadSender(thread)}</div>
        <div className="mail-thread-snippet">{thread.subject}</div>
        <div className="mail-thread-snippet">{thread.snippet}</div>
        <div className="mail-tags">
          {threadTags(thread).map((tag) => (
            <span key={tag.label} className={`mail-tag mail-tag--${tag.tone}`}>
              {tag.label}
            </span>
          ))}
        </div>
        {expanded ? (
          <div className="mail-thread-expanded-body">
            {body.isPending
              ? "Loading the full message…"
              : body.isError
                ? "Could not load the full message."
                : body.data?.body}
          </div>
        ) : null}
      </div>
      <div className="mail-thread-when">{formatRelativeTime(thread.messageDate)}</div>
    </div>
  );
}
```

- [ ] **Step 3: Write `bucket-section.tsx`**

```tsx
import type { MailThread } from "@shared/mail-types";
import { ThreadRow } from "./thread-row";

export type MailBucketTone = "needs" | "fyi" | "low";

interface BucketSectionProps {
  label: string;
  tone: MailBucketTone;
  threads: MailThread[];
}

/** One labelled group of threads. Renders nothing when the bucket is empty. */
export function BucketSection({ label, tone, threads }: BucketSectionProps) {
  if (threads.length === 0) return null;

  return (
    <div className="mail-bucket">
      <div className={`mail-bucket-label mail-bucket-label--${tone}`}>
        {label} <span className="mail-bucket-count">{threads.length}</span>
      </div>
      {threads.map((thread) => (
        <ThreadRow key={thread.threadId} thread={thread} tone={tone} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/mail/bucket-section.tsx src/features/mail/thread-row.tsx src/features/mail/mail-empty-state.tsx
git commit -m "feat(mail): add the Mail list components"
```

---

## Task 18: Mail page and route

**Files:**
- Create: `src/features/mail/mail-page.tsx`, `src/features/mail/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write `mail-page.tsx`**

```tsx
import "@/styles/mail.css";
import { AppShell } from "@/components/os";
import { mailConnectUrl } from "@/lib/agentos/client";
import { useNavigationItems } from "@/config/use-navigation";
import { useDisconnectMail, useMail, useMailStatus, useSyncMail } from "@/lib/agentos/queries";
import { BucketSection } from "./bucket-section";
import { MailEmptyState } from "./mail-empty-state";

/**
 * Mail: Gmail, read-only, classified by Jev into Needs you / FYI / Low
 * priority. Opening this page never calls Gmail or Jev — only Refresh does.
 */
export function MailPage() {
  const navigationItems = useNavigationItems();
  const status = useMailStatus();
  const mail = useMail();
  const sync = useSyncMail();
  const disconnect = useDisconnectMail();

  const configured = status.data?.configured ?? false;
  const connected = status.data?.connected ?? false;

  const totalThreads = mail.data
    ? mail.data.needsYou.length + mail.data.fyi.length + mail.data.lowPriority.length
    : 0;

  return (
    <AppShell navigationItems={navigationItems} pageId="mail" activeHref="/mail">
      <div className="mail-stage">
        <div className="mail-window">
          <div className="mail-titlebar">
            <div className="mail-titlebar-dots">
              <span />
              <span />
              <span />
            </div>
            <div className="mail-titlebar-filename">mail.inbox</div>
          </div>

          <div className="mail-toolbar">
            <div>
              <h1 className="mail-title">Mail</h1>
              <div className="mail-meta">
                {mail.data ? `${totalThreads} thread${totalThreads === 1 ? "" : "s"}` : "—"}
                {status.data?.lastSyncedAt
                  ? ` · last synced ${new Date(status.data.lastSyncedAt).toLocaleString()}`
                  : ""}
              </div>
            </div>
            {connected ? (
              <div className="mail-toolbar-actions">
                <button
                  type="button"
                  className="mail-btn-amber"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending}
                >
                  {sync.isPending ? "Refreshing…" : "Refresh"}
                </button>
                <button type="button" className="mail-btn-ghost" onClick={() => disconnect.mutate()}>
                  Disconnect
                </button>
              </div>
            ) : null}
          </div>

          <div className="mail-content">
            {status.isPending ? (
              <p className="mail-meta">Checking Mail configuration…</p>
            ) : !configured ? (
              <MailEmptyState
                title="Mail is not configured"
                description="Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and JEV_API_KEY to .env, then restart the server."
              />
            ) : !connected ? (
              <MailEmptyState
                title="Gmail is not connected"
                description="Connect a Gmail account to start triaging your inbox. Access is read-only — AgentOS never sends, labels, or deletes anything."
                action={{ label: "Connect Gmail", href: mailConnectUrl() }}
              />
            ) : mail.isPending ? (
              <p className="mail-meta">Reading stored mail…</p>
            ) : !mail.data || totalThreads === 0 ? (
              <MailEmptyState
                title="No mail synced yet"
                description="Click Refresh to fetch and classify your most recent inbox threads."
              />
            ) : (
              <>
                <BucketSection label="Needs you" tone="needs" threads={mail.data.needsYou} />
                <BucketSection label="FYI" tone="fyi" threads={mail.data.fyi} />
                <BucketSection label="Low priority" tone="low" threads={mail.data.lowPriority} />
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Write `index.ts`**

```ts
export * from "./mail-page";
```

- [ ] **Step 3: Add the route**

Find in `src/App.tsx`:

```ts
import { MissionControlPage } from "@/features/mission-control";
```

Add directly after it:

```ts
import { MailPage } from "@/features/mail";
```

Find:

```tsx
          <Route path="/" element={<MissionControlPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
```

Insert a new route between them:

```tsx
          <Route path="/" element={<MissionControlPage />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — every server and frontend test, including all new Mail tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/mail/mail-page.tsx src/features/mail/index.ts src/App.tsx
git commit -m "feat(mail): add the Mail page and route"
```

---

## Task 19: Manual verification

Not automatable — this exercises real Google and Jev credentials, exactly like Hermes and the worker providers already are.

- [ ] **Step 1: Configure credentials**

Copy `.env.example` to `.env` if not already done, and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JEV_API_KEY`.

- [ ] **Step 2: Start the app**

Run: `npm run dev`
Expected: Vite on `:1420`, Express on `:8787`, no startup errors in either terminal pane.

- [ ] **Step 3: Confirm the not-connected state**

Open `http://127.0.0.1:1420/mail`. Expected: the **Mail** nav item is present; the page shows "Gmail is not connected" with a **Connect Gmail** button.

- [ ] **Step 4: Connect Gmail**

Click **Connect Gmail**. Expected: redirected to Google's consent screen showing only read-only Gmail access requested; after approving, redirected back to `/mail`, now showing "No mail synced yet".

- [ ] **Step 5: Sync**

Click **Refresh**. Expected: after a short wait (one Jev call per new thread), the three buckets render with real inbox threads, tags, and senders.

- [ ] **Step 6: Expand a thread**

Click a thread row. Expected: it expands in place and shows the real plain-text body, fetched only at that moment (check the Network tab: no `/body` request until the click).

- [ ] **Step 7: Refresh again**

Click **Refresh** a second time with no new mail arrived. Expected: `added: 0` — network tab shows no new Jev calls for already-classified threads.

- [ ] **Step 8: Disconnect**

Click **Disconnect**. Expected: the page returns to the "Gmail is not connected" state; `~/.agentos-ui/mail-auth.json` no longer exists.

- [ ] **Step 9: Confirm the not-configured state**

Comment out `JEV_API_KEY` in `.env`, restart the server. Expected: the page shows "Mail is not configured" instead of a crash or a blank screen.
