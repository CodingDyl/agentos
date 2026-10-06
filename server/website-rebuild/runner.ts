import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { REBUILD_SKILL_ID, STAGE_ORDER, socialProfilePlatform, type BrandAsset, type BrandKit, type RebuildRun, type RebuildStageId } from "../../shared/website-rebuild-types";
import { agentOSRoot, readOptionalFile } from "../agentos/filesystem";
import { createProject, toSlug } from "../agentos/mutations/projects";
import { editFile } from "../agentos/mutations/writer";
import { readDimensions } from "../designs/media";
import { BRAND_EXTENSION, buildBrandReport, chooseBrandImages, summariseColors, summariseFonts } from "./brand";
import { captureSite, fetchRobots, withBrowserLoader, type CaptureResult } from "./capture";
import { REPORT_DIR, buildManifest, buildSkippedReport, buildStructure, buildTranscript, reportFile } from "./reports";
import { StageBlocked, type RunnerDeps, type StageContext, type StageHandler } from "./stage-kit";
import { buildStage, functionsStage, heroStage, previewStage, researchStage } from "./stages";
import { isSkillEnabled } from "../skills/registry";
import {
  blockStage,
  claimStage,
  completeStage,
  logEvent,
  readRun,
  openChangeRequest,
  recordArtifact,
  setActivity,
  setStageJob,
  setBrandKit,
  setRunField,
  startBlocker,
} from "./store";

/**
 * Moves a rebuild forward, one stage at a time, in the background.
 *
 * `advance` starts every stage that is ready, in order, and stops at the
 * first one that cannot go on: waiting for approval, blocked, or not built
 * yet. It is safe to call as often as you like: a stage already held by a
 * worker is left alone (the lease in the store guarantees that, across
 * processes too), and a run already advancing in this process is not
 * started twice.
 */

export { StageBlocked } from "./stage-kit";
export type { RunnerDeps, StageContext, StageHandler, StageOutcome } from "./stage-kit";

const PROJECTS_DIR = "projects";
/** What a stored image may be called. Never `svg`: capture rasterises those. */
const IMAGE_EXTENSIONS = new Set(Object.values(BRAND_EXTENSION));

async function ensureWorkspace(run: RebuildRun): Promise<{ slug: string; reused: boolean }> {
  const existing = run.workspaceSlug ?? toSlug(run.company);
  if (await readOptionalFile(`${PROJECTS_DIR}/${existing}/PROJECT.md`)) return { slug: existing, reused: true };
  const created = await createProject({
    name: run.company,
    slug: existing,
    goal: `${run.websiteUrl ? `Rebuild ${run.company}'s website (${run.websiteUrl})` : `Build ${run.company} a website`} and share a Vercel preview. Goal for visitors: ${run.conversionGoal}.`,
    type: "Client",
    state: "active",
    priority: "medium",
  });
  return { slug: created.slug, reused: false };
}

export const defaultRunnerDeps: RunnerDeps = {
  ensureWorkspace,
  capture: (url, onProgress) =>
    withBrowserLoader((loadPage) => captureSite(url, { fetchRobots, loadPage, now: () => new Date(), onProgress })),
  writeDocument: async (relativePath, markdown) => {
    await editFile({ relativePath, label: "rebuild.report", apply: () => markdown });
  },
  writeBinary: async (relativePath, sourceFile) => {
    const root = path.resolve(agentOSRoot());
    const target = path.resolve(root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Refusing to write outside the vault: ${relativePath}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(sourceFile, target);
  },
};

const workspaceStage: StageHandler = async (context, deps) => {
  context.activity("Finding or creating the workspace");
  const { slug, reused } = await deps.ensureWorkspace(context.run);
  setRunField(context.run.id, "workspace_slug", slug);
  context.log(reused ? `Reusing the existing workspace ${slug}.` : `Created the workspace ${slug}.`);
  return { summary: reused ? `Linked to the existing workspace ${slug}.` : `Workspace ${slug} created.`, artifactIds: [] };
};

/**
 * Why capture should not read anything, before it tries: no website, or a
 * profile on a social platform, which is not theirs to rebuild and mostly
 * sits behind a login. A person's earlier "skip" counts too.
 */
export function captureSkipReason(run: Pick<RebuildRun, "websiteUrl" | "siteNote">): string | undefined {
  if (run.siteNote) return run.siteNote;
  if (!run.websiteUrl) return "They have no website.";
  const platform = socialProfilePlatform(run.websiteUrl);
  if (platform) return `Their only web presence is a ${platform} page (${run.websiteUrl}), which AgentOS does not read.`;
  return undefined;
}

/**
 * Capture skipped: the stage still completes, with placeholder reports that
 * say why, so research and the briefs know to work from the intake details
 * and the research alone.
 */
async function skipCapture(context: StageContext, reason: string): Promise<{ summary: string; artifactIds: string[] }> {
  setRunField(context.run.id, "site_note", reason);
  context.log(`Website capture skipped: ${reason}`, "warning");
  const run = { ...context.run, siteNote: reason };
  const ids = [
    await context.writeReport("website_transcript", "Website transcript", buildSkippedReport(run, "website transcript", reason)),
    await context.writeReport("current_structure", "Current structure", buildSkippedReport(run, "current structure", reason)),
  ];
  return { summary: `Skipped: ${reason} The rebuild works from the research and the details you gave.`, artifactIds: ids };
}

const captureStage: StageHandler = async (context, deps) => {
  const skip = captureSkipReason(context.run);
  if (skip) return skipCapture(context, skip);

  context.activity(`Reading robots.txt for ${context.run.websiteUrl}`);
  const capture = await deps.capture(context.run.websiteUrl, context.activity);
  if (capture.pages.length === 0) {
    // The site's owner asked crawlers to stay out: that is an answer, not a fault to retry.
    if (capture.manifest.skipped.some((entry) => entry.url === capture.manifest.startUrl && entry.reason === "disallowed by robots.txt")) {
      return skipCapture(context, `Their site (${context.run.websiteUrl}) asks automated readers to stay out in robots.txt, so it was not read.`);
    }
    const reason = capture.manifest.failed[0]?.reason ?? capture.manifest.skipped[0]?.reason ?? "no pages could be read";
    throw new StageBlocked(`The site could not be captured: ${reason}. Check the address and retry, or skip this step to work without it.`);
  }
  context.activity("Writing the transcript, structure report and crawl manifest");
  const ids = [
    await context.writeReport("website_transcript", "Website transcript", buildTranscript(context.run, capture)),
    await context.writeReport("current_structure", "Current structure", buildStructure(context.run, capture)),
    await context.writeReport("crawl_manifest", "Crawl manifest", buildManifest(context.run, capture)),
  ];
  const { captured, skipped, failed } = capture.manifest;
  if (failed.length > 0) context.log(`${failed.length} page${failed.length === 1 ? "" : "s"} could not be loaded. They are listed in the crawl manifest.`, "warning");
  const kit = await saveBrandKit(context, capture);
  ids.push(...kit.artifactIds);
  return { summary: `Captured ${captured.length} page${captured.length === 1 ? "" : "s"}; ${skipped.length} skipped, ${failed.length} failed. ${kit.summary}`, artifactIds: ids };
};

/**
 * The brand kit: the chosen images stored in the workspace, the colours and
 * fonts on the run. A failure here is logged, never a blocker: the rebuild
 * can go on without the client's branding, just less tailored.
 */
async function saveBrandKit(context: StageContext, capture: CaptureResult): Promise<{ artifactIds: string[]; summary: string }> {
  context.activity("Collecting the logo, photos, colours and fonts");
  let scratch: string | undefined;
  try {
    const chosen = chooseBrandImages(capture);
    const assets: BrandAsset[] = [];
    const artifactIds: string[] = [];
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-brand-"));
    for (const { kind, name, image } of chosen) {
      const extension = BRAND_EXTENSION[image.contentType];
      const file = path.join(scratch, `${name}.${extension}`);
      await fs.writeFile(file, image.data);
      const artifactId = await context.writeImage(name, kind === "logo" ? `Logo (${name})` : `Photo ${name.replace("photo-", "")}`, file, { folder: "brand", extension });
      const artifact = readRun(context.run.id).artifacts.find((entry) => entry.id === artifactId);
      const measured = readDimensions(image.data);
      assets.push({
        id: name,
        kind,
        artifactId,
        path: artifact?.path ?? "",
        sourceUrl: image.url,
        alt: image.alt?.slice(0, 300),
        width: measured?.width ?? image.width,
        height: measured?.height ?? image.height,
        include: true,
      });
      artifactIds.push(artifactId);
    }
    // A recapture replaces what came from the site, never what a person uploaded.
    const uploaded = (readRun(context.run.id).brandKit?.assets ?? []).filter((asset) => asset.sourceUrl === "uploaded");
    const kit: BrandKit = {
      capturedAt: capture.manifest.capturedAt,
      source: uploaded.length > 0 ? "edited" : "capture",
      assets: [...uploaded.filter((asset) => asset.kind === "logo"), ...assets, ...uploaded.filter((asset) => asset.kind === "photo")],
      colors: summariseColors(capture.pages.flatMap((page) => page.brand?.colors ?? [])),
      fonts: summariseFonts(capture.pages.flatMap((page) => page.brand?.fonts ?? [])),
    };
    setBrandKit(context.run.id, kit);
    artifactIds.push(await context.writeReport("brand_kit", "Brand kit", buildBrandReport(context.run, kit)));
    const logos = assets.filter((asset) => asset.kind === "logo").length;
    const photos = assets.length - logos;
    return { artifactIds, summary: `Brand kit: ${logos > 0 ? "logo" : "no logo"}, ${photos} photo${photos === 1 ? "" : "s"}, ${kit.colors.length} colour${kit.colors.length === 1 ? "" : "s"}.` };
  } catch (error) {
    context.log(`The brand kit could not be collected: ${error instanceof Error ? error.message : "unknown error"}. The rebuild goes on without the client's branding.`, "warning");
    return { artifactIds: [], summary: "No brand kit." };
  } finally {
    if (scratch) await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const STAGE_HANDLERS: Record<RebuildStageId, StageHandler> = {
  workspace: workspaceStage,
  capture: captureStage,
  research: researchStage,
  hero: heroStage,
  build: buildStage,
  functions: functionsStage,
  preview: previewStage,
};

export const skillPausedReason = (skillId: string) =>
  `Paused: the ${skillId} skill is disabled in Connectors → Skills. Everything so far is kept. Enable it, then retry.`;

const advancing = new Set<string>();

/** Runs one claimed stage to its end: a new revision, or a blocker. Never throws. */
async function runStage(runId: string, stage: RebuildStageId, owner: string, handlers: Record<RebuildStageId, StageHandler>, deps: RunnerDeps): Promise<boolean> {
  const run = readRun(runId);
  const record = run.stages.find((entry) => entry.id === stage);
  if (!record) throw new Error(`Run ${runId} has no ${stage} stage.`);
  const revision = record.revision + 1;
  const artifactHref = (relativePath: string, slug: string) => `/workspaces/${encodeURIComponent(slug)}?tab=documents&doc=${encodeURIComponent(relativePath)}`;
  const context: StageContext = {
    run,
    stage,
    record,
    revision,
    changeRequest: openChangeRequest(runId, stage)?.note,
    activity: (message) => setActivity(runId, stage, owner, message),
    log: (message, level = "info") => logEvent(runId, stage, level, message),
    writeReport: async (name, title, markdown) => {
      const latest = readRun(runId);
      if (!latest.workspaceSlug) throw new StageBlocked("The run has no workspace yet.");
      const relativePath = `${PROJECTS_DIR}/${latest.workspaceSlug}/${REPORT_DIR}/${reportFile(latest, name)}`;
      await deps.writeDocument(relativePath, markdown);
      return recordArtifact(runId, stage, { title, path: relativePath, href: artifactHref(relativePath, latest.workspaceSlug), revision });
    },
    writeImage: async (name, title, file, options = {}) => {
      const latest = readRun(runId);
      if (!latest.workspaceSlug) throw new StageBlocked("The run has no workspace yet.");
      if (!deps.writeBinary) throw new StageBlocked("Screenshots cannot be stored in this setup.");
      const extension = options.extension ?? "png";
      if (!IMAGE_EXTENSIONS.has(extension)) throw new Error(`Not an image extension: ${extension}`);
      // One file per revision, so an earlier revision's screenshots stay as they were reviewed.
      const relativePath = `${PROJECTS_DIR}/${latest.workspaceSlug}/${REPORT_DIR}/${options.folder ?? "screens"}/${stage}-r${revision}-${name}.${extension}`;
      await deps.writeBinary(relativePath, file);
      const id = recordArtifact(runId, stage, { title, path: relativePath, href: "", revision, media: "image" });
      return id;
    },
    rememberJob: (jobId) => setStageJob(runId, stage, owner, jobId),
  };

  try {
    const outcome = await handlers[stage](context, deps);
    completeStage(runId, stage, owner, outcome.summary, outcome.artifactIds, { ref: outcome.ref, worker: outcome.worker, jobId: outcome.jobId });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The stage failed.";
    if (!(error instanceof StageBlocked)) console.error(`[agentos] rebuild ${runId} stage ${stage} failed:`, error);
    try {
      blockStage(runId, stage, owner, error instanceof StageBlocked ? message : `Failed: ${message} Retry to try again.`);
    } catch (blockError) {
      // Lost the lease: another worker owns the stage now, and it reports its own outcome.
      console.error(`[agentos] rebuild ${runId} stage ${stage} could not record its failure:`, blockError);
    }
    return false;
  }
}

/** Starts every stage that is ready, in order. Resolves when the run stops for a person, a blocker, or the end. */
export async function advance(runId: string, handlers = STAGE_HANDLERS, deps = defaultRunnerDeps): Promise<void> {
  if (advancing.has(runId)) return;
  advancing.add(runId);
  const owner = `${process.pid}:${randomUUID()}`;
  try {
    for (;;) {
      const run = readRun(runId);
      const next = STAGE_ORDER.map((id) => run.stages.find((stage) => stage.id === id)).find((stage) => stage && stage.status !== "complete");
      if (!next || next.status !== "not_started" || startBlocker(run, next.id)) return;
      // A disabled skill lets the stage in hand finish, then stops here, before the next one starts.
      if (!(await (deps.skillEnabled ?? isSkillEnabled)(run.skillId))) {
        blockStage(runId, next.id, undefined, skillPausedReason(run.skillId));
        return;
      }
      if (!claimStage(runId, next.id, owner)) return;
      if (!(await runStage(runId, next.id, owner, handlers, deps))) return;
    }
  } finally {
    advancing.delete(runId);
  }
}

/** Fire and forget, for request handlers: the page polls for progress. */
export function advanceInBackground(runId: string): void {
  void advance(runId).catch((error) => console.error(`[agentos] rebuild ${runId} could not advance:`, error));
}

const SKILL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../skills", REBUILD_SKILL_ID, "SKILL.md");

/** The version a new run is pinned to, from the skill's own front matter. */
export async function currentSkillVersion(): Promise<string> {
  try {
    const { data } = matter(await fs.readFile(SKILL_FILE, "utf8"));
    return typeof data.version === "string" && data.version.trim() ? data.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
