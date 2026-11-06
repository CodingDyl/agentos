import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HERO_CONCEPTS, REBUILD_FUNCTION_LABEL, approvedCommit, previewCommit, type RebuildRun } from "../../shared/website-rebuild-types";
import type { WorkerJob } from "../../shared/worker-types";
import { agentOSRoot, readOptionalFile } from "../agentos/filesystem";
import { patchProject } from "../agentos/mutations/projects";
import { HermesError, sendToHermes } from "../hermes/client";
import { writeCase } from "../outreach/cases";
import { buildBrandBrief, repoBrandFiles } from "./brand";
import { ClientRepoUnavailable, commitFiles, ensureClientRepo, git, readRepoFile, repoFolderName } from "./client-repo";
import { DEPLOY_POLL_MS, PREVIEW_BRANCH, PRODUCTION_BRANCH, nextPreviewDeployStep, pickCommitDeployment, vercelBuildFailureMessage } from "./deploy-policy";
import {
  deploymentBelongsToProject,
  ensurePrivateRepo,
  ensureVercelProject,
  listCommitDeployments,
  openPreviewsToLinkHolders,
  pinGithubDefaultBranch,
  PublishError,
  pushRef,
  readDeployment,
  readDeploymentByRef,
  requestForcedPreviewDeployment,
  requestPreviewDeployment,
  setPreviewEnvironment,
  type GithubRepo,
  type VercelDeploymentState,
  type VercelProject,
} from "./publish";
import { checkPreview, qaTable, type QaResult } from "./qa";
import {
  FIVE_KEY_AREAS,
  FUNCTIONALITY_REPORT,
  GO_LIVE_FILE,
  HERMES_ANALYSIS,
  NEXT_VALIDATION,
  buildBrief,
  critiqueBrief,
  critiqueFile,
  functionalityFile,
  functionsBrief,
  heroRevisionBrief,
  parseDesignScore,
  conceptBrief,
  strategyBrief,
  auditFile,
  STRATEGY_FILE,
  INVENTORY_FILE,
  type ApprovedConcept,
  type DesignBriefInput,
  type RenderedShots,
  hermesAnalysisPrompt,
  researchBrief,
  researchFile,
  reviewBrief,
  reviewFile,
} from "./prompts";
import { REPORT_DIR, reportFile, wrapReport } from "./reports";
import { describeVerdict, mustFixFindings, parseReviewVerdict, tallyFeatures } from "./review-verdict";
import { briefSettings, journeyInput, previewEnvironment } from "./feature-settings";
import { routeList, routeName, routesFrom, screenshot, serveBuiltNextApp } from "./screens";
import { libraryContextFor } from "../reengineer/library";
import { StageBlocked, type StageContext, type StageHandler, type StageOutcome } from "./stage-kit";
import type { ReviewVerdict } from "../../shared/website-rebuild-types";
import { addArtSpent, openChangeRequest, readRun, setRunField } from "./store";
import { headCommit, tagRevision } from "./client-repo";
import { ART_LEDGER_FILE, ART_MODEL, ART_PLAN_FILE, generateArt, parseArtPlan, type ArtPlan, type ArtResult } from "./art";
import { fontKit, motionKit } from "./concept-kit";
import { auditReport, judgeConcepts, measureConcepts, type ConceptAudit } from "./hero-audit";
import { auditInteractions, parseInventory } from "./interaction-audit";
import { captureReferences, referencesDir } from "./references";
import { estimateCost } from "../designs/higgsfield";
import { render as renderImage } from "../designs/renderer";
import { COMPOSITION_BY_ID, MOTION_BY_ID, NAV_BY_ID } from "./compositions";
import { DIRECTION_BY_ID, RUBRIC_MAX, RUBRIC_PASS, detectNiche, type DesignDirection } from "./design-directions";
import {
  ensureAssignments,
  gateConcepts,
  parseCritique,
  parseFingerprint,
  priorFingerprints,
  recordCritique,
  recordMade,
  recordMeasured,
  runFingerprints,
  type ConceptCritique,
  type ConceptId,
  type DesignFingerprint,
  type DirectionAssignment,
  type GateResult,
} from "./design-fingerprints";
import { integrateJob, pickWorker, runJob, WorkerStageBlocked, type PickedWorker } from "./workers";

/** What the library may tell each build stage. A stage reads only the kinds that bear on it. */
const HERO_KINDS = ["layout", "style", "motion", "component"] as const;
const BUILD_KINDS = ["component", "layout", "pattern", "style", "motion"] as const;
const FUNCTION_KINDS = ["function", "pattern", "component"] as const;

const withPatterns = (brief: string, patterns: string) => (patterns ? `${brief}\n\n${patterns}` : brief);

/**
 * Stages 3 to 6: research, hero concepts, copy and structure, functions.
 *
 * Each stage hands its work to the first available worker on its list, then
 * AgentOS checks the result itself (files exist, build, lint, tests), commits
 * it into the client repo as `rebuild/<stage>-r<n>`, photographs it, and
 * files the reports in the workspace. Gated stages then wait for a person.
 */

export interface StageDeps {
  ensureRepo: (slug: string, company: string, recorded?: string) => Promise<string>;
  commitFiles: typeof commitFiles;
  readRepoFile: typeof readRepoFile;
  readVaultFile: (relativePath: string) => Promise<string | undefined>;
  /** A binary file in the vault (a brand image), or undefined if it is gone. */
  readVaultBinary: (relativePath: string) => Promise<Buffer | undefined>;
  runJob: typeof runJob;
  pickWorker: typeof pickWorker;
  integrate: typeof integrateJob;
  hermes: (prompt: string, onReply: (meta: { id?: string; model?: string }) => void) => Promise<string>;
  screenshot: typeof screenshot;
  serveNext: typeof serveBuiltNextApp;
  fontKit: typeof fontKit;
  motionKit: typeof motionKit;
  captureReferences: typeof captureReferences;
  /** Opens the heroes in a browser and says what is wrong with them. */
  auditConcepts: (repo: string, assignments: readonly DirectionAssignment[], prior: readonly DesignFingerprint[]) => Promise<ConceptAudit[]>;
  /** Generates the concept imagery within the credits left. */
  renderArt: (plan: ArtPlan, credits: number) => Promise<ArtResult>;
  /** Presses every control on the local demo build. */
  auditInteractions: typeof auditInteractions;
  readDesignTemplate: (template: string) => Promise<string | undefined>;
  today: () => string;
  scratchDir: (name: string) => Promise<string>;
  publish: typeof publishCalls;
  checkPreview: typeof checkPreview;
  /** Puts the preview link on the lead's outreach case, the field the email draft uses. */
  savePreviewLink: (prospectId: string, url: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Minutes to wait for Vercel before blocking. */
  deployTimeoutMs: number;
  /** Records the client repo as the workspace's repository, unless the workspace already names one. */
  linkWorkspaceRepo: (slug: string, repo: string) => Promise<boolean>;
}

const publishCalls = {
  setPreviewEnvironment,
  ensurePrivateRepo,
  pinGithubDefaultBranch,
  pushRef,
  ensureVercelProject,
  openPreviewsToLinkHolders,
  listCommitDeployments,
  requestPreviewDeployment,
  requestForcedPreviewDeployment,
  readDeployment,
  readDeploymentByRef,
};

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const defaultStageDeps: StageDeps = {
  ensureRepo: ensureClientRepo,
  commitFiles,
  readRepoFile,
  readVaultFile: (relativePath) => readOptionalFile(relativePath),
  readVaultBinary: async (relativePath) => {
    const root = path.resolve(agentOSRoot());
    const file = path.resolve(root, relativePath);
    if (!file.startsWith(`${root}${path.sep}`)) return undefined;
    return fs.readFile(file).catch(() => undefined);
  },
  runJob,
  pickWorker,
  integrate: integrateJob,
  hermes: (prompt, onReply) =>
    sendToHermes(prompt, {
      operation: "other",
      timeoutMs: 180_000,
      system: "You are a senior conversion-focused web strategist reviewing a small business website before a rebuild. Be specific and evidence-led.",
      onReply,
    }),
  screenshot,
  serveNext: serveBuiltNextApp,
  fontKit,
  motionKit,
  captureReferences,
  auditConcepts: async (repo, assignments, prior) => judgeConcepts(await measureConcepts(repo, assignments.map((entry) => entry.concept)), assignments, prior),
  renderArt: (plan, credits) =>
    generateArt(plan, credits, {
      price: async (prompt) => {
        const estimate = await estimateCost({ model: ART_MODEL, prompt });
        return estimate.unavailable || estimate.perJob <= 0 ? undefined : estimate.perJob;
      },
      generate: async (prompt, aspect) => {
        const { urls } = await renderImage({ prompt, aspectRatio: aspect, model: ART_MODEL });
        if (!urls[0]) throw new Error("Higgsfield returned no image.");
        const response = await fetch(urls[0], { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`The image could not be downloaded (${response.status}).`);
        return Buffer.from(await response.arrayBuffer());
      },
    }),
  auditInteractions,
  /** An absolute path, a vault path, or a path in the AgentOS app itself (its own DESIGN.md). */
  readDesignTemplate: async (template) => {
    const candidates = path.isAbsolute(template) ? [template] : [path.join(agentOSRoot(), template), path.join(APP_ROOT, template)];
    for (const candidate of candidates) {
      try {
        return await fs.readFile(candidate, "utf8");
      } catch {
        // Try the next place.
      }
    }
    return undefined;
  },
  today: () => new Date().toISOString().slice(0, 10),
  scratchDir: (name) => fs.mkdtemp(path.join(os.tmpdir(), `agentos-rebuild-${name}-`)),
  publish: publishCalls,
  checkPreview,
  savePreviewLink: async (prospectId, url) => {
    await writeCase(prospectId, { previewUrl: url }, "agent");
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  deployTimeoutMs: 20 * 60 * 1000,
  linkWorkspaceRepo: async (slug, repo) => {
    const project = await readOptionalFile(`${PROJECTS_DIR}/${slug}/PROJECT.md`);
    if (!project) return false;
    const current = /Local repo(?:sitory)?\s*:\s*(.+)$/im.exec(project)?.[1]?.trim();
    // A path the person set is theirs; only an empty one is filled in.
    if (current && !/^_?not set_?$/i.test(current)) return false;
    await patchProject({ slug, repoPath: repo });
    return true;
  },
};

/** Tests swap these out; the app uses the defaults. */
export const stageDeps: { current: StageDeps } = { current: defaultStageDeps };

const PROJECTS_DIR = "projects";

function workspaceDoc(run: RebuildRun, name: string): string {
  return `${PROJECTS_DIR}/${run.workspaceSlug}/${REPORT_DIR}/${reportFile(run, name)}`;
}

/** The client repo, created on the SSD if needed; a missing drive is a blocker, not a crash. */
async function repoFor(context: StageContext, deps: StageDeps): Promise<string> {
  if (!context.run.workspaceSlug) throw new StageBlocked("The run has no workspace yet.");
  try {
    const repo = await deps.ensureRepo(context.run.workspaceSlug, context.run.company, context.run.repoPath);
    if (repo !== context.run.repoPath) setRunField(context.run.id, "repo_path", repo);
    // Checked every time, so a rebuild whose repo predates this still gets linked. Never overwrites a path the person set.
    if (await deps.linkWorkspaceRepo(context.run.workspaceSlug, repo).catch(() => false)) context.log(`Linked ${repo} as the workspace's repository, so Settings and the Repository tab show it.`);
    return repo;
  } catch (error) {
    if (error instanceof ClientRepoUnavailable) throw new StageBlocked(error.message);
    throw error;
  }
}

/** Runs the stage's worker job with progress and resume wired to the stage. Worker blockers become stage blockers. */
async function work(
  context: StageContext,
  deps: StageDeps,
  candidates: RebuildRun["workerPlan"]["research"],
  buildRequest: Parameters<typeof runJob>[0],
): Promise<{ job: WorkerJob; worker: PickedWorker }> {
  // A worker the person picked on the stage wins over the plan's order.
  const workers = context.record.workerOverride ? [context.record.workerOverride] : candidates;
  try {
    return await deps.runJob(buildRequest, workers, context.record.jobId, {
      chosen: Boolean(context.record.workerOverride),
      onProgress: context.activity,
      onStarted: (jobId) => {
        context.rememberJob(jobId);
        context.log(`Worker job ${jobId} started.`);
      },
    });
  } catch (error) {
    if (error instanceof WorkerStageBlocked) throw new StageBlocked(error.message);
    throw error;
  }
}

async function integrate(context: StageContext, deps: StageDeps, job: WorkerJob, repo: string, what: string): Promise<string> {
  const tag = `rebuild/${context.stage}-r${context.revision}`;
  try {
    const commit = await deps.integrate(job, repo, `${context.run.company}: ${what} (revision ${context.revision})`, tag);
    context.log(`Revision ${context.revision} committed to the client repo as ${tag} (${commit.slice(0, 7)}).`);
    return commit;
  } catch (error) {
    if (error instanceof WorkerStageBlocked) throw new StageBlocked(error.message);
    throw error;
  }
}

/** The capture reports, copied into the repo so a worker can read them. */
async function seedCurrentSite(context: StageContext, deps: StageDeps, repo: string): Promise<{ transcript: string; structure: string }> {
  const transcript = await deps.readVaultFile(workspaceDoc(context.run, "website_transcript"));
  const structure = await deps.readVaultFile(workspaceDoc(context.run, "current_structure"));
  if (!transcript || !structure) throw new StageBlocked("The website capture reports are missing from the workspace. Retry the website capture stage first.");
  await deps.commitFiles(repo, { "docs/current-site/website_transcript.md": transcript, "docs/current-site/current_structure.md": structure }, "Add the captured current site");
  return { transcript, structure };
}

/**
 * The brand kit, as `brand/` in the client repo: the included images and
 * `brand/BRAND.md`. The folder is rewritten each time, so an asset a person
 * left out since the last stage is removed, not left behind for a worker.
 */
async function seedBrandKit(context: StageContext, deps: StageDeps, repo: string): Promise<void> {
  const kit = readRun(context.run.id).brandKit;
  if (!kit) {
    context.log("There is no brand kit for this run, so the concepts will not use the client's logo or photos.", "warning");
    return;
  }
  const missing: string[] = [];
  for (const asset of kit.assets.filter((entry) => entry.include)) if (!(await deps.readVaultBinary(asset.path))) missing.push(asset.id);
  const present = { ...kit, assets: kit.assets.filter((asset) => !missing.includes(asset.id)) };
  const files: Record<string, string | Buffer> = {};
  for (const { asset, file } of repoBrandFiles(present)) files[file] = (await deps.readVaultBinary(asset.path)) as Buffer;
  files["brand/BRAND.md"] = buildBrandBrief(context.run, present);
  await deps.commitFiles(repo, files, "Add the client's brand kit", { replace: "brand" });
  if (missing.length > 0) context.log(`${missing.length} brand image${missing.length === 1 ? " is" : "s are"} no longer in the workspace and ${missing.length === 1 ? "was" : "were"} left out: ${missing.join(", ")}.`, "warning");
}

interface SecondOpinion {
  /** The review report's artifact id. */
  id: string;
  verdict: ReviewVerdict;
  /** One sentence for the stage summary. */
  said: string;
}

/**
 * The Blocker and Major findings of the last revision's review, which the next
 * revision must answer. Without this a worker sees only the person's note, and
 * fixes that while the reviewer's findings stay as they were.
 */
async function lastReviewFindings(context: StageContext, deps: StageDeps, repo: string): Promise<string | undefined> {
  if (context.revision < 2) return undefined;
  const review = await deps.readRepoFile(repo, reviewFile(context.stage, context.revision - 1));
  const findings = review ? mustFixFindings(review) : undefined;
  if (findings) context.log(`The findings of the revision ${context.revision - 1} review are in this revision's brief.`);
  return findings;
}

/** A second model reads the work. Optional: if no reviewer is free, or it fails, the person still reviews. */
async function secondOpinion(context: StageContext, deps: StageDeps, repo: string, direction?: DesignDirection): Promise<SecondOpinion | undefined> {
  const candidates = context.run.workerPlan.review;
  if (candidates.length === 0) return undefined;
  let reviewer: PickedWorker;
  try {
    reviewer = await deps.pickWorker(candidates);
  } catch {
    context.log("No reviewer was available, so there is no second opinion on this revision.", "warning");
    return undefined;
  }
  const file = reviewFile(context.stage, context.revision);
  const tag = `rebuild/${context.stage}-r${context.revision}`;
  try {
    context.activity(`${reviewer.name} is reviewing revision ${context.revision}`);
    const { job } = await deps.runJob(
      () => ({ project: context.run.workspaceSlug ?? "", objective: reviewBrief(context.run, context.stage, context.revision, tag, direction), repoPath: repo, modelRouteType: "plan", validationCommands: [`test -s ${file}`] }),
      [reviewer.id],
      undefined,
      { onProgress: context.activity, onStarted: (jobId) => context.log(`Review job ${jobId} started with ${reviewer.name}.`) },
    );
    await deps.integrate(job, repo, `Review of ${context.stage} revision ${context.revision}`, `rebuild/${context.stage}-r${context.revision}-review`);
    const review = await deps.readRepoFile(repo, file);
    if (!review) return undefined;
    const id = await context.writeReport(`${context.stage}_r${context.revision}_review`, `${reviewer.name} review of ${context.stage} r${context.revision}`, wrapReport(context.run, `review of ${context.stage} revision ${context.revision}`, review, { reviewer: reviewer.name, job: job.id }));
    const verdict = parseReviewVerdict(review);
    const designScore = context.stage === "build" ? parseDesignScore(review) : undefined;
    const design = designScore === undefined ? "" : ` Design score ${designScore}/${RUBRIC_MAX}${designScore < RUBRIC_PASS ? `, below the bar of ${RUBRIC_PASS}: its slop findings are in the review and go to the next revision` : ""}.`;
    return { id, verdict, said: `${describeVerdict(verdict, reviewer.name)}${design}` };
  } catch (error) {
    context.log(`The second-opinion review did not finish: ${error instanceof Error ? error.message : "unknown error"}. You can still review this revision yourself.`, "warning");
    return undefined;
  }
}

/** Photographs a built Next.js app from the job's checkout, before its code moves into the repo. */
async function photographSite(
  context: StageContext,
  deps: StageDeps,
  job: WorkerJob,
  options: { fullPage?: boolean; limit?: number; whileServing?: (url: string, routes: readonly string[]) => Promise<void> } = {},
): Promise<string[]> {
  if (!job.worktreePath) return [];
  const sitemap = await deps.readRepoFile(job.worktreePath, "sitemap.json");
  const { routes, dropped } = routeList(sitemap, options.limit);
  if (dropped > 0) context.log(`The sitemap lists ${routes.length + dropped} pages; the first ${routes.length} were photographed and ${dropped} were left out.`, "warning");
  context.activity(`Photographing ${routes.length} page${routes.length === 1 ? "" : "s"} at desktop and phone widths`);
  let server: { url: string; stop: () => void } | undefined;
  try {
    server = await deps.serveNext(job.worktreePath);
    if (options.whileServing) {
      const url = server.url;
      await options.whileServing(url, routes).catch((error: unknown) => context.log(`The visitor journeys could not be checked: ${error instanceof Error ? error.message : "unknown error"}.`, "warning"));
    }
    const shots = await deps.screenshot(routes.map((route) => ({ name: routeName(route), target: `${server?.url}${route}` })), await deps.scratchDir(context.stage), { fullPage: options.fullPage });
    const cropped = [...new Set(shots.filter((shot) => shot.cropped).map((shot) => shot.name))];
    if (cropped.length > 0) context.log(`${cropped.join(", ")} ${cropped.length === 1 ? "is" : "are"} taller than one image can hold, so the bottom of ${cropped.length === 1 ? "that page is" : "those pages are"} cut off in the snapshot.`, "warning");
    const ids: string[] = [];
    // The title names the route itself ("/services (desktop)"), so notes written on a snapshot belong to a real page.
    const routeOf = new Map(routes.map((route) => [routeName(route), route]));
    for (const shot of shots) ids.push(await context.writeImage(`${shot.name}-${shot.viewport}`, `${routeOf.get(shot.name) ?? shot.name} (${shot.viewport})`, shot.file));
    return ids;
  } catch (error) {
    // The build passed; a failed photo is worth saying, not worth blocking the review over.
    context.log(`Screenshots could not be taken: ${error instanceof Error ? error.message : "unknown error"}. Open the repo to look at the site.`, "warning");
    return [];
  } finally {
    server?.stop();
  }
}

// ------------------------------------------------------------------ stage 3

export const researchStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const { run } = context;
  const repo = await repoFor(context, deps);
  const site = await seedCurrentSite(context, deps, repo);
  const artifactIds: string[] = [];
  const reportPath = workspaceDoc(run, FIVE_KEY_AREAS);

  // A retry after Hermes failed keeps the research already done in this attempt.
  const research = context.run.artifacts.find((artifact) => artifact.path === reportPath && artifact.revision === context.revision);
  let researchWorker: PickedWorker | undefined;
  let researchJob: WorkerJob | undefined;
  if (!research) {
    const { job, worker } = await work(context, deps, run.workerPlan.research, (picked) =>
      picked.id === "grok-bot"
        ? // A file-bridge worker has no checkout: it gets the site in the brief and answers with the report.
          { project: run.workspaceSlug ?? "", objective: researchBrief(run, deps.today(), `${site.structure}\n\n${site.transcript}`.slice(0, 24_000)), modelRouteType: "plan" }
        : { project: run.workspaceSlug ?? "", objective: researchBrief(run, deps.today()), repoPath: repo, modelRouteType: "plan", validationCommands: [`test -s ${researchFile(run)}`] },
    );
    researchWorker = worker;
    researchJob = job;
    let body: string | undefined;
    if (job.worktreePath) {
      await integrate(context, deps, job, repo, "competitor research");
      body = await deps.readRepoFile(repo, researchFile(run));
    } else {
      body = job.result?.summary;
      if (body) await deps.commitFiles(repo, { [researchFile(run)]: body }, `Add ${worker.name}'s competitor research`);
    }
    if (!body?.trim()) throw new StageBlocked(`${worker.name} finished without writing the research report. Retry to run it again.`);
    const id = await context.writeReport(FIVE_KEY_AREAS, "Five key areas of improvement", wrapReport(run, "five key areas of improvement", body, { worker: worker.name, job: job.id }));
    artifactIds.push(id);
    context.rememberJob(null);
  } else {
    artifactIds.push(research.id);
    context.log("Keeping the research already written in this attempt.");
  }

  // No site was captured: there is nothing for Hermes to analyse, and that is recorded rather than faked.
  if (run.siteNote) {
    const note = `## Not run\n\nThere is no current website to analyse. ${run.siteNote}\n\nThe rebuild works from the competitor research and the details given when it started.\n`;
    artifactIds.push(await context.writeReport(HERMES_ANALYSIS, "Hermes analysis", wrapReport(run, "Hermes analysis", note, { skipped: "true" })));
    return {
      summary: `Competitor research${researchWorker ? ` by ${researchWorker.name}` : ""} is in the workspace. No Hermes analysis: there is no current site.`,
      artifactIds,
      worker: researchWorker?.name,
      jobId: researchJob?.id,
    };
  }

  // Hermes is required: a missing analysis is a blocker, never a generic stand-in.
  context.activity("Hermes is analysing the current website");
  let meta: { id?: string; model?: string } = {};
  let analysis: string;
  try {
    analysis = await deps.hermes(hermesAnalysisPrompt(run, site.transcript.slice(0, 40_000), site.structure.slice(0, 12_000)), (reply) => {
      meta = reply;
    });
  } catch (error) {
    const reason = error instanceof HermesError ? error.message : error instanceof Error ? error.message : "Hermes could not be reached.";
    throw new StageBlocked(`Hermes could not analyse the site: ${reason} The competitor research is saved; retry runs only the Hermes analysis.`);
  }
  const header = [
    "## Run",
    "",
    `- Hermes reference: ${meta.id ?? "not returned by Hermes"}`,
    `- Model: ${meta.model ?? "not returned by Hermes"}`,
    `- Configuration: chat completion, operation "other", 180 s timeout, prompt from ${run.skillId}@${run.skillVersion}`,
    `- Input: the website transcript and current structure reports from ${run.websiteUrl}`,
    "",
  ].join("\n");
  artifactIds.push(await context.writeReport(HERMES_ANALYSIS, "Hermes analysis", wrapReport(run, "Hermes analysis", `${header}\n${analysis}`, { hermesReference: meta.id ?? "", hermesModel: meta.model ?? "" })));
  await deps.commitFiles(repo, { [`research/${run.companySlug}_${HERMES_ANALYSIS}.md`]: analysis }, "Add the Hermes analysis");

  return {
    summary: `Competitor research${researchWorker ? ` by ${researchWorker.name}` : ""} and the Hermes analysis${meta.id ? ` (${meta.id})` : ""} are in the workspace.`,
    artifactIds,
    worker: researchWorker?.name,
    jobId: researchJob?.id,
  };
};

// ------------------------------------------------------------------ stage 4

/** The design inputs for this run: its niche, the directions assigned to its concepts, and what earlier runs in the niche used. */
function designInput(run: RebuildRun): DesignBriefInput {
  const niche = detectNiche(run);
  const assignments = ensureAssignments(run, niche);
  return { niche, assignments, prior: priorFingerprints(run.id, niche.id, run.targetMarket) };
}

/** Reads each concept's DESIGN.md fingerprint block into the store. */
async function recordConcepts(context: StageContext, deps: StageDeps, repo: string): Promise<void> {
  for (const concept of HERO_CONCEPTS) {
    const design = await deps.readRepoFile(repo, `design/${concept}/DESIGN.md`);
    if (design) recordMade(context.run.id, concept, parseFingerprint(design));
  }
}

/** What a design job needs beyond the usual: the skill's craft notes, thought, and folders it may read but not change. */
interface DesignJobExtras {
  skillId?: string;
  effort?: "high";
  claudeReadOnlyRoots?: string[];
}

/**
 * A side job in the stage (the critique, the automatic revision): its own
 * worker job, integrated under its own tag. Unlike the stage's main job it is
 * not resumed on retry.
 */
async function sideJob(context: StageContext, deps: StageDeps, repo: string, candidates: RebuildRun["workerPlan"]["hero"], objective: string, routeType: "plan" | "execute", validation: string[], tag: string, message: string, extra: DesignJobExtras = {}): Promise<{ job: WorkerJob; worker: PickedWorker; commit: string }> {
  const result = await deps.runJob(
    () => ({ project: context.run.workspaceSlug ?? "", objective, repoPath: repo, modelRouteType: routeType, validationCommands: validation, ...extra }),
    candidates,
    undefined,
    { onProgress: context.activity, onStarted: (jobId) => context.log(`${message}: job ${jobId} started.`) },
  );
  const commit = await deps.integrate(result.job, repo, `${context.run.company}: ${message} (revision ${context.revision})`, tag);
  return { ...result, commit };
}

/** The critique pass: a second model scores the three concepts against the rubric. Undefined when none could run. */
async function critique(context: StageContext, deps: StageDeps, repo: string, design: DesignBriefInput, pass: 1 | 2, rendered: Rendered): Promise<{ critiques: ConceptCritique[]; reportId: string } | undefined> {
  const { run } = context;
  const candidates = [...new Set([...run.workerPlan.review, ...run.workerPlan.hero])];
  const file = critiqueFile(context.revision, pass);
  try {
    context.activity(pass === 1 ? "Critiquing the three concepts against the design rubric" : "Critiquing the revised concepts");
    const { worker } = await sideJob(context, deps, repo, candidates, critiqueBrief(run, design, file, rendered.shots, auditFile(context.revision, pass)), "plan", [`test -s ${file}`], `rebuild/hero-r${context.revision}-critique${pass === 2 ? "-2" : ""}`, pass === 1 ? "Design critique" : "Design critique of the revision", { claudeReadOnlyRoots: [rendered.dir] });
    const text = await deps.readRepoFile(repo, file);
    if (!text) return undefined;
    const reportId = await context.writeReport(`hero_r${context.revision}_critique${pass === 2 ? "_2" : ""}`, `Design critique of hero r${context.revision}${pass === 2 ? " after revision" : ""}`, wrapReport(run, `design critique of hero revision ${context.revision}`, text, { critic: worker.name }));
    return { critiques: parseCritique(text), reportId };
  } catch (error) {
    context.log(`The design critique did not finish: ${error instanceof Error ? error.message : "unknown error"}. The concepts go to you unscored.`, "warning");
    return undefined;
  }
}

/** What the gate did, in one line per concept for the stage summary. */
function gateSummary(results: readonly GateResult[], design: DesignBriefInput, revised: ReadonlySet<string>): string {
  return results
    .map((result) => {
      const assignment = design.assignments.find((entry) => entry.concept === result.concept);
      const name = `${result.concept.replace("concept-", "").toUpperCase()} ${[assignment?.direction.name, assignment?.composition.name].filter(Boolean).join(", ")}`.trim();
      const score = result.score === undefined ? "unscored" : `${result.score}/${RUBRIC_MAX}`;
      const note = result.action === "escalate" ? `, needs your call${revised.has(result.concept) ? " after one automatic revision" : ""}${result.reason ? ` (${result.reason})` : ""}` : revised.has(result.concept) ? ", passed after one automatic revision" : "";
      return `${name} ${score}${note}`;
    })
    .join("; ");
}

/** The concepts as they render right now: screenshots for the critic and the audit's findings. */
interface Rendered {
  dir: string;
  shots: RenderedShots;
  rawShots: Awaited<ReturnType<StageDeps["screenshot"]>>;
  audits: ConceptAudit[];
  reportId: string;
}

/** Photographs the heroes and audits them in a browser. The audit is committed, so a critic and a later reader see the same facts. */
async function renderConcepts(context: StageContext, deps: StageDeps, repo: string, design: DesignBriefInput, pass: 1 | 2): Promise<Rendered> {
  context.activity(pass === 1 ? "Opening the concepts in a browser and measuring them" : "Measuring the revised concepts");
  const dir = await deps.scratchDir("hero");
  let rawShots: Rendered["rawShots"];
  try {
    rawShots = await deps.screenshot(HERO_CONCEPTS.map((concept) => ({ name: concept, target: path.join(repo, "design", concept, "hero.html") })), dir);
  } catch (error) {
    throw new StageBlocked(`The concepts were made but could not be photographed: ${error instanceof Error ? error.message : "unknown error"}. Retry once Playwright works.`);
  }
  const audits = await deps.auditConcepts(repo, design.assignments, design.prior);
  const report = auditReport(audits);
  await deps.commitFiles(repo, { [auditFile(context.revision, pass)]: report }, `${context.run.company}: rendered audit (revision ${context.revision})`);
  for (const audit of audits) recordMeasured(context.run.id, audit.concept, audit);
  const reportId = await context.writeReport(`hero_r${context.revision}_audit${pass === 2 ? "_2" : ""}`, `Rendered audit of hero r${context.revision}${pass === 2 ? " after revision" : ""}`, wrapReport(context.run, `rendered audit of hero revision ${context.revision}`, report));
  return { dir, rawShots, shots: { files: rawShots.map((shot) => ({ concept: shot.name, viewport: shot.viewport, file: shot.file })) }, audits, reportId };
}

/** Worker blockers in the stage's own jobs become stage blockers, with their reason. */
async function designJob<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof WorkerStageBlocked) throw new StageBlocked(error.message);
    throw error;
  }
}

/**
 * Who works on each concept. Taking turns between the plan's first two workers
 * means two different models' taste, which does more for variety than any brief.
 * A worker the person chose does all of them.
 */
function conceptWorkers(context: StageContext, plan: RebuildRun["workerPlan"]["hero"], index: number): RebuildRun["workerPlan"]["hero"] {
  if (context.record.workerOverride) return [context.record.workerOverride];
  if (index % 2 === 0 || plan.length < 2) return plan;
  return [plan[1], plan[0], ...plan.slice(2)];
}

const DESIGN_SKILL = "website-design-direction";
/** A job reads the skill's reference files from here, without being able to change them. */
const skillFolder = path.join(APP_ROOT, "skills", DESIGN_SKILL);

/** A marker AgentOS commits once a step of this revision is done, so a retry does not repeat or re-bill it. */
const marker = (name: string) => `design/.done/${name}`;

/** Fonts and motion libraries for these concepts, in the client repo, before a worker needs them. */
async function seedConceptKit(context: StageContext, deps: StageDeps, repo: string, design: DesignBriefInput, targets: readonly ConceptId[]): Promise<Partial<Record<ConceptId, string[]>>> {
  context.activity("Fetching the assigned fonts and motion libraries");
  const files: Record<string, string | Buffer> = { ...(await deps.motionKit()) };
  const missing: Partial<Record<ConceptId, string[]>> = {};
  for (const assignment of design.assignments.filter((entry) => targets.includes(entry.concept))) {
    const kit = await deps.fontKit([assignment.pair.display, assignment.pair.text]);
    Object.assign(files, kit.files);
    files[`design/${assignment.concept}/fonts.css`] = kit.css;
    missing[assignment.concept] = kit.missing;
    if (kit.missing.length > 0) context.log(`${assignment.concept}: ${kit.missing.join(", ")} could not be fetched from Fontsource.`, "warning");
  }
  await deps.commitFiles(repo, files, `${context.run.company}: concept fonts and motion libraries`);
  return missing;
}

/** The strategy job, then any imagery it asked for, each done once per generation of concepts. */
async function writeStrategy(context: StageContext, deps: StageDeps, repo: string, design: DesignBriefInput, generation: number, extras: DesignJobExtras): Promise<void> {
  const { run } = context;
  const done = marker(`strategy-g${generation}`);
  const credits = Math.max(0, readRun(run.id).artBudget - readRun(run.id).artSpent);
  if (!(await deps.readRepoFile(repo, done))) {
    context.activity("Writing the creative strategy");
    await designJob(() => sideJob(context, deps, repo, context.record.workerOverride ? [context.record.workerOverride] : run.workerPlan.hero, strategyBrief(run, design, credits, context.changeRequest), "execute", [`test -s ${STRATEGY_FILE}`], `rebuild/hero-r${context.revision}-strategy`, "Creative strategy", extras));
    await deps.commitFiles(repo, { [done]: `${context.revision}\n` }, `${run.company}: strategy done`);
  }
  const artDone = marker(`art-g${generation}`);
  if (credits <= 0 || (await deps.readRepoFile(repo, artDone))) return;
  const plan = parseArtPlan(await deps.readRepoFile(repo, ART_PLAN_FILE));
  if (!plan) {
    context.log(`The strategy did not leave a usable ${ART_PLAN_FILE}, so no imagery was generated.`, "warning");
    return;
  }
  context.activity(`Generating concept imagery, up to ${credits} credits`);
  const art = await deps.renderArt(plan, credits);
  addArtSpent(run.id, art.spent);
  for (const note of art.notes) context.log(`Imagery: ${note}`, "warning");
  await deps.commitFiles(repo, { ...art.files, [ART_LEDGER_FILE]: art.ledger, [artDone]: `${art.spent}\n` }, `${run.company}: concept imagery (${art.spent} credits)`);
  context.log(`Generated ${Object.keys(art.files).length} images for ${art.spent} credits, within a budget of ${credits}.`);
}

/** Generated images already in this concept's folder, relative to the repo. */
async function conceptArt(repo: string, concept: ConceptId): Promise<string[]> {
  const names = await fs.readdir(path.join(repo, "design", concept, "art")).catch(() => [] as string[]);
  return names.filter((name) => !name.startsWith(".") && /\.(png|jpe?g|webp)$/i.test(name)).map((name) => `design/${concept}/art/${name}`);
}

export const heroStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const { run } = context;
  const repo = await repoFor(context, deps);
  const template = await deps.readDesignTemplate(run.designTemplate);
  if (!template) throw new StageBlocked(`The design template ${run.designTemplate} could not be found in the vault or in AgentOS. Fix the path and retry.`);
  await deps.commitFiles(repo, { "design/TEMPLATE.md": template }, "Add the design system template");
  await seedBrandKit(context, deps, repo);

  const design = designInput(run);
  const generation = runFingerprints(run.id)[0]?.generation ?? 1;
  context.log(`Concepts for the ${design.niche.label.toLowerCase()} niche: ${design.assignments.map((entry) => `${entry.concept} ${entry.direction.name} + ${entry.composition.name}${entry.wildcard ? " (wildcard)" : ""}`).join(", ")}. ${design.prior.length} earlier concept${design.prior.length === 1 ? "" : "s"} in this niche or market excluded.`);

  // A note on one concept redoes that concept. Anything else redoes all three.
  const request = openChangeRequest(run.id, "hero");
  const noted = HERO_CONCEPTS.filter((concept) => request?.conceptNotes?.[concept]?.trim());
  const targets: readonly ConceptId[] = request && !request.note?.trim() && noted.length > 0 ? noted : HERO_CONCEPTS;

  const missingFonts = await seedConceptKit(context, deps, repo, design, targets);
  const skill = { skillId: DESIGN_SKILL, effort: "high" as const, claudeReadOnlyRoots: [skillFolder] };
  const patterns = await libraryContextFor(HERO_KINDS);
  await writeStrategy(context, deps, repo, design, generation, skill);

  context.activity("Photographing current references for each composition");
  const wanted = design.assignments.filter((entry) => targets.includes(entry.concept)).flatMap((entry) => entry.composition.references);
  const references = await deps.captureReferences(wanted, (message) => context.log(message, "warning")).catch((error: unknown) => {
    context.log(`References could not be photographed: ${error instanceof Error ? error.message : "unknown error"}. The concepts go ahead without them.`, "warning");
    return [];
  });

  // One worker per concept, working alone: a single job writing all three gave all three its one skeleton.
  let workerName = "";
  for (const [index, assignment] of design.assignments.entries()) {
    const { concept } = assignment;
    if (!targets.includes(concept)) continue;
    const done = marker(`${concept}-r${context.revision}`);
    if (await deps.readRepoFile(repo, done)) continue;
    const note = request?.conceptNotes?.[concept] ? [request.note, request.conceptNotes[concept]].filter(Boolean).join("\n\n") : context.changeRequest;
    const kit = { art: await conceptArt(repo, concept), missingFonts: missingFonts[concept] ?? [], references: references.filter((entry) => assignment.composition.references.some((target) => target.url === entry.url)).slice(0, 3) };
    const { worker } = await designJob(() =>
      sideJob(context, deps, repo, conceptWorkers(context, run.workerPlan.hero, index), withPatterns(conceptBrief(run, assignment, design, kit, note), patterns), "execute", [`test -s design/${concept}/DESIGN.md && test -s design/${concept}/hero.html`], `rebuild/hero-r${context.revision}-${concept}`, `${concept} hero`, { ...skill, claudeReadOnlyRoots: [skillFolder, referencesDir()] }),
    );
    workerName = workerName && workerName !== worker.name ? `${workerName} and ${worker.name}` : worker.name;
    await deps.commitFiles(repo, { [done]: `${worker.name}\n` }, `${run.company}: ${concept} done`);
  }
  await recordConcepts(context, deps, repo);

  // The gate: measure in a browser, critique what it looks like, one automatic revision of what fails, then the person decides.
  const artifactIds: string[] = [];
  const revised = new Set<string>();
  let results: GateResult[] | undefined;
  let rendered = await renderConcepts(context, deps, repo, design, 1);
  artifactIds.push(rendered.reportId);
  const first = await critique(context, deps, repo, design, 1, rendered);
  if (first) artifactIds.push(first.reportId);
  if (first || rendered.audits.some((audit) => audit.failures.length > 0)) {
    results = gateConcepts({ critiques: first?.critiques ?? [], made: runFingerprints(run.id), prior: design.prior, attempt: 0, audits: rendered.audits });
    const failing = results.filter((result) => result.action === "revise");
    if (failing.length > 0) {
      context.log(`Sent back for one automatic revision: ${failing.map((result) => `${result.concept} (${result.reason})`).join(", ")}.`);
      try {
        for (const result of failing) {
          const index = HERO_CONCEPTS.indexOf(result.concept);
          const audit = rendered.audits.find((entry) => entry.concept === result.concept);
          const notes = [first?.critiques.find((entry) => entry.concept === result.concept)?.notes ?? "", ...(audit && audit.failures.length > 0 ? ["Measured in a browser:", ...audit.failures.map((failure) => `- ${failure}`)] : [])].filter(Boolean).join("\n");
          await sideJob(context, deps, repo, conceptWorkers(context, run.workerPlan.hero, index), heroRevisionBrief(run, design, [{ concept: result.concept, reason: result.reason, notes }], rendered.shots), "execute", [`test -s design/${result.concept}/hero.html`], `rebuild/hero-r${context.revision}-${result.concept}-auto`, `Automatic revision of ${result.concept}`, { ...skill, claudeReadOnlyRoots: [skillFolder, rendered.dir, referencesDir()] });
          revised.add(result.concept);
        }
        await recordConcepts(context, deps, repo);
        rendered = await renderConcepts(context, deps, repo, design, 2);
        artifactIds.push(rendered.reportId);
        const second = await critique(context, deps, repo, design, 2, rendered);
        if (second) artifactIds.push(second.reportId);
        const again = gateConcepts({ critiques: second?.critiques ?? [], made: runFingerprints(run.id), prior: design.prior, attempt: 1, audits: rendered.audits });
        // Only the revised concepts are judged again; the rest keep their first verdict.
        results = results.map((result) => {
          if (!revised.has(result.concept)) return result;
          const verdict = again.find((entry) => entry.concept === result.concept) ?? result;
          return !second && verdict.action === "escalate" && !verdict.reason?.includes("not critiqued") && verdict.score === undefined ? { ...verdict, reason: `${result.reason}; the revision was not critiqued` } : verdict;
        });
      } catch (error) {
        context.log(`The automatic revision did not finish: ${error instanceof Error ? error.message : "unknown error"}. The concepts go to you as they are.`, "warning");
        results = results.map((result) => (result.action === "revise" ? { ...result, action: "escalate" } : result));
      }
    }
    for (const result of results) {
      recordCritique(run.id, result.concept, { score: result.score, passed: result.action === "pass", autoRevised: revised.has(result.concept), escalated: result.action !== "pass", reason: result.reason });
    }
  }

  for (const shot of rendered.rawShots) artifactIds.push(await context.writeImage(`${shot.name}-${shot.viewport}`, `${shot.name} (${shot.viewport})`, shot.file));
  for (const concept of HERO_CONCEPTS) {
    const designFile = await deps.readRepoFile(repo, `design/${concept}/DESIGN.md`);
    if (designFile) artifactIds.push(await context.writeReport(`hero_${concept.replace("-", "_")}_design`, `${concept} DESIGN.md`, wrapReport(run, `${concept} design system`, designFile, { revision: String(context.revision) })));
  }
  const strategy = await deps.readRepoFile(repo, STRATEGY_FILE);
  if (strategy) artifactIds.push(await context.writeReport("hero_strategy", "Creative strategy", wrapReport(run, "creative strategy", strategy, { revision: String(context.revision) })));

  const commit = (await deps.commitFiles(repo, { [marker(`hero-r${context.revision}`)]: `${context.revision}\n` }, `${run.company}: hero concepts (revision ${context.revision})`)) ?? (await headCommit(repo));
  await tagRevision(repo, commit, `rebuild/hero-r${context.revision}`);
  const scored = results ? ` ${first ? "Critique" : "Measured"}: ${gateSummary(results, design, revised)}.` : " The design critique could not run, so the concepts are unscored.";
  return { summary: `${workerName || "The workers"} made ${targets.length === HERO_CONCEPTS.length ? "three concepts" : targets.join(" and ")}. Choose one to build.${scored}`, artifactIds, ref: commit, worker: workerName || undefined };
};

/** The approved concept's direction and assignment, which the build and its review follow on every page. */
function approvedConcept(run: RebuildRun): { direction?: DesignDirection; approved?: ApprovedConcept } {
  const entry = runFingerprints(run.id).find((fingerprint) => fingerprint.concept === run.heroChoice);
  if (!entry) return {};
  const direction = DIRECTION_BY_ID.get(entry.direction);
  const composition = entry.composition ? COMPOSITION_BY_ID.get(entry.composition) : undefined;
  const nav = entry.nav ? NAV_BY_ID.get(entry.nav) : undefined;
  const motion = entry.motion ? MOTION_BY_ID.get(entry.motion) : undefined;
  if (!direction || !composition || !nav || !motion) return { direction };
  return { direction, approved: { concept: entry.concept, pair: { display: entry.pairDisplay ?? direction.type.display, text: entry.pairText ?? direction.type.text }, composition: composition.name, nav: nav.name, motion: motion.name } };
}

/** The approved concept's direction, which the build and its review follow on every page. */
function approvedDirection(run: RebuildRun): DesignDirection | undefined {
  return approvedConcept(run).direction;
}

// ------------------------------------------------------------------ stage 5

/** Every page of the baseline is photographed, up to this many. */
export const BASELINE_PAGE_LIMIT = 20;

/** The route a baseline snapshot's title names: `/services (desktop)` is `/services`. */
const snapshotName = (title: string) => title.replace(/ \((desktop|mobile)\)$/, "");

/**
 * Pages whose snapshot differs from the last revision although the person left
 * no note on them. A shared header edit can move every page, so this is told to
 * the person, not refused.
 */
export function strayedPages(run: RebuildRun, revision: number, shotIds: readonly string[], changeRequest: string | undefined): string[] {
  if (!changeRequest || revision < 2) return [];
  const noted = new Set(
    Object.keys(run.decisions.filter((decision) => decision.stage === "build" && decision.decision === "changes_requested").at(-1)?.pageNotes ?? {}),
  );
  if (noted.size === 0) return [];
  const images = run.artifacts.filter((artifact) => artifact.stage === "build" && artifact.media === "image");
  const changed = new Set<string>();
  for (const id of shotIds) {
    const now = readRun(run.id).artifacts.find((artifact) => artifact.id === id);
    if (!now?.digest) continue;
    const before = images.find((artifact) => artifact.revision === revision - 1 && artifact.title === now.title);
    if (before?.digest && before.digest !== now.digest) changed.add(snapshotName(now.title));
  }
  return [...changed].filter((name) => !noted.has(name));
}

export const buildStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const { run } = context;
  if (!run.heroChoice) throw new StageBlocked("No hero concept was chosen. Approve the hero stage with a concept first.");
  const repo = await repoFor(context, deps);
  // Again here, so a change to the kit after the concepts were approved reaches the build.
  await seedBrandKit(context, deps, repo);
  const patterns = await libraryContextFor(BUILD_KINDS);
  const findings = await lastReviewFindings(context, deps, repo);
  const direction = approvedDirection(run);
  const { job, worker } = await work(context, deps, run.workerPlan.build, () => ({
    project: run.workspaceSlug ?? "",
    objective: withPatterns(buildBrief(run, run.heroChoice ?? "", context.changeRequest, findings, direction, approvedConcept(run).approved), patterns),
    repoPath: repo,
    modelRouteType: "execute",
    validationCommands: NEXT_VALIDATION,
  }));
  // The baseline is reviewed page by page, so every page is photographed top to bottom.
  const shots = await photographSite(context, deps, job, { fullPage: true, limit: BASELINE_PAGE_LIMIT });
  const commit = await integrate(context, deps, job, repo, "copy and structure");
  context.rememberJob(null);
  const review = await secondOpinion(context, deps, repo, direction);
  const strayed = strayedPages(context.run, context.revision, shots, context.changeRequest);
  if (strayed.length > 0) context.log(`Pages without notes also changed in this revision: ${strayed.join(", ")}.`, "warning");
  return {
    summary: `${worker.name} built the site on ${run.heroChoice}; it builds and lints. ${shots.length > 0 ? `${shots.length / 2} page${shots.length === 2 ? "" : "s"} photographed.` : "No screenshots."}${strayed.length > 0 ? ` Also changed, without notes: ${strayed.join(", ")}.` : ""}${review ? ` ${review.said}` : ""}`,
    artifactIds: [...shots, ...(review ? [review.id] : [])],
    ref: commit,
    worker: worker.name,
    jobId: job.id,
    review: review?.verdict,
  };
};

// ------------------------------------------------------------------ stage 6

/**
 * What the functions revision really is: each feature as the worker's own
 * table rates it, then the checks AgentOS ran, then the reviewer. A passing
 * build says nothing about a feature that could not be tested.
 */
export function functionsSummary(
  worker: string,
  requested: number,
  tally: { pass: number; fail: number; blocked: number; demo?: number },
  checks: readonly { command: string; success: boolean }[],
  reviewSaid?: string,
  journeyFails: readonly string[] = [],
): string {
  const rated = tally.pass + tally.fail + tally.blocked;
  const features =
    rated === 0
      ? `${worker} worked on ${requested} feature${requested === 1 ? "" : "s"}, but its report rates none of them.`
      : `${worker} worked on ${requested} feature${requested === 1 ? "" : "s"}: ${[
          tally.pass > 0 ? `${tally.pass} pass${tally.demo ? ` (${tally.demo === tally.pass ? (tally.pass === 1 ? "working in demo mode" : "all working in demo mode") : `${tally.demo} in demo mode`} on sample data)` : ""}` : "",
          tally.fail > 0 ? `${tally.fail} fail` : "",
          tally.blocked > 0 ? `${tally.blocked} blocked` : "",
        ].filter(Boolean).join(", ")}.`;
  const failed = checks.filter((check) => !check.success).map((check) => `\`${check.command}\``);
  const ran = checks.length === 0 ? "AgentOS recorded no checks." : failed.length > 0 ? `Failed checks: ${failed.join(", ")}.` : `All ${checks.length} checks AgentOS ran passed.`;
  const journeys = journeyFails.length > 0 ? `Visitor journeys failing: ${journeyFails.join(", ")}.` : "";
  return [features, ran, journeys, reviewSaid ?? "", "Read the test report before approving."].filter(Boolean).join(" ");
}

export const functionsStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const { run } = context;
  if (run.requiredFunctions.length === 0) {
    const id = await context.writeReport(FUNCTIONALITY_REPORT, "Functionality test report", wrapReport(run, "functionality test report", "No features were requested for this site, so nothing was built or tested in this stage."));
    return { summary: "No features were requested. Approve to move on.", artifactIds: [id] };
  }

  const repo = await repoFor(context, deps);
  const patterns = await libraryContextFor(FUNCTION_KINDS);
  const findings = await lastReviewFindings(context, deps, repo);
  const { job, worker } = await work(context, deps, run.workerPlan.functions, () => ({
    project: run.workspaceSlug ?? "",
    objective: withPatterns(functionsBrief(run, context.changeRequest, findings, briefSettings(run.id)), patterns),
    repoPath: repo,
    modelRouteType: "execute",
    validationCommands: [...NEXT_VALIDATION, "npm test", `test -s ${functionalityFile(run)}`, `test -s ${GO_LIVE_FILE}`, `test -s ${INVENTORY_FILE}`],
  }));
  // The same visitor journeys the preview gets, on the built site before anyone approves it. Nothing is submitted.
  let journeys: QaResult | undefined;
  const shots = await photographSite(context, deps, job, {
    whileServing: async (url, routes) => {
      context.activity("Checking the visitor journeys on the built site");
      journeys = await deps.checkPreview(url, routes, run.requiredFunctions, fetch, journeyInput(run.id));
      context.activity("Pressing every control on the demo build");
      const pressed = await deps.auditInteractions(url, routes, parseInventory(await deps.readRepoFile(job.worktreePath ?? repo, INVENTORY_FILE)));
      journeys.checks.push(...pressed);
      journeys.passed = journeys.checks.every((check) => check.status !== "fail");
    },
  });
  const commit = await integrate(context, deps, job, repo, "functional components");
  context.rememberJob(null);

  // The worker's report, followed by what AgentOS itself ran: its own results are the evidence.
  const workerReport = (await deps.readRepoFile(repo, functionalityFile(run))) ?? "_The worker did not write a report._";
  const goLive = (await deps.readRepoFile(repo, GO_LIVE_FILE))?.trim();
  const ran = (job.result?.tests ?? []).map((test) => `| \`${test.command}\` | ${test.success ? "Pass" : "Fail"} |`);
  const report = [
    workerReport.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim(),
    "",
    `## Going live (${GO_LIVE_FILE})`,
    "",
    goLive ? goLive.replace(/^#\s.*\r?\n/, "").replace(/^(#+)\s/gm, "#$1 ") : `_The worker did not write ${GO_LIVE_FILE}._`,
    "",
    "## Checks AgentOS ran itself",
    "",
    "| Command | Result |",
    "|---|---|",
    ...(ran.length > 0 ? ran : ["| (none recorded) | Not run |"]),
    "",
    "## Visitor journeys AgentOS checked on the built site",
    "",
    journeys ? qaTable(journeys) : "_Not checked: the built site could not be served._",
    "",
  ].join("\n");
  const reportId = await context.writeReport(FUNCTIONALITY_REPORT, "Functionality test report", wrapReport(run, "functionality test report", report, { worker: worker.name, job: job.id, commit }));
  const review = await secondOpinion(context, deps, repo);
  return {
    summary: functionsSummary(worker.name, run.requiredFunctions.length, tallyFeatures(workerReport), job.result?.tests ?? [], review?.said, (journeys as QaResult | undefined)?.checks.filter((check) => check.status === "fail").map((check) => check.check) ?? []),
    artifactIds: [reportId, ...shots, ...(review ? [review.id] : [])],
    ref: commit,
    worker: worker.name,
    jobId: job.id,
    review: review?.verdict,
  };
};

// ------------------------------------------------------------------ stage 7

export { approvedCommit, previewCommit };

/** What to check before sharing a preview that uses the client's own images and fonts. Empty without a brand kit. */
export function brandRightsNote(kit: RebuildRun["brandKit"]): string[] {
  const used = (kit?.assets ?? []).filter((asset) => asset.include);
  if (used.length === 0 && (kit?.fonts.length ?? 0) === 0) return [];
  const fromSite = used.filter((asset) => asset.sourceUrl !== "uploaded");
  return [
    "## Images and fonts from the client's site",
    "",
    `The preview uses ${used.length} image${used.length === 1 ? "" : "s"} from the brand kit, ${fromSite.length} of them taken from the client's current site. Photos there may be stock images licensed to the client only, and the link is open to anyone who has it. Share it with the client, and confirm the rights before it goes further.`,
    ...fromSite.map((asset) => `- ${asset.kind}: ${asset.sourceUrl}`),
    ...(kit && kit.fonts.length > 0 ? [`- Fonts named on their site: ${kit.fonts.map((font) => font.family).join(", ")}. A commercial font needs the client's licence; the build notes any substitute in CONTENT_TODO.md.`] : []),
    "",
  ];
}

export function handoffMessage(run: RebuildRun, url: string): string {
  const features = run.requiredFunctions.filter((value) => value !== "ecommerce").map((value) => REBUILD_FUNCTION_LABEL[value].toLowerCase());
  return [
    "Hi there,",
    "",
    `I put together a new version of the ${run.company} website to show what it could look like: ${url}`,
    "",
    `It works on phones and desktops${features.length > 0 ? `, and includes ${features.length === 1 ? "a " : ""}${features.join(" and ")}` : ""}. Everything on it comes from your current site, so nothing is invented, and anything marked as a placeholder just needs your details.`,
    "",
    "Have a look when you have a minute and let me know what you think.",
    "",
    "[Your name]",
  ].join("\n");
}

async function publishStep<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof PublishError) throw new StageBlocked(error.message);
    throw error;
  }
}

interface PreviewPublish {
  commit: string;
  repo: GithubRepo;
  project: VercelProject;
  repoPath: string;
}

function storedPreviewPublish(run: RebuildRun): Omit<PreviewPublish, "repoPath"> | undefined {
  const commit = previewCommit(run);
  if (!commit || !run.vercelProject || !run.githubRepo) return undefined;
  const [owner, name] = run.githubRepo.split("/");
  if (!owner || !name) return undefined;
  return {
    commit,
    repo: { owner, name, fullName: run.githubRepo, private: true, defaultBranch: PRODUCTION_BRANCH, htmlUrl: `https://github.com/${run.githubRepo}` },
    project: { id: run.vercelProject, name, protected: false, linkedRepo: run.githubRepo },
  };
}

async function localRepoPath(context: StageContext): Promise<string> {
  return repoFor(context, stageDeps.current);
}

/** Prefer the stored GitHub/Vercel ids so a GitHub rate limit cannot block a Vercel-only retry. */
async function previewPublishFromStore(context: StageContext): Promise<PreviewPublish> {
  const stored = storedPreviewPublish(context.run);
  if (stored) return { ...stored, repoPath: await localRepoPath(context) };
  return preparePreviewPublish(context);
}

/** Repo, GitHub remote and Vercel project: created once, reused on retry. Never deploys. */
async function preparePreviewPublish(context: StageContext): Promise<PreviewPublish> {
  const deps = stageDeps.current;
  const { run } = context;
  const commit = previewCommit(run);
  if (!commit) throw new StageBlocked("There is no approved build to publish. Approve the copy and structure (and features) first.");
  const repoPath = await repoFor(context, deps);
  const name = repoFolderName(run.workspaceSlug ?? run.companySlug);

  context.activity("Finding or creating the private GitHub repo");
  const { repo: createdRepo, created } = await publishStep(() => deps.publish.ensurePrivateRepo(name, `${run.company} website rebuild (AgentOS preview)`));
  let repo = createdRepo;
  setRunField(run.id, "github_repo", repo.fullName);
  context.log(created ? `Created the private repo ${repo.fullName}.` : `Using the existing private repo ${repo.fullName}.`);

  if (created) {
    // `main` gets only the first commit, so it becomes the default branch and Vercel's production branch never carries the preview.
    const root = (await git(repoPath, ["rev-list", "--max-parents=0", commit])).split("\n")[0];
    await publishStep(() => deps.publish.pushRef(repoPath, repo, root, PRODUCTION_BRANCH, false));
  }
  repo = await publishStep(() => deps.publish.pinGithubDefaultBranch(repo, PRODUCTION_BRANCH));

  context.activity("Finding or creating the Vercel project");
  const { project } = await publishStep(() => deps.publish.ensureVercelProject(name, repo));
  setRunField(run.id, "vercel_project", project.id);
  await publishStep(() => deps.publish.openPreviewsToLinkHolders(project));
  // Before the push: each deployment is built with the environment it starts with.
  const env = await previewEnvironment(run.id);
  const named = await publishStep(() => deps.publish.setPreviewEnvironment(project, env));
  if (named.length > 0) context.log(`Set ${named.join(", ")} in the preview environment.`);
  return { commit, repo, project, repoPath };
}

async function waitForReadyDeployment(
  context: StageContext,
  project: VercelProject,
  commit: string,
  deployment: VercelDeploymentState,
): Promise<VercelDeploymentState> {
  const deps = stageDeps.current;
  setRunField(context.run.id, "deployment_id", deployment.id);
  for (let poll = 0; !["READY", "ERROR", "CANCELED", "BLOCKED"].includes(deployment.state); poll += 1) {
    if (poll * DEPLOY_POLL_MS > deps.deployTimeoutMs) throw new StageBlocked(`Vercel has not finished building ${deployment.url} after ${Math.round(deps.deployTimeoutMs / 60000)} minutes. Check it in Vercel, then retry.`);
    context.activity(`Vercel is building the preview (${deployment.state.toLowerCase()})`);
    await deps.sleep(DEPLOY_POLL_MS);
    deployment = await publishStep(() => deps.publish.readDeployment(deployment.id));
  }
  if (deployment.state === "READY") return deployment;
  context.activity("Checking Vercel for a later READY deploy of this commit");
  const listed = await publishStep(() => deps.publish.listCommitDeployments(project, commit));
  const ready = pickCommitDeployment(listed, commit);
  if (ready?.state === "READY") {
    setRunField(context.run.id, "deployment_id", ready.id);
    return ready;
  }
  throw new StageBlocked(vercelBuildFailureMessage(deployment));
}

async function handoffReadyPreview(
  context: StageContext,
  publish: PreviewPublish,
  deployment: VercelDeploymentState,
  options: { skipQa?: boolean; operatorNote?: string } = {},
): Promise<StageOutcome> {
  const deps = stageDeps.current;
  const { run, commit, repo, repoPath } = { ...context, ...publish };
  const routes = routesFrom(await git(repoPath, ["show", `${commit}:sitemap.json`]).catch(() => undefined));
  const qa = options.skipQa
    ? { passed: true, checks: [{ check: "Marked as deployed", status: "pass" as const, detail: options.operatorNote ?? "The operator confirmed a READY Vercel deployment." }] }
    : await (async () => {
        context.activity("Checking the preview as a visitor with no login");
        return deps.checkPreview(deployment.url, routes, run.requiredFunctions, fetch, journeyInput(run.id));
      })();

  const artifactIds: string[] = [];
  if (!options.skipQa && qa.checks[0]?.status === "pass") {
    try {
      const shots = await deps.screenshot(routes.slice(0, 3).map((route) => ({ name: routeName(route), target: `${deployment.url}${route}` })), await deps.scratchDir("preview"));
      for (const shot of shots) artifactIds.push(await context.writeImage(`${shot.name}-${shot.viewport}`, `${shot.name} (${shot.viewport})`, shot.file));
    } catch (error) {
      context.log(`Screenshots of the preview could not be taken: ${error instanceof Error ? error.message : "unknown error"}.`, "warning");
    }
  }

  const report = [
    "## Preview",
    "",
    `- Link: ${deployment.url}`,
    `- Commit: ${commit} (${commit === run.motionRef ? "the approved revision with its motion pass" : "approved revision"}, pushed to the \`preview\` branch of ${repo.fullName})`,
    `- Vercel deployment: ${deployment.id}`,
    "- Access: anyone with the link, no login. Not promoted to production; no domain or DNS changes.",
    `- Checked: ${new Date().toISOString()}`,
    ...(options.operatorNote ? [`- Note: ${options.operatorNote}`] : []),
    "",
    "## Checks as a visitor with no login",
    "",
    qaTable(qa),
    "",
    ...brandRightsNote(readRun(run.id).brandKit),
    "## Message for the client",
    "",
    "Not sent. Copy it into an email when you are ready.",
    "",
    "```text",
    handoffMessage(run, deployment.url),
    "```",
    "",
  ].join("\n");
  artifactIds.unshift(await context.writeReport("preview_handoff", "Preview handoff", wrapReport(run, "preview handoff", report, { previewUrl: deployment.url, commit })));

  if (!qa.passed) {
    const failed = qa.checks.filter((check) => check.status === "fail").map((check) => `${check.check}: ${check.detail}`);
    throw new StageBlocked(`The preview is deployed but did not pass its checks. ${failed.join(" ")} The handoff report has the details.`);
  }

  setRunField(run.id, "preview_url", deployment.url);
  try {
    await deps.savePreviewLink(run.prospectId, deployment.url);
  } catch (error) {
    context.log(`The preview link could not be saved on the lead: ${error instanceof Error ? error.message : "unknown error"}. It is in the handoff report.`, "warning");
  }
  return { summary: `Live at ${deployment.url} for anyone with the link. Every check passed.`, artifactIds, ref: commit };
}

async function pickupGitPushDeployment(context: StageContext, publish: PreviewPublish): Promise<VercelDeploymentState> {
  const deps = stageDeps.current;
  const { project, repo, commit } = publish;
  const gitPushTriggered = Boolean(project.linkedRepo);
  const pickupMs = 3 * 60 * 1000;
  let deployment: VercelDeploymentState | undefined;
  for (let waited = 0; !deployment && waited <= pickupMs; waited += DEPLOY_POLL_MS) {
    const listed = await publishStep(() => deps.publish.listCommitDeployments(project, commit));
    const next = nextPreviewDeployStep({ gitPushTriggered, deployments: listed, commit });
    if (next.step === "use-existing" && next.deployment) {
      deployment = next.deployment;
      break;
    }
    if (next.step === "blocked") throw new StageBlocked(next.message ?? "Vercel started a production deployment of the preview branch.");
    if (next.step === "request-preview") {
      deployment = await publishStep(() => deps.publish.requestPreviewDeployment(project, repo, PREVIEW_BRANCH, commit));
      break;
    }
    if (waited >= pickupMs) break;
    context.activity("Waiting for Vercel to pick up the push");
    await deps.sleep(DEPLOY_POLL_MS);
  }
  if (!deployment) {
    throw new StageBlocked("Vercel did not start a preview from the push. AgentOS did not request a second deploy, to avoid GitHub rate limits. Check the GitHub integration in Vercel, then retry.");
  }
  return deployment;
}

/**
 * Stage 7: the approved revision, live on a Vercel preview a client can open.
 *
 * Private GitHub repo on the token's account; the approved commit pushed to a
 * `preview` branch (never `main` after the first push, so nothing reaches
 * production); Vercel's Git integration builds it; previews are opened to
 * anyone with the link; then the preview is checked as a stranger would see
 * it. Each step looks before it acts, so a retry never makes a second repo,
 * project or deployment. A READY deploy of the approved SHA (any target) is
 * success: retry will not bind to an older ERROR of the same commit.
 */
export const previewStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const stored = storedPreviewPublish(context.run);
  if (stored) {
    context.activity("Looking for a Vercel deployment of the approved commit");
    const listed = await publishStep(() => deps.publish.listCommitDeployments(stored.project, stored.commit));
    const already = pickCommitDeployment(listed, stored.commit);
    if (already) {
      // Repo and project already exist. Do not git-push the same SHA again: that
      // is how a rate-limited clone gets hit twice. A READY (any target) is
      // success; an ERROR re-lists once, then blocks so the operator can force.
      context.log(`Using existing Vercel deployment ${already.id} (${already.state}) of this commit.`);
      const publish = { ...stored, repoPath: await localRepoPath(context) };
      const deployment = await waitForReadyDeployment(context, stored.project, stored.commit, already);
      return handoffReadyPreview(context, publish, deployment);
    }
  }

  const publish = await preparePreviewPublish(context);
  const { project, commit, repoPath, repo } = publish;
  context.activity("Looking for a Vercel deployment of the approved commit");
  const already = pickCommitDeployment(await publishStep(() => deps.publish.listCommitDeployments(project, commit)), commit);
  let deployment: VercelDeploymentState;
  if (already?.state === "READY" || (already && already.state !== "ERROR")) {
    context.log(`Using existing Vercel deployment ${already.id} (${already.state}) of this commit.`);
    deployment = already;
  } else {
    context.activity(`Pushing the approved commit ${commit.slice(0, 7)} to the preview branch`);
    await publishStep(() => deps.publish.pushRef(repoPath, repo, commit, PREVIEW_BRANCH, true));
    deployment = await pickupGitPushDeployment(context, publish);
  }
  deployment = await waitForReadyDeployment(context, project, commit, deployment);
  return handoffReadyPreview(context, publish, deployment);
};

/** Resync from Vercel's latest deploys of the approved SHA. Does not push or create a deploy. */
export const recheckPreviewStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const publish = await previewPublishFromStore(context);
  context.activity("Re-checking Vercel for a deployment of the approved commit");
  const listed = await publishStep(() => deps.publish.listCommitDeployments(publish.project, publish.commit));
  const next = nextPreviewDeployStep({ gitPushTriggered: true, deployments: listed, commit: publish.commit });
  if (next.step === "blocked") throw new StageBlocked(next.message ?? "Vercel started a production deployment of the preview branch.");
  if (!next.deployment) {
    throw new StageBlocked("Vercel has no deployment of this commit yet. Use Deploy now (force) to create one, or paste a READY deployment id.");
  }
  const deployment = await waitForReadyDeployment(context, publish.project, publish.commit, next.deployment);
  return handoffReadyPreview(context, publish, deployment);
};

/** Clears the blocker and requests exactly one Vercel API deploy with forceNew. */
export const forcePreviewStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const publish = await previewPublishFromStore(context);
  context.activity("Requesting a new Vercel deploy (force)");
  const requested = await publishStep(() => deps.publish.requestForcedPreviewDeployment(publish.project, publish.repo, PREVIEW_BRANCH, publish.commit));
  const deployment = await waitForReadyDeployment(context, publish.project, publish.commit, requested);
  return handoffReadyPreview(context, publish, deployment);
};

/** Verify a pasted Vercel deployment (READY, this project) and record it as the live preview. */
export function markPreviewStage(deploymentRef: string): StageHandler {
  return async (context) => {
    const deps = stageDeps.current;
    const publish = await previewPublishFromStore(context);
    context.activity("Verifying the pasted Vercel deployment");
    const deployment = await publishStep(() => deps.publish.readDeploymentByRef(deploymentRef));
    if (deployment.state !== "READY") {
      throw new StageBlocked(`That deployment is ${deployment.state}, not READY. Open it in Vercel, or pick a successful one.`);
    }
    if (!deploymentBelongsToProject(deployment, publish.project)) {
      throw new StageBlocked(`That deployment is not for this workspace's Vercel project (${publish.project.name}).`);
    }
    setRunField(context.run.id, "deployment_id", deployment.id);
    return handoffReadyPreview(context, publish, deployment, {
      skipQa: true,
      operatorNote: "Marked as deployed by the operator from a READY Vercel deployment.",
    });
  };
}

export type { StageOutcome };
