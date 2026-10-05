import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HERO_CONCEPTS, type RebuildRun } from "../../shared/website-rebuild-types";
import type { WorkerJob } from "../../shared/worker-types";
import { agentOSRoot, readOptionalFile } from "../agentos/filesystem";
import { HermesError, sendToHermes } from "../hermes/client";
import { ClientRepoUnavailable, commitFiles, ensureClientRepo, readRepoFile } from "./client-repo";
import {
  FIVE_KEY_AREAS,
  FUNCTIONALITY_REPORT,
  HERMES_ANALYSIS,
  NEXT_VALIDATION,
  buildBrief,
  functionalityFile,
  functionsBrief,
  heroBrief,
  hermesAnalysisPrompt,
  researchBrief,
  researchFile,
  reviewBrief,
  reviewFile,
} from "./prompts";
import { REPORT_DIR, reportFile, wrapReport } from "./reports";
import { routeName, routesFrom, screenshot, serveBuiltNextApp } from "./screens";
import { StageBlocked, type StageContext, type StageHandler, type StageOutcome } from "./stage-kit";
import { setRunField } from "./store";
import { integrateJob, pickWorker, runJob, WorkerStageBlocked, type PickedWorker } from "./workers";

/**
 * Stages 3 to 6: research, hero concepts, copy and structure, functions.
 *
 * Each stage hands its work to the first available worker on its list, then
 * AgentOS checks the result itself (files exist, build, lint, tests), commits
 * it into the client repo as `rebuild/<stage>-r<n>`, photographs it, and
 * files the reports in the workspace. Gated stages then wait for a person.
 */

export interface StageDeps {
  ensureRepo: (slug: string, company: string) => Promise<string>;
  commitFiles: typeof commitFiles;
  readRepoFile: typeof readRepoFile;
  readVaultFile: (relativePath: string) => Promise<string | undefined>;
  runJob: typeof runJob;
  pickWorker: typeof pickWorker;
  integrate: typeof integrateJob;
  hermes: (prompt: string, onReply: (meta: { id?: string; model?: string }) => void) => Promise<string>;
  screenshot: typeof screenshot;
  serveNext: typeof serveBuiltNextApp;
  readDesignTemplate: (template: string) => Promise<string | undefined>;
  today: () => string;
  scratchDir: (name: string) => Promise<string>;
}

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const defaultStageDeps: StageDeps = {
  ensureRepo: ensureClientRepo,
  commitFiles,
  readRepoFile,
  readVaultFile: (relativePath) => readOptionalFile(relativePath),
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
    const repo = await deps.ensureRepo(context.run.workspaceSlug, context.run.company);
    if (repo !== context.run.repoPath) setRunField(context.run.id, "repo_path", repo);
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
  try {
    return await deps.runJob(buildRequest, candidates, context.record.jobId, {
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

/** A second model reads the work. Optional: if no reviewer is free, or it fails, the person still reviews. */
async function secondOpinion(context: StageContext, deps: StageDeps, repo: string): Promise<string | undefined> {
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
      () => ({ project: context.run.workspaceSlug ?? "", objective: reviewBrief(context.run, context.stage, context.revision, tag), repoPath: repo, validationCommands: [`test -s ${file}`] }),
      [reviewer.id],
      undefined,
      { onProgress: context.activity, onStarted: (jobId) => context.log(`Review job ${jobId} started with ${reviewer.name}.`) },
    );
    await deps.integrate(job, repo, `Review of ${context.stage} revision ${context.revision}`, `rebuild/${context.stage}-r${context.revision}-review`);
    const review = await deps.readRepoFile(repo, file);
    return review ? context.writeReport(`${context.stage}_r${context.revision}_review`, `${reviewer.name} review of ${context.stage} r${context.revision}`, wrapReport(context.run, `review of ${context.stage} revision ${context.revision}`, review, { reviewer: reviewer.name, job: job.id })) : undefined;
  } catch (error) {
    context.log(`The second-opinion review did not finish: ${error instanceof Error ? error.message : "unknown error"}. You can still review this revision yourself.`, "warning");
    return undefined;
  }
}

/** Photographs a built Next.js app from the job's checkout, before its code moves into the repo. */
async function photographSite(context: StageContext, deps: StageDeps, job: WorkerJob): Promise<string[]> {
  if (!job.worktreePath) return [];
  const sitemap = await deps.readRepoFile(job.worktreePath, "sitemap.json");
  const routes = routesFrom(sitemap);
  context.activity(`Photographing ${routes.length} page${routes.length === 1 ? "" : "s"} at desktop and phone widths`);
  let server: { url: string; stop: () => void } | undefined;
  try {
    server = await deps.serveNext(job.worktreePath);
    const shots = await deps.screenshot(routes.map((route) => ({ name: routeName(route), target: `${server?.url}${route}` })), await deps.scratchDir(context.stage));
    const ids: string[] = [];
    for (const shot of shots) ids.push(await context.writeImage(`${shot.name}-${shot.viewport}`, `${shot.name} (${shot.viewport})`, shot.file));
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
          { project: run.workspaceSlug ?? "", objective: researchBrief(run, deps.today(), `${site.structure}\n\n${site.transcript}`.slice(0, 24_000)) }
        : { project: run.workspaceSlug ?? "", objective: researchBrief(run, deps.today()), repoPath: repo, validationCommands: [`test -s ${researchFile(run)}`] },
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

export const heroStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const { run } = context;
  const repo = await repoFor(context, deps);
  const template = await deps.readDesignTemplate(run.designTemplate);
  if (!template) throw new StageBlocked(`The design template ${run.designTemplate} could not be found in the vault or in AgentOS. Fix the path and retry.`);
  await deps.commitFiles(repo, { "design/TEMPLATE.md": template }, "Add the design system template");

  const files = HERO_CONCEPTS.flatMap((concept) => [`design/${concept}/DESIGN.md`, `design/${concept}/hero.html`]);
  const { job, worker } = await work(context, deps, run.workerPlan.hero, () => ({
    project: run.workspaceSlug ?? "",
    objective: heroBrief(run, context.changeRequest),
    repoPath: repo,
    validationCommands: [files.map((file) => `test -s ${file}`).join(" && ")],
  }));
  const commit = await integrate(context, deps, job, repo, "hero concepts");

  context.activity("Photographing the three heroes at desktop and phone widths");
  const artifactIds: string[] = [];
  try {
    const shots = await deps.screenshot(HERO_CONCEPTS.map((concept) => ({ name: concept, target: path.join(repo, "design", concept, "hero.html") })), await deps.scratchDir("hero"));
    for (const shot of shots) artifactIds.push(await context.writeImage(`${shot.name}-${shot.viewport}`, `${shot.name} (${shot.viewport})`, shot.file));
  } catch (error) {
    throw new StageBlocked(`The concepts were made but could not be photographed: ${error instanceof Error ? error.message : "unknown error"}. Retry once Playwright works.`);
  }
  for (const concept of HERO_CONCEPTS) {
    const design = await deps.readRepoFile(repo, `design/${concept}/DESIGN.md`);
    if (design) artifactIds.push(await context.writeReport(`hero_${concept.replace("-", "_")}_design`, `${concept} DESIGN.md`, wrapReport(run, `${concept} design system`, design, { revision: String(context.revision) })));
  }
  context.rememberJob(null);
  return { summary: `${worker.name} made three concepts. Choose one to build.`, artifactIds, ref: commit, worker: worker.name, jobId: job.id };
};

// ------------------------------------------------------------------ stage 5

export const buildStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const { run } = context;
  if (!run.heroChoice) throw new StageBlocked("No hero concept was chosen. Approve the hero stage with a concept first.");
  const repo = await repoFor(context, deps);
  const { job, worker } = await work(context, deps, run.workerPlan.build, () => ({
    project: run.workspaceSlug ?? "",
    objective: buildBrief(run, run.heroChoice ?? "", context.changeRequest),
    repoPath: repo,
    validationCommands: NEXT_VALIDATION,
  }));
  const shots = await photographSite(context, deps, job);
  const commit = await integrate(context, deps, job, repo, "copy and structure");
  context.rememberJob(null);
  const review = await secondOpinion(context, deps, repo);
  return {
    summary: `${worker.name} built the site on ${run.heroChoice}; it builds and lints. ${shots.length > 0 ? `${shots.length / 2} page${shots.length === 2 ? "" : "s"} photographed.` : "No screenshots."}${review ? " A second opinion is attached." : ""}`,
    artifactIds: [...shots, ...(review ? [review] : [])],
    ref: commit,
    worker: worker.name,
    jobId: job.id,
  };
};

// ------------------------------------------------------------------ stage 6

export const functionsStage: StageHandler = async (context) => {
  const deps = stageDeps.current;
  const { run } = context;
  if (run.requiredFunctions.length === 0) {
    const id = await context.writeReport(FUNCTIONALITY_REPORT, "Functionality test report", wrapReport(run, "functionality test report", "No features were requested for this site, so nothing was built or tested in this stage."));
    return { summary: "No features were requested. Approve to move on.", artifactIds: [id] };
  }

  const repo = await repoFor(context, deps);
  const { job, worker } = await work(context, deps, run.workerPlan.functions, () => ({
    project: run.workspaceSlug ?? "",
    objective: functionsBrief(run, context.changeRequest),
    repoPath: repo,
    validationCommands: [...NEXT_VALIDATION, "npm test", `test -s ${functionalityFile(run)}`],
  }));
  const shots = await photographSite(context, deps, job);
  const commit = await integrate(context, deps, job, repo, "functional components");
  context.rememberJob(null);

  // The worker's report, followed by what AgentOS itself ran: its own results are the evidence.
  const workerReport = (await deps.readRepoFile(repo, functionalityFile(run))) ?? "_The worker did not write a report._";
  const ran = (job.result?.tests ?? []).map((test) => `| \`${test.command}\` | ${test.success ? "Pass" : "Fail"} |`);
  const report = [
    workerReport.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim(),
    "",
    "## Checks AgentOS ran itself",
    "",
    "| Command | Result |",
    "|---|---|",
    ...(ran.length > 0 ? ran : ["| (none recorded) | Not run |"]),
    "",
  ].join("\n");
  const reportId = await context.writeReport(FUNCTIONALITY_REPORT, "Functionality test report", wrapReport(run, "functionality test report", report, { worker: worker.name, job: job.id, commit }));
  const review = await secondOpinion(context, deps, repo);
  return {
    summary: `${worker.name} added ${run.requiredFunctions.length} feature${run.requiredFunctions.length === 1 ? "" : "s"}; build, lint and tests pass. Read the test report before approving.`,
    artifactIds: [reportId, ...shots, ...(review ? [review] : [])],
    ref: commit,
    worker: worker.name,
    jobId: job.id,
  };
};

export type { StageOutcome };
