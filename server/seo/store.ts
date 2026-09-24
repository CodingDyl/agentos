import { randomUUID } from "node:crypto";
import type { ProjectSeo, SeoAuditRun, SeoCategory, SeoFinding, SeoSeverity } from "../../shared/seo-types";
import { seoDatabase } from "./db";

export interface NewFinding {
  category: SeoCategory;
  severity: SeoSeverity;
  title: string;
  description: string;
  pageUrl: string;
}

interface AuditRow {
  id: string;
  project_slug: string;
  target_url: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  error: string | null;
}

interface FindingRow {
  id: string;
  audit_id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  page_url: string;
  task_id: string | null;
}

function toFinding(row: FindingRow): SeoFinding {
  return {
    id: row.id,
    category: row.category as SeoCategory,
    severity: row.severity as SeoSeverity,
    title: row.title,
    description: row.description,
    pageUrl: row.page_url,
    taskId: row.task_id ?? undefined,
  };
}

function toRun(row: AuditRow, findings: SeoFinding[]): SeoAuditRun {
  return {
    id: row.id,
    targetUrl: row.target_url,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    status: row.status as SeoAuditRun["status"],
    error: row.error ?? undefined,
    findings,
  };
}

/**
 * Records a finished audit run in one transaction-like sequence: the run
 * row, then every finding, so a crash mid-write never leaves findings
 * pointing at an audit that doesn't exist.
 */
export function recordAuditRun(input: {
  projectSlug: string;
  targetUrl: string;
  startedAt: string;
  finishedAt: string;
  status: "complete" | "failed";
  error?: string;
  findings: NewFinding[];
}): SeoAuditRun {
  const db = seoDatabase();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO seo_audits (id, project_slug, target_url, started_at, finished_at, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectSlug, input.targetUrl, input.startedAt, input.finishedAt, input.status, input.error ?? null);

  const findings: SeoFinding[] = input.findings.map((finding) => {
    const findingId = randomUUID();

    db.prepare(
      `INSERT INTO seo_findings (id, audit_id, project_slug, category, severity, title, description, page_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(findingId, id, input.projectSlug, finding.category, finding.severity, finding.title, finding.description, finding.pageUrl);

    return { id: findingId, category: finding.category, severity: finding.severity, title: finding.title, description: finding.description, pageUrl: finding.pageUrl };
  });

  return toRun(
    { id, project_slug: input.projectSlug, target_url: input.targetUrl, started_at: input.startedAt, finished_at: input.finishedAt, status: input.status, error: input.error ?? null },
    findings,
  );
}

/** The tab's whole read: the latest run in full, and prior runs as a compact history. */
export function readProjectSeo(projectSlug: string): ProjectSeo {
  const db = seoDatabase();

  const runs = db
    .prepare("SELECT * FROM seo_audits WHERE project_slug = ? ORDER BY started_at DESC LIMIT 20")
    .all(projectSlug) as unknown as AuditRow[];

  if (runs.length === 0) return { latest: undefined, history: [] };

  const [latestRow, ...historyRows] = runs;

  const latestFindings = db
    .prepare("SELECT * FROM seo_findings WHERE audit_id = ?")
    .all(latestRow.id) as unknown as FindingRow[];

  const history = historyRows.map((row) => {
    const count = db
      .prepare("SELECT COUNT(*) as count FROM seo_findings WHERE audit_id = ?")
      .get(row.id) as unknown as { count: number };

    return {
      id: row.id,
      targetUrl: row.target_url,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      status: row.status as SeoAuditRun["status"],
      error: row.error ?? undefined,
      findingCount: count.count,
    };
  });

  return {
    latest: toRun(latestRow, latestFindings.map(toFinding)),
    history,
  };
}

/** Marks a finding as filed, once its task exists, so it is not offered a second time. */
export function markFindingFiled(findingId: string, taskId: string): void {
  seoDatabase().prepare("UPDATE seo_findings SET task_id = ? WHERE id = ?").run(taskId, findingId);
}

/** One finding, to build the task from — never trusts the client's copy of its own title/description. */
export function readFinding(findingId: string): SeoFinding | undefined {
  const row = seoDatabase().prepare("SELECT * FROM seo_findings WHERE id = ?").get(findingId) as unknown as
    | FindingRow
    | undefined;

  return row ? toFinding(row) : undefined;
}
