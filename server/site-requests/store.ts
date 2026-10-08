import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { priceProjectQuote, ProjectQuoteInputSchema } from "../../shared/business-quote-pricing";
import {
  BUILT_OR_BUILDING,
  CARE_INCLUDED_HOURS,
  ClientSiteInputSchema,
  SiteRequestCreateSchema,
  clientStatusLabel,
  coverageOf,
  type ClientSite,
  type Quote,
  type SiteRequest,
  type SiteRequestCreateInput,
  type SiteRequestStatus,
  type SiteRequestSummary,
  type Triage,
  type TriageAnswer,
} from "../../shared/site-request-types";
import { uiStateDir } from "../agentos/session-store";

/**
 * Customer website update requests, kept in their own `site-requests.db`.
 *
 * Two guarantees are enforced here rather than in the page:
 * - A request is approved (let through to be built) only when the client's
 *   plan covers it or its quote has been accepted.
 * - Only a person's press moves a request past a decision: triage by the AI
 *   proposes, and a person's override replaces it.
 */

export class SiteRequestError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "SiteRequestError";
  }
}

let opened: { file: string; db: DatabaseSync } | undefined;

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS sites (
    slug           TEXT PRIMARY KEY,
    company        TEXT NOT NULL,
    client_id      TEXT,
    contact_email  TEXT,
    repo_path      TEXT,
    github_repo    TEXT,
    vercel_project TEXT,
    production_url TEXT,
    plan           TEXT NOT NULL,
    included_hours REAL NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id          TEXT PRIMARY KEY,
    site_slug   TEXT NOT NULL REFERENCES sites(slug),
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    page        TEXT,
    priority    TEXT NOT NULL,
    source      TEXT NOT NULL,
    thread_id   TEXT,
    status      TEXT NOT NULL,
    triage      TEXT,
    quote       TEXT,
    approved_at TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_requests_site ON requests(site_slug, created_at);

  CREATE TABLE IF NOT EXISTS screenshots (
    id         TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id),
    name       TEXT NOT NULL,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL REFERENCES requests(id),
    at         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    message    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id, id);
  `,
];

export function siteRequestDatabase(): DatabaseSync {
  const file = path.join(uiStateDir(), "site-requests.db");
  if (opened?.file === file) return opened.db;
  closeSiteRequestDatabase();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  const [{ user_version: version }] = db.prepare("PRAGMA user_version").all() as unknown as { user_version: number }[];
  for (let index = version; index < MIGRATIONS.length; index += 1) db.exec(MIGRATIONS[index]);
  if (version < MIGRATIONS.length) db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  opened = { file, db };
  return db;
}

export function closeSiteRequestDatabase(): void {
  opened?.db.close();
  opened = undefined;
}

/** Where "now" comes from. Tests pin it to cross a month boundary. */
export const siteRequestClock = { now: (): number => Date.now() };
const iso = () => new Date(siteRequestClock.now()).toISOString();

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------ sites

interface SiteRow {
  slug: string;
  company: string;
  client_id: string | null;
  contact_email: string | null;
  repo_path: string | null;
  github_repo: string | null;
  vercel_project: string | null;
  production_url: string | null;
  plan: ClientSite["plan"];
  included_hours: number;
  created_at: string;
}

/** The calendar month a moment falls in, in the machine's own time, as `2026-10`. */
const monthOf = (at: number | string): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

/** Hours of covered requests let through this calendar month, so a plan's allowance is not spent twice. */
export function hoursUsedThisMonth(siteSlug: string, excludingId?: string): number {
  const rows = siteRequestDatabase().prepare("SELECT id, status, triage, approved_at FROM requests WHERE site_slug = ?").all(siteSlug) as unknown as { id: string; status: SiteRequestStatus; triage: string | null; approved_at: string | null }[];
  const month = monthOf(siteRequestClock.now());
  return rows
    .filter((row) => row.id !== excludingId && BUILT_OR_BUILDING.has(row.status) && row.approved_at && monthOf(row.approved_at) === month)
    .reduce((sum, row) => {
      const triage = parseJson<Triage | undefined>(row.triage, undefined);
      return sum + (triage?.covered ? triage.estimateHours : 0);
    }, 0);
}

function toSite(row: SiteRow): ClientSite {
  return {
    slug: row.slug,
    company: row.company,
    clientId: row.client_id ?? undefined,
    contactEmail: row.contact_email ?? undefined,
    repoPath: row.repo_path ?? undefined,
    githubRepo: row.github_repo ?? undefined,
    vercelProject: row.vercel_project ?? undefined,
    productionUrl: row.production_url ?? undefined,
    plan: row.plan,
    includedHoursPerMonth: row.included_hours,
    hoursUsedThisMonth: hoursUsedThisMonth(row.slug),
    createdAt: row.created_at,
  };
}

export function listSites(): ClientSite[] {
  const rows = siteRequestDatabase().prepare("SELECT * FROM sites ORDER BY company").all() as unknown as SiteRow[];
  return rows.map(toSite);
}

export function readSite(slug: string): ClientSite {
  const row = siteRequestDatabase().prepare("SELECT * FROM sites WHERE slug = ?").get(slug) as unknown as SiteRow | undefined;
  if (!row) throw new SiteRequestError("That client site is not registered.", 404);
  return toSite(row);
}

/** Registers a site, or changes one already registered. A change to the plan re-reads every open request's cover. */
export function saveSite(raw: unknown): ClientSite {
  const input = ClientSiteInputSchema.safeParse(raw);
  if (!input.success) throw new SiteRequestError(input.error.issues[0]?.message ?? "That site is not valid.", 422);
  const site = input.data;
  const included = site.includedHoursPerMonth ?? (site.plan === "care" ? CARE_INCLUDED_HOURS : site.plan === "maintenance" ? CARE_INCLUDED_HOURS : 0);
  const db = siteRequestDatabase();
  db.prepare(
    `INSERT INTO sites (slug, company, client_id, contact_email, repo_path, github_repo, vercel_project, production_url, plan, included_hours, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET company = excluded.company, client_id = excluded.client_id, contact_email = excluded.contact_email, repo_path = excluded.repo_path,
       github_repo = excluded.github_repo, vercel_project = excluded.vercel_project, production_url = excluded.production_url, plan = excluded.plan, included_hours = excluded.included_hours`,
  ).run(site.slug, site.company, site.clientId || null, site.contactEmail || null, site.repoPath || null, site.githubRepo || null, site.vercelProject || null, site.productionUrl || null, site.plan, included, iso());
  recalculateOpenCover(site.slug);
  return readSite(site.slug);
}

// ------------------------------------------------------------------ requests

interface RequestRow {
  id: string;
  site_slug: string;
  kind: SiteRequest["kind"];
  title: string;
  description: string;
  page: string | null;
  priority: SiteRequest["priority"];
  source: SiteRequest["source"];
  thread_id: string | null;
  status: SiteRequestStatus;
  triage: string | null;
  quote: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Statuses before a request is let through; its triage, quote and cover may still change. */
const DECIDING: ReadonlySet<SiteRequestStatus> = new Set(["received", "triaged", "quote_needed", "quoted"]);

function approvalState(status: SiteRequestStatus, triage: Triage | undefined, quote: Quote | undefined): { canApprove: boolean; blocker?: string } {
  if (!DECIDING.has(status)) return { canApprove: false };
  if (!triage) return { canApprove: false, blocker: "Triage this request first." };
  if (triage.covered) return { canApprove: true };
  if (quote?.acceptedAt) return { canApprove: true };
  if (quote) return { canApprove: false, blocker: "Outside the plan: waiting for the client to accept the quote." };
  return { canApprove: false, blocker: `Outside the plan: ${triage.coverage} Price it and get the quote accepted before any build.` };
}

function logEvent(requestId: string, kind: SiteRequest["events"][number]["kind"], message: string): void {
  siteRequestDatabase().prepare("INSERT INTO events (request_id, at, kind, message) VALUES (?, ?, ?, ?)").run(requestId, iso(), kind, message);
}

function touch(requestId: string): void {
  siteRequestDatabase().prepare("UPDATE requests SET updated_at = ? WHERE id = ?").run(iso(), requestId);
}

function setStatus(requestId: string, from: SiteRequestStatus | undefined, to: SiteRequestStatus, why: string): void {
  siteRequestDatabase().prepare("UPDATE requests SET status = ? WHERE id = ?").run(to, requestId);
  if (from !== to) logEvent(requestId, "status", `${why}`);
  touch(requestId);
}

function summaryOf(row: RequestRow, company: string): SiteRequestSummary {
  const triage = parseJson<Triage | undefined>(row.triage, undefined);
  const quote = parseJson<Quote | undefined>(row.quote, undefined);
  const approval = approvalState(row.status, triage, quote);
  return {
    id: row.id,
    siteSlug: row.site_slug,
    company,
    kind: row.kind,
    title: row.title,
    page: row.page ?? undefined,
    priority: row.priority,
    source: row.source,
    threadId: row.thread_id ?? undefined,
    status: row.status,
    clientStatus: clientStatusLabel(row.status),
    triage,
    quote,
    approvedAt: row.approved_at ?? undefined,
    canApprove: approval.canApprove,
    buildBlocker: approval.blocker,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowFor(id: string): RequestRow {
  const row = siteRequestDatabase().prepare("SELECT * FROM requests WHERE id = ?").get(id) as unknown as RequestRow | undefined;
  if (!row) throw new SiteRequestError("That request does not exist.", 404);
  return row;
}

export function listRequests(filter: { siteSlug?: string; status?: SiteRequestStatus } = {}): SiteRequestSummary[] {
  const rows = siteRequestDatabase().prepare("SELECT r.*, s.company AS company FROM requests r JOIN sites s ON s.slug = r.site_slug ORDER BY r.created_at DESC").all() as unknown as (RequestRow & { company: string })[];
  return rows.filter((row) => (!filter.siteSlug || row.site_slug === filter.siteSlug) && (!filter.status || row.status === filter.status)).map((row) => summaryOf(row, row.company));
}

export function readRequest(id: string): SiteRequest {
  const row = rowFor(id);
  const db = siteRequestDatabase();
  const company = readSite(row.site_slug).company;
  const screenshots = db.prepare("SELECT id, name FROM screenshots WHERE request_id = ? ORDER BY created_at").all(id) as unknown as { id: string; name: string }[];
  const events = db.prepare("SELECT * FROM events WHERE request_id = ? ORDER BY id DESC LIMIT 200").all(id) as unknown as { id: number; at: string; kind: SiteRequest["events"][number]["kind"]; message: string }[];
  return {
    ...summaryOf(row, company),
    description: row.description,
    screenshots: screenshots.map((shot) => ({ id: shot.id, name: shot.name, href: `/api/site-requests/${encodeURIComponent(id)}/screenshots/${encodeURIComponent(shot.id)}` })),
    events: events.map((event) => ({ id: event.id, at: event.at, kind: event.kind, message: event.message })),
  };
}

export function createRequest(raw: SiteRequestCreateInput): SiteRequest {
  const input = SiteRequestCreateSchema.safeParse(raw);
  if (!input.success) throw new SiteRequestError(input.error.issues[0]?.message ?? "That request is not valid.", 422);
  const data = input.data;
  const site = readSite(data.siteSlug);
  const id = randomUUID();
  const now = iso();
  siteRequestDatabase()
    .prepare("INSERT INTO requests (id, site_slug, kind, title, description, page, priority, source, thread_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)")
    .run(id, site.slug, data.kind, data.title, data.description, data.page || null, data.priority, data.source, data.threadId || null, now, now);
  logEvent(id, "status", `Received from ${site.company}${data.source === "mail" ? " by email" : ""}.`);
  return readRequest(id);
}

// ------------------------------------------------------------------ triage

/**
 * Records a triage and works out whether the plan covers it. The status
 * follows the cover: covered waits for a person's approval; not covered
 * needs a quote first (or keeps the quote it has).
 */
export function setTriage(id: string, answer: TriageAnswer, setBy: Triage["setBy"]): SiteRequest {
  const row = rowFor(id);
  if (!DECIDING.has(row.status)) throw new SiteRequestError("This request has already been approved, so it can no longer be re-triaged.");
  const site = readSite(row.site_slug);
  const cover = coverageOf({ plan: site.plan, includedHoursPerMonth: site.includedHoursPerMonth, hoursUsed: hoursUsedThisMonth(site.slug, id), classification: answer.classification, estimateHours: answer.estimateHours });
  const triage: Triage = { ...answer, covered: cover.covered, coverage: cover.reason, setBy, at: iso() };
  const quote = parseJson<Quote | undefined>(row.quote, undefined);
  const db = siteRequestDatabase();
  db.prepare("UPDATE requests SET triage = ? WHERE id = ?").run(JSON.stringify(triage), id);
  logEvent(id, "triage", `${setBy === "ai" ? "Triaged by AI" : "Triage set by you"}: ${answer.classification === "small_edit" ? "small edit" : "new feature"}, ${answer.estimateHours}h. ${cover.reason}`);
  setStatus(id, row.status, cover.covered ? "triaged" : quote ? "quoted" : "quote_needed", cover.covered ? "Covered by the plan; waiting for your approval." : quote ? "Outside the plan; a quote is already with the client." : "Outside the plan; a quote is needed before any build.");
  return readRequest(id);
}

/** After a plan or its hours change, open requests are re-read against it. */
function recalculateOpenCover(siteSlug: string): void {
  const rows = siteRequestDatabase().prepare("SELECT id, triage FROM requests WHERE site_slug = ? AND status IN ('received','triaged','quote_needed','quoted')").all(siteSlug) as unknown as { id: string; triage: string | null }[];
  for (const row of rows) {
    const triage = parseJson<Triage | undefined>(row.triage, undefined);
    if (triage) setTriage(row.id, { classification: triage.classification, estimateHours: triage.estimateHours, reason: triage.reason }, triage.setBy);
  }
}

// ------------------------------------------------------------------ quote

/** Prices a request that the plan does not cover. A quote that was already accepted is never replaced. */
export function makeQuote(id: string, raw: { estimatedHours: number; complexity: Quote["complexity"]; urgency: Quote["urgency"]; hourlyRate: number }): SiteRequest {
  const row = rowFor(id);
  if (!DECIDING.has(row.status)) throw new SiteRequestError("This request has already been approved.");
  const triage = parseJson<Triage | undefined>(row.triage, undefined);
  if (!triage) throw new SiteRequestError("Triage this request before quoting it.");
  if (triage.covered) throw new SiteRequestError("The plan covers this request, so it needs no quote.");
  if (parseJson<Quote | undefined>(row.quote, undefined)?.acceptedAt) throw new SiteRequestError("The client has already accepted a quote for this request.");
  const priced = priceProjectQuote(
    ProjectQuoteInputSchema.parse({ kind: "project", projectType: row.title, estimatedHours: raw.estimatedHours, complexity: raw.complexity, urgency: raw.urgency, hourlyRate: raw.hourlyRate }),
  );
  const quote: Quote = { estimatedHours: raw.estimatedHours, hourlyRate: raw.hourlyRate, complexity: raw.complexity, urgency: raw.urgency, lines: priced.lines, total: priced.total, createdAt: iso() };
  siteRequestDatabase().prepare("UPDATE requests SET quote = ? WHERE id = ?").run(JSON.stringify(quote), id);
  logEvent(id, "quote", `Quote prepared: R${priced.total.toFixed(2)} for ${raw.estimatedHours}h.`);
  setStatus(id, row.status, "quoted", "Quote prepared; waiting for the client to accept it.");
  return readRequest(id);
}

/** Recorded by hand when the client agrees. This is the only thing that lets an out-of-plan request be approved. */
export function acceptQuote(id: string): SiteRequest {
  const row = rowFor(id);
  const quote = parseJson<Quote | undefined>(row.quote, undefined);
  if (!DECIDING.has(row.status) || !quote) throw new SiteRequestError("There is no open quote to accept.");
  if (quote.acceptedAt) return readRequest(id);
  siteRequestDatabase().prepare("UPDATE requests SET quote = ? WHERE id = ?").run(JSON.stringify({ ...quote, acceptedAt: iso() }), id);
  logEvent(id, "quote", `Quote accepted by the client (R${quote.total.toFixed(2)}).`);
  touch(id);
  return readRequest(id);
}

export function markQuoteDrafted(id: string): void {
  const row = rowFor(id);
  const quote = parseJson<Quote | undefined>(row.quote, undefined);
  if (!quote) throw new SiteRequestError("There is no quote to draft.");
  siteRequestDatabase().prepare("UPDATE requests SET quote = ? WHERE id = ?").run(JSON.stringify({ ...quote, draftedAt: iso() }), id);
  logEvent(id, "email", "Quote email saved as a draft in Mail. Nothing was sent.");
  touch(id);
}

// ------------------------------------------------------------------ decisions

/**
 * Lets the request through to be built. Refused unless the plan covers it
 * or its quote has been accepted: the build gate. Slice 1 stops here; the
 * build itself starts from `approved`.
 */
export function approveRequest(id: string): SiteRequest {
  const row = rowFor(id);
  if (!DECIDING.has(row.status)) throw new SiteRequestError(`This request is already ${row.status.replace(/_/g, " ")}.`);
  const triage = parseJson<Triage | undefined>(row.triage, undefined);
  const quote = parseJson<Quote | undefined>(row.quote, undefined);
  const state = approvalState(row.status, triage, quote);
  if (!state.canApprove) throw new SiteRequestError(state.blocker ?? "This request cannot be approved yet.");
  // A covered request spends the month's hours when it is approved, so the allowance is checked again here.
  if (triage?.covered) {
    const site = readSite(row.site_slug);
    const again = coverageOf({ plan: site.plan, includedHoursPerMonth: site.includedHoursPerMonth, hoursUsed: hoursUsedThisMonth(site.slug, id), classification: triage.classification, estimateHours: triage.estimateHours });
    if (!again.covered) {
      setTriage(id, { classification: triage.classification, estimateHours: triage.estimateHours, reason: triage.reason }, triage.setBy);
      throw new SiteRequestError(`No longer covered: ${again.reason} It needs a quote.`);
    }
  }
  siteRequestDatabase().prepare("UPDATE requests SET approved_at = ? WHERE id = ?").run(iso(), id);
  logEvent(id, "decision", triage?.covered ? "Approved to build: covered by the plan." : "Approved to build: the quote was accepted.");
  setStatus(id, row.status, "approved", "Approved; ready to build.");
  return readRequest(id);
}

export function closeRequest(id: string, to: "declined" | "cancelled", note?: string): SiteRequest {
  const row = rowFor(id);
  if (["live", "declined", "cancelled", "shipping"].includes(row.status)) throw new SiteRequestError(`This request is already ${row.status}.`);
  logEvent(id, "decision", `${to === "declined" ? "Declined" : "Cancelled"}${note?.trim() ? `: ${note.trim()}` : "."}`);
  setStatus(id, row.status, to, to === "declined" ? "Declined." : "Cancelled.");
  return readRequest(id);
}

// ------------------------------------------------------------------ screenshots

export function addScreenshot(requestId: string, name: string, relativePath: string): string {
  rowFor(requestId);
  const id = randomUUID();
  siteRequestDatabase().prepare("INSERT INTO screenshots (id, request_id, name, path, created_at) VALUES (?, ?, ?, ?, ?)").run(id, requestId, name, relativePath, iso());
  logEvent(requestId, "screenshot", `Screenshot added: ${name}.`);
  touch(requestId);
  return id;
}

export function screenshotPath(requestId: string, screenshotId: string): string {
  const row = siteRequestDatabase().prepare("SELECT path FROM screenshots WHERE id = ? AND request_id = ?").get(screenshotId, requestId) as { path: string } | undefined;
  if (!row) throw new SiteRequestError("No such screenshot.", 404);
  return row.path;
}

export function logNote(requestId: string, kind: SiteRequest["events"][number]["kind"], message: string): void {
  rowFor(requestId);
  logEvent(requestId, kind, message);
}
