import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_WORKER_PLAN,
  GATED_STAGES,
  HERO_CONCEPTS,
  REBUILD_SKILL_ID,
  RebuildWorkerPlanSchema,
  STAGE_ORDER,
  companyFileSlug,
  type RebuildArtifact,
  type RebuildDecision,
  type RebuildEvent,
  type RebuildFunction,
  type RebuildRevision,
  type RebuildRun,
  type RebuildRunSummary,
  type RebuildStage,
  type RebuildStageId,
  type RebuildStageStatus,
  type RebuildWorkerPlan,
} from "../../shared/website-rebuild-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Website rebuild runs, kept in their own `website-rebuild.db`.
 *
 * Everything a run needs to survive a refresh or a restart is here: each
 * stage's status, the revisions of each deliverable, every approval and
 * change request (always against one revision), and a progress log. The
 * reports themselves live in the workspace, as documents.
 *
 * Two guarantees are enforced here rather than in the page:
 * - A stage runs under a lease, so two workers cannot advance it at once.
 * - A stage cannot start until every earlier gated stage has its *latest*
 *   revision approved.
 */

export class RebuildError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "RebuildError";
  }
}

let opened: { file: string; db: DatabaseSync } | undefined;

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS runs (
    id                 TEXT PRIMARY KEY,
    prospect_id        TEXT NOT NULL UNIQUE,
    company            TEXT NOT NULL,
    company_slug       TEXT NOT NULL,
    website_url        TEXT NOT NULL,
    target_market      TEXT NOT NULL,
    location           TEXT NOT NULL,
    conversion_goal    TEXT NOT NULL,
    required_functions TEXT NOT NULL,
    design_template    TEXT NOT NULL,
    worker_plan        TEXT NOT NULL,
    skill_id           TEXT NOT NULL,
    skill_version      TEXT NOT NULL,
    workspace_slug     TEXT,
    preview_url        TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stages (
    run_id            TEXT NOT NULL,
    stage             TEXT NOT NULL,
    status            TEXT NOT NULL,
    activity          TEXT,
    blocker           TEXT,
    attempts          INTEGER NOT NULL DEFAULT 0,
    revision          INTEGER NOT NULL DEFAULT 0,
    approved_revision INTEGER,
    started_at        TEXT,
    finished_at       TEXT,
    lease_owner       TEXT,
    lease_until       INTEGER,
    PRIMARY KEY (run_id, stage)
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id         TEXT PRIMARY KEY,
    run_id     TEXT NOT NULL,
    stage      TEXT NOT NULL,
    title      TEXT NOT NULL,
    path       TEXT NOT NULL,
    href       TEXT NOT NULL,
    revision   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (run_id, path)
  );

  CREATE TABLE IF NOT EXISTS revisions (
    run_id       TEXT NOT NULL,
    stage        TEXT NOT NULL,
    revision     INTEGER NOT NULL,
    summary      TEXT NOT NULL,
    artifact_ids TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (run_id, stage, revision)
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id       TEXT PRIMARY KEY,
    run_id   TEXT NOT NULL,
    stage    TEXT NOT NULL,
    revision INTEGER NOT NULL,
    decision TEXT NOT NULL,
    note     TEXT,
    at       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL,
    stage   TEXT,
    at      TEXT NOT NULL,
    level   TEXT NOT NULL,
    message TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);
  `,
  `
  ALTER TABLE runs ADD COLUMN repo_path TEXT;
  ALTER TABLE runs ADD COLUMN hero_choice TEXT;
  ALTER TABLE stages ADD COLUMN job_id TEXT;
  ALTER TABLE artifacts ADD COLUMN media TEXT NOT NULL DEFAULT 'document';
  ALTER TABLE revisions ADD COLUMN ref TEXT;
  ALTER TABLE revisions ADD COLUMN worker TEXT;
  ALTER TABLE revisions ADD COLUMN job_id TEXT;
  ALTER TABLE decisions ADD COLUMN choice TEXT;
  `,
];

export function rebuildDatabase(): DatabaseSync {
  const file = path.join(uiStateDir(), "website-rebuild.db");
  if (opened?.file === file) return opened.db;
  closeRebuildDatabase();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  const [{ user_version: version }] = db.prepare("PRAGMA user_version").all() as unknown as { user_version: number }[];
  for (let index = version; index < MIGRATIONS.length; index += 1) db.exec(MIGRATIONS[index]);
  if (version < MIGRATIONS.length) db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  opened = { file, db };
  return db;
}

export function closeRebuildDatabase(): void {
  opened?.db.close();
  opened = undefined;
}

/** Where "now" comes from. Tests pin it to make leases expire on demand. */
export const rebuildClock = { now: (): number => Date.now() };
const iso = () => new Date(rebuildClock.now()).toISOString();

interface RunRow {
  id: string;
  prospect_id: string;
  company: string;
  company_slug: string;
  website_url: string;
  target_market: string;
  location: string;
  conversion_goal: string;
  required_functions: string;
  design_template: string;
  worker_plan: string;
  skill_id: string;
  skill_version: string;
  workspace_slug: string | null;
  repo_path: string | null;
  hero_choice: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

interface StageRow {
  stage: RebuildStageId;
  status: RebuildStageStatus;
  activity: string | null;
  blocker: string | null;
  attempts: number;
  revision: number;
  approved_revision: number | null;
  started_at: string | null;
  finished_at: string | null;
  job_id: string | null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stagesOf(runId: string): RebuildStage[] {
  const rows = rebuildDatabase().prepare("SELECT * FROM stages WHERE run_id = ?").all(runId) as unknown as StageRow[];
  return STAGE_ORDER.map((id) => rows.find((row) => row.stage === id)).filter((row): row is StageRow => Boolean(row)).map((row) => ({
    id: row.stage,
    status: row.status,
    activity: row.activity ?? undefined,
    blocker: row.blocker ?? undefined,
    attempts: row.attempts,
    revision: row.revision,
    approvedRevision: row.approved_revision ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    jobId: row.job_id ?? undefined,
  }));
}

function toRun(row: RunRow, withDetail: boolean): RebuildRun {
  const db = rebuildDatabase();
  const plan = RebuildWorkerPlanSchema.safeParse(parseJson(row.worker_plan, {}));
  return {
    id: row.id,
    prospectId: row.prospect_id,
    company: row.company,
    companySlug: row.company_slug,
    websiteUrl: row.website_url,
    targetMarket: row.target_market,
    location: row.location,
    conversionGoal: row.conversion_goal,
    requiredFunctions: parseJson<RebuildFunction[]>(row.required_functions, []),
    designTemplate: row.design_template,
    workerPlan: plan.success ? plan.data : DEFAULT_WORKER_PLAN,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    workspaceSlug: row.workspace_slug ?? undefined,
    repoPath: row.repo_path ?? undefined,
    heroChoice: row.hero_choice ?? undefined,
    previewUrl: row.preview_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stages: stagesOf(row.id),
    artifacts: withDetail
      ? (db.prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, title").all(row.id) as unknown as { id: string; stage: RebuildStageId; media: "document" | "image"; title: string; path: string; href: string; revision: number; created_at: string }[]).map(
          (artifact): RebuildArtifact => ({ id: artifact.id, stage: artifact.stage, media: artifact.media, title: artifact.title, path: artifact.path, href: artifact.media === "image" ? `/api/rebuilds/${encodeURIComponent(row.id)}/artifacts/${encodeURIComponent(artifact.id)}` : artifact.href, revision: artifact.revision, createdAt: artifact.created_at }),
        )
      : [],
    revisions: withDetail
      ? (db.prepare("SELECT * FROM revisions WHERE run_id = ? ORDER BY created_at").all(row.id) as unknown as { stage: RebuildStageId; revision: number; summary: string; artifact_ids: string; ref: string | null; worker: string | null; job_id: string | null; created_at: string }[]).map(
          (revision): RebuildRevision => ({ stage: revision.stage, revision: revision.revision, summary: revision.summary, artifactIds: parseJson<string[]>(revision.artifact_ids, []), ref: revision.ref ?? undefined, worker: revision.worker ?? undefined, jobId: revision.job_id ?? undefined, createdAt: revision.created_at }),
        )
      : [],
    decisions: withDetail
      ? (db.prepare("SELECT * FROM decisions WHERE run_id = ? ORDER BY at").all(row.id) as unknown as { id: string; stage: RebuildStageId; revision: number; decision: "approved" | "changes_requested"; note: string | null; choice: string | null; at: string }[]).map(
          (decision): RebuildDecision => ({ id: decision.id, stage: decision.stage, revision: decision.revision, decision: decision.decision, note: decision.note ?? undefined, choice: decision.choice ?? undefined, at: decision.at }),
        )
      : [],
    events: withDetail
      ? (db.prepare("SELECT * FROM events WHERE run_id = ? ORDER BY id DESC LIMIT 200").all(row.id) as unknown as { id: number; stage: RebuildStageId | null; at: string; level: RebuildEvent["level"]; message: string }[]).map(
          (event): RebuildEvent => ({ id: event.id, stage: event.stage ?? undefined, at: event.at, level: event.level, message: event.message }),
        )
      : [],
  };
}

export function readRun(id: string): RebuildRun {
  const row = rebuildDatabase().prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  if (!row) throw new RebuildError("That rebuild does not exist.", 404);
  return toRun(row, true);
}

export function runForProspect(prospectId: string): RebuildRun | undefined {
  const row = rebuildDatabase().prepare("SELECT * FROM runs WHERE prospect_id = ?").get(prospectId) as RunRow | undefined;
  return row ? toRun(row, true) : undefined;
}

export function listRuns(): RebuildRunSummary[] {
  const rows = rebuildDatabase().prepare("SELECT * FROM runs ORDER BY updated_at DESC").all() as unknown as RunRow[];
  return rows.map((row) => {
    const run = toRun(row, false);
    return { id: run.id, prospectId: run.prospectId, company: run.company, workspaceSlug: run.workspaceSlug, previewUrl: run.previewUrl, updatedAt: run.updatedAt, stages: run.stages };
  });
}

export interface NewRun {
  prospectId: string;
  company: string;
  websiteUrl: string;
  targetMarket: string;
  location: string;
  conversionGoal: string;
  requiredFunctions: RebuildFunction[];
  designTemplate: string;
  workerPlan?: RebuildWorkerPlan;
  skillVersion: string;
}

/**
 * One rebuild per prospect: starting again returns the run already there,
 * so a double click or a retried request never makes a second workspace.
 */
export function createOrReuseRun(input: NewRun): { run: RebuildRun; created: boolean } {
  const existing = runForProspect(input.prospectId);
  if (existing) return { run: existing, created: false };

  const db = rebuildDatabase();
  const id = randomUUID();
  const now = iso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO runs (id, prospect_id, company, company_slug, website_url, target_market, location, conversion_goal, required_functions, design_template, worker_plan, skill_id, skill_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.prospectId,
      input.company,
      companyFileSlug(input.company),
      input.websiteUrl,
      input.targetMarket,
      input.location,
      input.conversionGoal,
      JSON.stringify(input.requiredFunctions),
      input.designTemplate,
      JSON.stringify(input.workerPlan ?? DEFAULT_WORKER_PLAN),
      REBUILD_SKILL_ID,
      input.skillVersion,
      now,
      now,
    );
    const insert = db.prepare("INSERT INTO stages (run_id, stage, status) VALUES (?, ?, 'not_started')");
    for (const stage of STAGE_ORDER) insert.run(id, stage);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    // Two requests raced: the other one made it. Hand back that run.
    const raced = runForProspect(input.prospectId);
    if (raced) return { run: raced, created: false };
    throw error;
  }
  logEvent(id, undefined, "info", `Rebuild started for ${input.company} using ${REBUILD_SKILL_ID} v${input.skillVersion}.`);
  return { run: readRun(id), created: true };
}

function touch(runId: string): void {
  rebuildDatabase().prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(iso(), runId);
}

export function setRunField(runId: string, field: "workspace_slug" | "preview_url" | "repo_path", value: string): void {
  rebuildDatabase().prepare(`UPDATE runs SET ${field} = ?, updated_at = ? WHERE id = ?`).run(value, iso(), runId);
}

export function logEvent(runId: string, stage: RebuildStageId | undefined, level: RebuildEvent["level"], message: string): void {
  rebuildDatabase().prepare("INSERT INTO events (run_id, stage, at, level, message) VALUES (?, ?, ?, ?, ?)").run(runId, stage ?? null, iso(), level, message.slice(0, 2000));
}

/**
 * Why a stage cannot start yet, or undefined when it can. Every earlier stage
 * must be complete, and every earlier gated stage must have its latest
 * revision approved: approving revision 1 says nothing about revision 2.
 */
export function startBlocker(run: RebuildRun, stage: RebuildStageId): string | undefined {
  const index = STAGE_ORDER.indexOf(stage);
  for (const earlier of run.stages.slice(0, index)) {
    if (earlier.status === "awaiting_approval") return `Waiting for approval of ${earlier.id} revision ${earlier.revision}.`;
    if (earlier.status !== "complete") return `Waiting for ${earlier.id} to finish.`;
    if (GATED_STAGES.has(earlier.id) && earlier.approvedRevision !== earlier.revision) {
      return `Waiting for approval of ${earlier.id} revision ${earlier.revision}.`;
    }
  }
  return undefined;
}

/** How long a worker may hold a stage without a heartbeat before it counts as abandoned. */
export const LEASE_MS = 10 * 60 * 1000;

/**
 * Takes the stage for one worker. Succeeds only if it is ready to start and
 * nobody else holds it; a lease left by a crashed process is taken over once
 * it expires.
 */
export function claimStage(runId: string, stage: RebuildStageId, owner: string): boolean {
  const run = readRun(runId);
  if (startBlocker(run, stage)) return false;
  const now = rebuildClock.now();
  const result = rebuildDatabase()
    .prepare(
      `UPDATE stages SET status = 'in_progress', lease_owner = ?, lease_until = ?, attempts = attempts + 1,
         started_at = ?, finished_at = NULL, blocker = NULL, activity = 'Starting'
       WHERE run_id = ? AND stage = ? AND status = 'not_started' AND (lease_until IS NULL OR lease_until < ?)`,
    )
    .run(owner, now + LEASE_MS, iso(), runId, stage, now);
  if (Number(result.changes) !== 1) return false;
  touch(runId);
  return true;
}

function requireLease(runId: string, stage: RebuildStageId, owner: string): void {
  const row = rebuildDatabase().prepare("SELECT lease_owner FROM stages WHERE run_id = ? AND stage = ?").get(runId, stage) as { lease_owner: string | null } | undefined;
  if (row?.lease_owner !== owner) throw new RebuildError("This stage was taken over by another worker.");
}

/** Reports progress and renews the lease. */
export function setActivity(runId: string, stage: RebuildStageId, owner: string, activity: string): void {
  requireLease(runId, stage, owner);
  rebuildDatabase()
    .prepare("UPDATE stages SET activity = ?, lease_until = ? WHERE run_id = ? AND stage = ?")
    .run(activity.slice(0, 300), rebuildClock.now() + LEASE_MS, runId, stage);
  touch(runId);
}

/** Records a report file the stage wrote. Retrying replaces the row for the same file instead of adding another. */
export function recordArtifact(runId: string, stage: RebuildStageId, input: { title: string; path: string; href: string; revision: number; media?: "document" | "image" }): string {
  const db = rebuildDatabase();
  const existing = db.prepare("SELECT id FROM artifacts WHERE run_id = ? AND path = ?").get(runId, input.path) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  db.prepare(
    `INSERT INTO artifacts (id, run_id, stage, title, path, href, revision, created_at, media) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, path) DO UPDATE SET title = excluded.title, href = excluded.href, revision = excluded.revision, created_at = excluded.created_at, media = excluded.media`,
  ).run(id, runId, stage, input.title, input.path, input.href, input.revision, iso(), input.media ?? "document");
  return id;
}

/**
 * Ends a stage's attempt with a new revision of its deliverable. A gated stage
 * then waits for approval of exactly that revision; any later stage that had
 * already moved on is paused, because what it built on has changed.
 */
export function completeStage(
  runId: string,
  stage: RebuildStageId,
  owner: string,
  summary: string,
  artifactIds: readonly string[],
  meta: { ref?: string; worker?: string; jobId?: string } = {},
): number {
  requireLease(runId, stage, owner);
  const db = rebuildDatabase();
  const gated = GATED_STAGES.has(stage);
  db.exec("BEGIN IMMEDIATE");
  try {
    const { revision } = db.prepare("SELECT revision FROM stages WHERE run_id = ? AND stage = ?").get(runId, stage) as { revision: number };
    const next = revision + 1;
    db.prepare("INSERT INTO revisions (run_id, stage, revision, summary, artifact_ids, created_at, ref, worker, job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      runId, stage, next, summary.slice(0, 2000), JSON.stringify(artifactIds), iso(), meta.ref ?? null, meta.worker ?? null, meta.jobId ?? null,
    );
    db.prepare(
      `UPDATE stages SET status = ?, revision = ?, approved_revision = CASE WHEN ? THEN approved_revision ELSE ? END,
         activity = NULL, blocker = NULL, lease_owner = NULL, lease_until = NULL, finished_at = ?, job_id = NULL
       WHERE run_id = ? AND stage = ?`,
    ).run(gated ? "awaiting_approval" : "complete", next, gated ? 1 : 0, next, iso(), runId, stage);

    for (const later of STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage) + 1)) {
      db.prepare(
        `UPDATE stages SET status = 'blocked', blocker = ?, lease_owner = NULL, lease_until = NULL
         WHERE run_id = ? AND stage = ? AND status IN ('in_progress', 'awaiting_approval', 'complete')`,
      ).run(`Paused: ${stage} changed to revision ${next}. Retry once it is approved.`, runId, later);
    }
    db.exec("COMMIT");
    logEvent(runId, stage, "info", gated ? `Revision ${next} is ready for your review.` : `Done. ${summary}`);
    touch(runId);
    return next;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Remembers the worker job a stage is waiting on, so a retry or a restart resumes it rather than starting a duplicate. */
export function setStageJob(runId: string, stage: RebuildStageId, owner: string, jobId: string | null): void {
  requireLease(runId, stage, owner);
  rebuildDatabase().prepare("UPDATE stages SET job_id = ? WHERE run_id = ? AND stage = ?").run(jobId, runId, stage);
}

/** Ends an attempt that could not finish. The stage waits for a person to retry it. */
export function blockStage(runId: string, stage: RebuildStageId, owner: string | undefined, blocker: string): void {
  if (owner) requireLease(runId, stage, owner);
  rebuildDatabase()
    .prepare("UPDATE stages SET status = 'blocked', blocker = ?, activity = NULL, lease_owner = NULL, lease_until = NULL, finished_at = ? WHERE run_id = ? AND stage = ?")
    .run(blocker.slice(0, 2000), iso(), runId, stage);
  logEvent(runId, stage, "warning", blocker);
  touch(runId);
}

/** Puts a blocked stage back in the queue. Its reports and earlier revisions stay. */
export function resetForRetry(runId: string, stage: RebuildStageId): void {
  const result = rebuildDatabase()
    .prepare("UPDATE stages SET status = 'not_started', blocker = NULL, activity = NULL WHERE run_id = ? AND stage = ? AND status = 'blocked'")
    .run(runId, stage);
  if (Number(result.changes) !== 1) throw new RebuildError("Only a blocked stage can be retried.");
  logEvent(runId, stage, "info", "Retry requested.");
  touch(runId);
}

/**
 * A person's decision on one revision of a gated stage. Refused unless that
 * revision is the latest and is waiting for review, so an approval can never
 * land on a deliverable nobody looked at.
 */
export function decide(runId: string, stage: RebuildStageId, revision: number, decision: "approved" | "changes_requested", note?: string, choice?: string): void {
  if (!GATED_STAGES.has(stage)) throw new RebuildError(`${stage} has no approval checkpoint.`, 422);
  if (decision === "changes_requested" && !note?.trim()) throw new RebuildError("Say what should change.", 422);
  const db = rebuildDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT status, revision FROM stages WHERE run_id = ? AND stage = ?").get(runId, stage) as { status: RebuildStageStatus; revision: number } | undefined;
    if (!row) throw new RebuildError("That rebuild does not exist.", 404);
    if (row.revision !== revision) throw new RebuildError(`Revision ${revision} is not the latest. Review revision ${row.revision} instead.`);
    if (row.status !== "awaiting_approval") throw new RebuildError("This revision is not waiting for review.");
    // The build follows one concept, so approving the concepts means choosing one of them.
    if (stage === "hero" && decision === "approved" && !(HERO_CONCEPTS as readonly string[]).includes(choice ?? "")) {
      throw new RebuildError("Choose which concept to build before approving.", 422);
    }

    db.prepare("INSERT INTO decisions (id, run_id, stage, revision, decision, note, at, choice) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), runId, stage, revision, decision, note?.trim() || null, iso(), choice ?? null);
    if (decision === "approved") {
      db.prepare("UPDATE stages SET status = 'complete', approved_revision = ? WHERE run_id = ? AND stage = ?").run(revision, runId, stage);
      if (stage === "hero") db.prepare("UPDATE runs SET hero_choice = ? WHERE id = ?").run(choice ?? null, runId);
    } else {
      // Back in the queue for a new revision that answers the note.
      db.prepare("UPDATE stages SET status = 'not_started', activity = ? WHERE run_id = ? AND stage = ?").run(`Changes requested on revision ${revision}`, runId, stage);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  logEvent(runId, stage, "info", decision === "approved" ? `Revision ${revision} approved${choice ? ` with ${choice}` : ""}.` : `Changes requested on revision ${revision}: ${note?.trim()}`);
  touch(runId);
}

/** The latest change request on a stage, for the worker making the next revision. */
export function openChangeRequest(runId: string, stage: RebuildStageId): RebuildDecision | undefined {
  const latest = readRun(runId).decisions.filter((decision) => decision.stage === stage).at(-1);
  return latest?.decision === "changes_requested" ? latest : undefined;
}

/**
 * After a restart, a stage left in progress has no worker. Once its lease
 * runs out it is marked blocked, with its reports intact, for a person to retry.
 */
export function recoverAbandonedStages(options: { atStartup?: boolean } = {}): number {
  const db = rebuildDatabase();
  // At startup no worker of this server can be alive yet, so every in-progress stage is abandoned.
  const cutoff = options.atStartup ? Number.MAX_SAFE_INTEGER : rebuildClock.now();
  const stale = db.prepare("SELECT run_id, stage FROM stages WHERE status = 'in_progress' AND (lease_until IS NULL OR lease_until < ?)").all(cutoff) as unknown as { run_id: string; stage: RebuildStageId }[];
  for (const row of stale) blockStage(row.run_id, row.stage, undefined, "Interrupted before it finished (AgentOS stopped or the worker went quiet). Retry to continue; nothing already saved is lost.");
  return stale.length;
}
