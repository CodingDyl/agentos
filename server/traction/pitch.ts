import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { calculateBusinessTotals } from "../../shared/business-billing-calculations";
import type { BusinessLedgerRecord } from "../../shared/business-ledger-types";
import type { BusinessEntity } from "../../shared/business-types";
import { leakEstimate, leakSentence, PATH_PLAY, type OutreachCase } from "../../shared/outreach-case";
import { priceMinor, type PitchPack, type PitchQuote, type PitchQuoteRequest, type PitchShot, type PitchSummary } from "../../shared/pitch-types";
import type { SiteCheck } from "../../shared/places-types";
import { REBUILD_STAGES, socialProfilePlatform, type RebuildArtifact, type RebuildRun } from "../../shared/website-rebuild-types";
import { getBusinessLedgerStatus, getBusinessProfile, mutateBusinessLedger } from "../business/ledger-store";
import { readBusinessState } from "../business/store";
import { blankCase, saysTheSame, writeCase } from "../outreach/cases";
import { checkSite } from "../places/site-check";
import { checkUrl, SafeFetchError } from "../web/safe-fetch";
import { REPORT_DIR } from "../website-rebuild/reports";
import { defaultRunnerDeps } from "../website-rebuild/runner";
import { screenshot, type Shot } from "../website-rebuild/screens";
import { listRuns, recordArtifact, runForProspect } from "../website-rebuild/store";
import { readState, TractionNotFoundError, type TractionState } from "./store";

/**
 * The Pitch Pack: a "build it first" prospect whose rebuild has a live
 * preview, with everything needed to sell it in one place.
 *
 * Assembled, never stored: the rebuild run (preview, screenshots), the
 * outreach case (findings, leak figures, prices, draft), a live site check,
 * the Business ledger (the quote) and the outreach log (whether it went out).
 *
 * Nothing here sends, publishes or charges. The draft is drafted by the
 * existing case path and sent by a person through the existing mail flow;
 * the quote is a draft in Business until the owner issues it.
 */

export class PitchError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

const PREVIEW_PLAY = PATH_PLAY.build_first;
const SENT_KINDS = new Set(["sent", "unconfirmed", "manual"]);
const PITCH_DIR = "pitch";

export interface PitchDeps {
  runForProspect: (prospectId: string) => RebuildRun | undefined;
  checkSite: (website: string) => Promise<SiteCheck>;
}

const defaultDeps: PitchDeps = { runForProspect, checkSite: (website) => checkSite(website) };

/** A site check is a network read: kept for an hour per address, in memory only. */
const SITE_CHECK_TTL_MS = 60 * 60 * 1000;
const siteChecks = new Map<string, { at: number; check: SiteCheck }>();
export function clearPitchSiteChecks(): void {
  siteChecks.clear();
}

/** When the website-preview email first went out (or was recorded as sent by hand). */
export function pitchedAt(state: Pick<TractionState, "outreachLog">, prospectId: string): string | undefined {
  return state.outreachLog
    .filter((entry) => entry.prospectId === prospectId && entry.play === PREVIEW_PLAY && SENT_KINDS.has(entry.kind))
    .map((entry) => entry.at)
    .sort()[0];
}

const shotSrc = (runId: string, artifactId: string) => `/api/rebuilds/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
const toShot = (run: RebuildRun, artifact: RebuildArtifact | undefined): PitchShot | undefined =>
  artifact ? { artifactId: artifact.id, title: artifact.title, src: shotSrc(run.id, artifact.id) } : undefined;
const newest = (artifacts: RebuildArtifact[]) => [...artifacts].sort((a, b) => b.revision - a.revision || b.createdAt.localeCompare(a.createdAt))[0];

/** The current site, desktop: only the Pitch Pack takes this one. */
export function beforeShot(run: RebuildRun): PitchShot | undefined {
  return toShot(run, newest(run.artifacts.filter((artifact) => artifact.media === "image" && artifact.path.endsWith(`/${PITCH_DIR}/before-desktop.png`))));
}

/** The preview's home page, desktop: the preview stage's own screenshot, else the Pitch Pack's. */
export function afterShot(run: RebuildRun): PitchShot | undefined {
  const images = run.artifacts.filter((artifact) => artifact.media === "image" && artifact.stage === "preview");
  const desktop = images.filter((artifact) => / \(desktop\)$/.test(artifact.title));
  return toShot(run, newest(desktop.filter((artifact) => /^(home|\/) \(desktop\)$/.test(artifact.title))) ?? newest(desktop.filter((artifact) => artifact.path.endsWith(`/${PITCH_DIR}/after-desktop.png`))) ?? newest(desktop));
}

/** Two or three plain findings: the site check's leaks first (they cost money), then the case's, without repeats. */
export function pitchFindings(check: SiteCheck | undefined, entry: OutreachCase): string[] {
  const findings: string[] = [];
  const add = (line: string) => {
    const clean = line.replace(/\s+/g, " ").trim().slice(0, 300);
    if (clean && !findings.includes(clean) && !saysTheSame(clean, findings)) findings.push(clean);
  };
  if (check?.reachable) for (const leak of check.leaks) add(leak);
  for (const finding of entry.findings) add(finding);
  if (check?.reachable) for (const problem of check.problems) add(problem);
  return findings.slice(0, 3);
}

async function siteCheckFor(website: string | undefined, deps: PitchDeps): Promise<SiteCheck | undefined> {
  if (!website) return undefined;
  const cached = siteChecks.get(website);
  if (cached && Date.now() - cached.at < SITE_CHECK_TTL_MS) return cached.check;
  const check = await deps.checkSite(website);
  siteChecks.set(website, { at: Date.now(), check });
  return check;
}

/** The quote already made for this prospect from a pitch, in any business. Voided ones do not count. */
export async function existingPitchQuote(prospectId: string): Promise<PitchQuote | undefined> {
  const { entities } = await readBusinessState();
  for (const entity of entities) {
    const quote = getBusinessLedgerStatus(entity.id).records.find((record) => isPitchQuoteFor(record, prospectId));
    if (quote && quote.kind === "quote") return { entityId: entity.id, entityName: entity.name, id: quote.id, status: quote.status, number: quote.number, amountMinor: quote.amountMinor };
  }
  return undefined;
}

function isPitchQuoteFor(record: BusinessLedgerRecord, prospectId: string): boolean {
  return record.kind === "quote" && !record.voided && record.sourceRecord?.tractionProspectId === prospectId;
}

/** Everything the Pitch ready card shows. `check` reads their current site (cached for an hour). */
export async function assemblePitch(prospectId: string, options: { check?: boolean } = {}, deps: PitchDeps = defaultDeps): Promise<PitchPack> {
  const state = await readState();
  const prospect = state.prospects.find((entry) => entry.id === prospectId);
  if (!prospect) throw new TractionNotFoundError(`No prospect ${prospectId}`);
  const entry = state.outreachCases[prospectId] ?? blankCase(prospectId);
  const sender = state.senders.find((candidate) => candidate.id === entry.senderId);
  const run = deps.runForProspect(prospectId);
  const sentAt = pitchedAt(state, prospectId);

  const check = options.check ? await siteCheckFor(prospect.website, deps) : undefined;
  const leak = leakEstimate(entry);
  const previewUrl = run?.previewUrl;
  const draftBody = entry.draft?.body ?? "";
  const linked = previewUrl || entry.previewUrl;

  return {
    prospectId,
    company: prospect.company,
    status: !run ? "none" : !previewUrl ? "building" : sentAt ? "pitched" : "ready",
    rebuild: run
      ? { runId: run.id, previewUrl, stagesDone: run.stages.filter((stage) => stage.status === "complete").length, stagesTotal: REBUILD_STAGES.length }
      : undefined,
    before: run ? beforeShot(run) : undefined,
    after: run ? afterShot(run) : undefined,
    findings: pitchFindings(check, entry),
    leak: leak ? leakSentence(leak) : undefined,
    siteChecked: Boolean(check?.reachable),
    prices: {
      setup: entry.setupPrice,
      monthly: entry.monthlyPrice,
      setupMinor: priceMinor(entry.setupPrice),
      monthlyMinor: priceMinor(entry.monthlyPrice),
      defaultSetup: sender?.defaultSetup ?? "",
      defaultMonthly: sender?.defaultMonthly ?? "",
    },
    quote: await existingPitchQuote(prospectId),
    pitchedAt: sentAt,
    draftReady: Boolean(draftBody.trim() && linked && draftBody.includes(linked)),
  };
}

/** Every prospect with a live preview: ready to pitch, or already pitched. For the pipeline and Mission Control. */
export async function listPitches(): Promise<PitchSummary[]> {
  const state = await readState();
  const known = new Set(state.prospects.map((prospect) => prospect.id));
  return listRuns()
    .filter((run) => run.previewUrl && known.has(run.prospectId))
    .map((run) => {
      const at = pitchedAt(state, run.prospectId);
      return at ? { prospectId: run.prospectId, status: "pitched" as const, pitchedAt: at } : { prospectId: run.prospectId, status: "ready" as const };
    });
}

// ─── The draft ──────────────────────────────────────────────────────────────

/**
 * Before drafting: the rebuild's preview becomes the case's preview link
 * (when the case has none), and the approach is "build it first". Only empty
 * fields are filled; nothing you wrote is replaced.
 */
export async function preparePitchCase(prospectId: string, deps: Pick<PitchDeps, "runForProspect"> = defaultDeps): Promise<OutreachCase> {
  const run = deps.runForProspect(prospectId);
  if (!run?.previewUrl) throw new PitchError("The rebuild has no preview yet. Finish the rebuild first.", 409);
  return writeCase(prospectId, { previewUrl: run.previewUrl, path: "build_first" }, "agent", { onlyEmpty: true });
}

// ─── The quote ──────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const rands = (minor: number) => `R${(minor / 100).toFixed(minor % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
/** How long a pitch quote stands. */
export const QUOTE_VALID_DAYS = 14;

/** Which business the quote is in: the one asked for, else the one named like the sending company, else the agency. */
export function pitchEntity(entities: readonly BusinessEntity[], requested: string | undefined, senderCompany: string | undefined): BusinessEntity {
  if (requested) {
    const found = entities.find((entity) => entity.id === requested);
    if (!found) throw new PitchError("No such business.", 404);
    return found;
  }
  const named = senderCompany ? entities.find((entity) => entity.name.trim().toLowerCase() === senderCompany.trim().toLowerCase()) : undefined;
  const chosen = named ?? entities.find((entity) => entity.kind === "agency") ?? entities[0];
  if (!chosen) throw new PitchError("Set up a business in Business first.", 409);
  return chosen;
}

/** The quote's lines: the set-up fee (when there is one) and the first month. */
export function pitchQuoteItems(company: string, setupMinor: number | undefined, monthlyMinor: number | undefined) {
  const items: { description: string; quantity: number; unitPriceMinor: number }[] = [];
  if (setupMinor) items.push({ description: `New website for ${company}: design, build and launch (once-off set-up)`, quantity: 1, unitPriceMinor: setupMinor });
  if (monthlyMinor) items.push({ description: "Hosting, care and changes: first month", quantity: 1, unitPriceMinor: monthlyMinor });
  return items;
}

/**
 * One click: a draft quote in Business for this prospect, from the case's
 * set-up and monthly prices (ZAR). Prices sent with the request are saved on
 * the case first. A quote already made for this prospect is returned instead
 * of a second. The prospect becomes a client in that business (matched by
 * email when one exists) so the quote can be issued; nothing is issued or sent.
 */
export async function createPitchQuote(prospectId: string, input: PitchQuoteRequest): Promise<{ quote: PitchQuote; created: boolean }> {
  let state = await readState();
  const prospect = state.prospects.find((entry) => entry.id === prospectId);
  if (!prospect) throw new TractionNotFoundError(`No prospect ${prospectId}`);

  const prices = { ...(input.setupPrice !== undefined ? { setupPrice: input.setupPrice } : {}), ...(input.monthlyPrice !== undefined ? { monthlyPrice: input.monthlyPrice } : {}) };
  if (Object.keys(prices).length > 0) {
    await writeCase(prospectId, prices, "you");
    state = await readState();
  }
  const entry = state.outreachCases[prospectId] ?? blankCase(prospectId);
  const monthlyMinor = priceMinor(entry.monthlyPrice);
  const setupMinor = priceMinor(entry.setupPrice);
  if (!monthlyMinor && !setupMinor) throw new PitchError("Set the monthly price (and the set-up fee, if any) first.");

  const existing = await existingPitchQuote(prospectId);
  if (existing) return { quote: existing, created: false };

  const sender = state.senders.find((candidate) => candidate.id === entry.senderId);
  const entity = pitchEntity((await readBusinessState()).entities, input.entityId, sender?.company);
  const profile = getBusinessProfile(entity.id);
  const items = pitchQuoteItems(prospect.company, setupMinor, monthlyMinor);
  let created = false;

  const status = mutateBusinessLedger(
    entity,
    getBusinessLedgerStatus(entity.id).revision,
    (records) => {
      // Checked again inside the transaction: two clicks never make two quotes.
      if (records.some((record) => isPitchQuoteFor(record, prospectId))) return records;
      const email = prospect.email?.trim().toLowerCase();
      let client = records.find((record) => record.kind === "client" && !record.voided && record.sourceRecord?.tractionProspectId === prospectId)
        ?? (email ? records.find((record) => record.kind === "client" && !record.voided && record.email?.trim().toLowerCase() === email) : undefined);
      if (!client) {
        const id = randomUUID();
        client = {
          id, sourceId: id, source: "agentos", entityId: entity.id, kind: "client",
          name: (prospect.contact ?? prospect.company).slice(0, 1000), companyName: prospect.company.slice(0, 1000),
          email: prospect.email, locallyEdited: true, sourceRecord: { tractionProspectId: prospectId },
        };
        records.push(client);
      }
      const id = randomUUID();
      const issuedOn = today();
      records.push({
        id, sourceId: id, source: "agentos", entityId: entity.id, kind: "quote",
        clientId: client.id, title: `Website for ${prospect.company}`.slice(0, 1000), detail: "complete", status: "draft",
        currency: "ZAR", items, ...calculateBusinessTotals(items),
        issuedOn, dueOn: plusDays(issuedOn, QUOTE_VALID_DAYS),
        issuerDetails: profile, issuerName: profile?.legalName ?? entity.name,
        terms: [monthlyMinor ? `Then ${rands(monthlyMinor)} a month from launch: hosting, care and changes. Cancel any time with a month's notice.` : undefined, profile?.defaultTerms].filter(Boolean).join("\n\n").slice(0, 5000),
        locallyEdited: true,
        sourceRecord: { tractionProspectId: prospectId },
      });
      created = true;
      return records;
    },
    { action: "save", reason: "Quote from a Traction pitch" },
  );
  const quote = status.records.find((record) => isPitchQuoteFor(record, prospectId));
  if (!quote || quote.kind !== "quote") throw new PitchError("The quote could not be saved.", 500);
  return { quote: { entityId: entity.id, entityName: entity.name, id: quote.id, status: quote.status, number: quote.number, amountMinor: quote.amountMinor }, created };
}

// ─── Screenshots ────────────────────────────────────────────────────────────

export interface ShotDeps {
  runForProspect: (prospectId: string) => RebuildRun | undefined;
  screenshot: (targets: readonly { name: string; target: string }[], outputDir: string) => Promise<Shot[]>;
  writeBinary: (relativePath: string, sourceFile: string) => Promise<void>;
}

const defaultShotDeps: ShotDeps = {
  runForProspect,
  screenshot: (targets, outputDir) => screenshot(targets, outputDir),
  writeBinary: async (relativePath, sourceFile) => {
    if (!defaultRunnerDeps.writeBinary) throw new PitchError("Screenshots cannot be stored in this setup.", 409);
    await defaultRunnerDeps.writeBinary(relativePath, sourceFile);
  },
};

const capturing = new Set<string>();

/**
 * The before and after, when the rebuild has not got them: their current
 * site and the preview, photographed with the rebuild's own screenshot code
 * and stored as the run's image artifacts in its workspace, where the rebuild
 * API serves them. Only public web addresses are photographed.
 */
export async function capturePitchShots(prospectId: string, deps: ShotDeps = defaultShotDeps): Promise<{ taken: number }> {
  const run = deps.runForProspect(prospectId);
  if (!run) throw new PitchError("No rebuild for this prospect.", 404);
  if (!run.workspaceSlug) throw new PitchError("The rebuild has no workspace yet.", 409);
  if (capturing.has(run.id)) throw new PitchError("Screenshots are already being taken.", 409);

  const targets: { name: "before" | "after"; target: string }[] = [];
  const usable = (url: string | undefined) => {
    if (!url || socialProfilePlatform(url)) return undefined;
    try {
      return checkUrl(url).href;
    } catch (error) {
      if (error instanceof SafeFetchError) return undefined;
      throw error;
    }
  };
  const current = usable(run.websiteUrl);
  const preview = usable(run.previewUrl);
  if (!beforeShot(run) && current) targets.push({ name: "before", target: current });
  if (!afterShot(run) && preview) targets.push({ name: "after", target: preview });
  if (targets.length === 0) return { taken: 0 };

  capturing.add(run.id);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-pitch-"));
  try {
    const shots = await deps.screenshot(targets, scratch);
    for (const shot of shots) {
      const stage = shot.name === "before" ? "capture" : "preview";
      const relativePath = `projects/${run.workspaceSlug}/${REPORT_DIR}/${PITCH_DIR}/${shot.name}-${shot.viewport}.png`;
      await deps.writeBinary(relativePath, shot.file);
      const digest = createHash("sha256").update(await fs.readFile(shot.file)).digest("hex");
      const revision = Math.max(1, run.stages.find((entry) => entry.id === stage)?.revision ?? 1);
      recordArtifact(run.id, stage, { title: `${shot.name === "before" ? "Current site" : "Preview"} (${shot.viewport})`, path: relativePath, href: "", revision, media: "image", digest });
    }
    return { taken: shots.length };
  } finally {
    capturing.delete(run.id);
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
