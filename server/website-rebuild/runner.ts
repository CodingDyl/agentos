import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { REBUILD_SKILL_ID, STAGE_ORDER, type RebuildRun, type RebuildStageId } from "../../shared/website-rebuild-types";
import { agentOSRoot, readOptionalFile } from "../agentos/filesystem";
import { createProject, toSlug } from "../agentos/mutations/projects";
import { editFile } from "../agentos/mutations/writer";
import { captureSite, fetchRobots, withBrowserLoader } from "./capture";
import { REPORT_DIR, buildManifest, buildStructure, buildTranscript, reportFile } from "./reports";
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

async function ensureWorkspace(run: RebuildRun): Promise<{ slug: string; reused: boolean }> {
  const existing = run.workspaceSlug ?? toSlug(run.company);
  if (await readOptionalFile(`${PROJECTS_DIR}/${existing}/PROJECT.md`)) return { slug: existing, reused: true };
  const created = await createProject({
    name: run.company,
    slug: existing,
    goal: `Rebuild ${run.company}'s website (${run.websiteUrl}) and share a Vercel preview. Goal for visitors: ${run.conversionGoal}.`,
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

const captureStage: StageHandler = async (context, deps) => {
  context.activity(`Reading robots.txt for ${context.run.websiteUrl}`);
  const capture = await deps.capture(context.run.websiteUrl, context.activity);
  if (capture.pages.length === 0) {
    const reason = capture.manifest.failed[0]?.reason ?? capture.manifest.skipped[0]?.reason ?? "no pages could be read";
    throw new StageBlocked(`The site could not be captured: ${reason}. Check the address, then retry.`);
  }
  context.activity("Writing the transcript, structure report and crawl manifest");
  const ids = [
    await context.writeReport("website_transcript", "Website transcript", buildTranscript(context.run, capture)),
    await context.writeReport("current_structure", "Current structure", buildStructure(context.run, capture)),
    await context.writeReport("crawl_manifest", "Crawl manifest", buildManifest(context.run, capture)),
  ];
  const { captured, skipped, failed } = capture.manifest;
  if (failed.length > 0) context.log(`${failed.length} page${failed.length === 1 ? "" : "s"} could not be loaded. They are listed in the crawl manifest.`, "warning");
  return { summary: `Captured ${captured.length} page${captured.length === 1 ? "" : "s"}; ${skipped.length} skipped, ${failed.length} failed.`, artifactIds: ids };
};

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
    writeImage: async (name, title, file) => {
      const latest = readRun(runId);
      if (!latest.workspaceSlug) throw new StageBlocked("The run has no workspace yet.");
      if (!deps.writeBinary) throw new StageBlocked("Screenshots cannot be stored in this setup.");
      // One file per revision, so an earlier revision's screenshots stay as they were reviewed.
      const relativePath = `${PROJECTS_DIR}/${latest.workspaceSlug}/${REPORT_DIR}/screens/${stage}-r${revision}-${name}.png`;
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
