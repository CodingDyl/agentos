import fs from "node:fs/promises";
import path from "node:path";
import {
  BUILD_STAGE_LABEL,
  BUILD_STAGES,
  MOTION_CONCEPTS_FILE,
  MOTION_CREDIT_LEDGER,
  MotionConceptSchema,
  parseCreditLedger,
  type BuildStage,
  type MotionConcept,
  type MotionMedia,
  type MotionProgress,
  type MotionRun,
  type ReviewLogEntry,
} from "../../shared/motion-design-types";
import type { WorkerJob } from "../../shared/worker-types";
import { git } from "../agentos/git";
import { readJob } from "../workers/job-manager";
import { listJobs } from "../workers/job-store";
import { saveRun } from "./store";

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;

async function readText(root: string, relative: string): Promise<string | undefined> {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) return undefined;
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

async function listFiles(root: string, relative: string): Promise<string[]> {
  const folder = path.resolve(root, relative);
  if (!folder.startsWith(`${path.resolve(root)}${path.sep}`)) return [];
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    // `._name` files are macOS metadata on non-Apple drives (the vault SSD), not media.
    return entries.filter((entry) => entry.isFile() && !entry.name.startsWith("._")).map((entry) => path.join(relative, entry.name));
  } catch {
    return [];
  }
}

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const number = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

/** A list the skill wrote as objects or strings, as one readable line. */
function listLine(value: unknown, keys: string[]): string | undefined {
  if (typeof value === "string") return text(value);
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((entry) => (isObject(entry) ? keys.map((key) => text(entry[key])).find(Boolean) : text(entry)))
    .filter((part): part is string => Boolean(part))
    .map((part) => (part.length > 90 ? `${part.slice(0, 89)}…` : part));
  return parts.length > 0 ? parts.join(" → ") : undefined;
}

const clip = (value: string | undefined, limit: number) => (value && value.length > limit ? `${value.slice(0, limit - 1)}…` : value);

/**
 * Reads `motion-studio/concepts.json`.
 *
 * The skill writes this file, not AgentOS, and has used more than one shape
 * for it: `title` or `name`, a flat `plannedCredits` or a `totals.planned`
 * beside `line_items`, a journey as a sentence or as a list of frames. A
 * strict reader that finds nothing it recognises shows no concepts, and then
 * the credit approval the whole run is waiting for never appears. So this
 * reads the names the skill is known to use and falls back on what it can
 * tell, rather than discarding a concept over a field it wanted as a string.
 */
export function parseConcepts(raw: string): MotionConcept[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.concepts) ? parsed.concepts : [];
    return list.flatMap((entry, index) => {
      if (!isObject(entry)) return [];
      const totals = isObject(entry.totals) ? entry.totals : {};
      const lineItems = Array.isArray(entry.itemized) ? entry.itemized : Array.isArray(entry.line_items) ? entry.line_items : [];
      const itemized = lineItems.flatMap((item) => {
        if (!isObject(item)) return [];
        const label = text(item.label) ?? text(item.item);
        const credits = number(item.credits);
        return label && credits !== undefined ? [{ label: clip(label, 200)!, credits }] : [];
      });
      const planned =
        number(entry.plannedCredits) ??
        number(entry.credits) ??
        number(totals.planned) ??
        itemized.filter((_, i) => (lineItems[i] as Loose | undefined)?.kind !== "contingency").reduce((sum, item) => sum + item.credits, 0);

      const result = MotionConceptSchema.safeParse({
        id: clip(text(entry.id) ?? (index === 0 ? "A" : "B"), 40),
        title: clip(text(entry.title) ?? text(entry.name) ?? `Concept ${index === 0 ? "A" : "B"}`, 120),
        summary: clip(text(entry.summary) ?? text(entry.hero_idea) ?? text(entry.hero) ?? "", 2000),
        hero: clip(text(entry.hero) ?? text(entry.hero_idea), 800),
        journey: clip(listLine(entry.journey, ["frame", "label", "id"]), 800),
        sections: clip(listLine(entry.sections, ["name", "title"]), 800),
        motion: clip(text(entry.motion) ?? text(entry.motion_approach), 800),
        plannedCredits: planned,
        itemized,
        recommended: typeof entry.recommended === "boolean" ? entry.recommended : undefined,
      });
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

/** A verdict table row such as `| Design rules | Pass with fixes | 3 |`. */
const VERDICT_ROW: ReadonlyArray<[ReviewLogEntry["review"], RegExp]> = [
  ["brief", /^\|\s*brief\s*\|\s*(pass[^|]*)\|/im],
  ["design", /^\|\s*design(?: rules)?\s*\|\s*(pass[^|]*)\|/im],
  ["craft", /^\|\s*craft\s*\|\s*(pass[^|]*)\|/im],
];

function parseReviewLog(markdown: string): ReviewLogEntry[] {
  const entries: ReviewLogEntry[] = [];
  // Rounds are often headed by number ("Round 2: finish review") with the three
  // verdicts in a table, so a passing row counts as that review being done.
  for (const [review, row] of VERDICT_ROW) {
    const match = markdown.match(row);
    if (match) entries.push({ review, summary: match[1].trim() });
  }
  const blocks = markdown.split(/^##\s+/m).slice(1);
  for (const block of blocks) {
    const [heading, ...rest] = block.split("\n");
    const title = heading?.toLowerCase() ?? "";
    const review = title.includes("craft") ? "craft" : title.includes("design") ? "design" : title.includes("brief") ? "brief" : undefined;
    if (!review) continue;
    entries.push({ review, summary: rest.join("\n").trim().slice(0, 2000) });
  }
  return entries;
}

function stageStatus(present: Partial<Record<BuildStage, boolean>>, current?: BuildStage): MotionProgress["stages"] {
  let seenCurrent = false;
  return BUILD_STAGES.map((id) => {
    if (present[id]) return { id, label: BUILD_STAGE_LABEL[id], status: "complete" as const };
    if (!seenCurrent && current === id) {
      seenCurrent = true;
      return { id, label: BUILD_STAGE_LABEL[id], status: "in_progress" as const };
    }
    return { id, label: BUILD_STAGE_LABEL[id], status: "not_started" as const };
  });
}

/**
 * The attempt that carries the run now.
 *
 * A build that hit a quota is retried from the Workers page, and each retry is
 * a new job. Following `retryOf` forward keeps this page on the newest attempt
 * instead of the first one that died. A cancelled retry is passed over unless
 * it finished and was reviewed: stopped early it is an abandoned attempt, but
 * cancelled after review it is finished work someone took off the queue.
 */
function carriesTheRun(job: WorkerJob): boolean {
  return job.status !== "cancelled" || Boolean(job.review);
}

export async function currentAttempt(run: MotionRun): Promise<WorkerJob | undefined> {
  const startId = run.buildJobId ?? run.proposalJobId;
  let job = startId ? await readJob(startId) : undefined;
  if (!job) return undefined;

  const jobs = await listJobs(1000);
  const seen = new Set<string>([job.id]);
  for (;;) {
    const current: WorkerJob = job;
    const next = jobs.find((candidate) => candidate.retryOf === current.id && carriesTheRun(candidate) && !seen.has(candidate.id));
    if (!next) return job;
    seen.add(next.id);
    job = next;
  }
}

/**
 * Where the site lives inside a job's checkout.
 *
 * New sites are their own repositories. Older ones may still be a subfolder
 * of a bigger repository (the vault); a worktree is then a checkout of that
 * whole repository, so the same subpath is needed inside it.
 */
async function siteInWorktree(job: WorkerJob | undefined, siteRepoPath: string | undefined): Promise<string | undefined> {
  if (!job?.worktreePath) return undefined;
  if (!siteRepoPath) return job.worktreePath;
  try {
    const { stdout } = await git(siteRepoPath, ["rev-parse", "--show-prefix"]);
    return path.join(job.worktreePath, stdout.trim());
  } catch {
    return job.worktreePath;
  }
}

export async function scanMotionProgress(run: MotionRun): Promise<MotionProgress> {
  const roots = [run.siteRepoPath];
  const job = await currentAttempt(run);
  const worktreeSite = await siteInWorktree(job, run.siteRepoPath);
  if (worktreeSite) roots.unshift(worktreeSite);

  let concepts: MotionConcept[] = run.concepts;
  let ledger: MotionProgress["ledger"];
  let reviewLog: ReviewLogEntry[] = [];
  const keyframes: MotionMedia[] = [];
  const clips: MotionMedia[] = [];
  let previewUrl: string | undefined;
  const present: Partial<Record<BuildStage, boolean>> = {};

  for (const root of roots) {
    if (!root) continue;
    const conceptsText = await readText(root, MOTION_CONCEPTS_FILE);
    if (conceptsText) {
      const parsed = parseConcepts(conceptsText);
      if (parsed.length > 0) {
        concepts = parsed;
        present.interview = true;
        present.teardown = true;
      }
    }
    if (await readText(root, "motion-studio/teardown.md")) present.teardown = true;
    const ledgerText = await readText(root, MOTION_CREDIT_LEDGER);
    if (ledgerText) ledger = parseCreditLedger(ledgerText);
    const logText = await readText(root, "motion-studio/review-log.md");
    if (logText) {
      reviewLog = parseReviewLog(logText);
      if (reviewLog.some((entry) => entry.review === "brief")) present.review_brief = true;
      if (reviewLog.some((entry) => entry.review === "design")) present.review_design = true;
      if (reviewLog.some((entry) => entry.review === "craft")) present.review_craft = true;
    }
    for (const folder of ["motion-studio/images", "motion-studio/keyframes", "motion-studio/media/keyframes", "public"]) {
      for (const file of await listFiles(root, folder)) {
        if (IMAGE.test(file)) {
          present.images = true;
          keyframes.push({ name: path.basename(file), url: `/api/motion-design/${run.id}/media?path=${encodeURIComponent(file)}`, kind: "image" });
        }
      }
    }
    for (const folder of ["motion-studio/clips", "motion-studio/video", "motion-studio/media", "assets/film", "public"]) {
      for (const file of await listFiles(root, folder)) {
        if (VIDEO.test(file)) {
          present.video = true;
          clips.push({ name: path.basename(file), url: `/api/motion-design/${run.id}/media?path=${encodeURIComponent(file)}`, kind: "video" });
        }
      }
    }
    // A plain HTML site has no package.json; its index page is the build.
    if ((await readText(root, "package.json")) || (await readText(root, "index.html"))) present.build = true;
    if (await readText(root, "motion-studio/copy.md")) present.copy = true;
    const preview = await readText(root, "motion-studio/preview-url.txt");
    if (preview?.trim()) previewUrl = preview.trim();
  }

  if (job?.status === "running" || job?.status === "preparing" || job?.status === "queued") {
    if (!present.teardown) present.teardown = false;
  }

  const current: BuildStage | undefined = !present.teardown
    ? "teardown"
    : !present.interview
      ? "interview"
      : !present.images
        ? "images"
        : !present.video
          ? "video"
          : !present.build
            ? "build"
            : !present.review_brief
              ? "review_brief"
              : !present.review_design
                ? "review_design"
                : !present.review_craft
                  ? "review_craft"
                  : !present.copy
                    ? "copy"
                    : undefined;

  return {
    stages: stageStatus(present, job && ["running", "preparing", "queued", "validating"].includes(job.status) ? current : undefined),
    keyframes: uniqueMedia(keyframes),
    clips: uniqueMedia(clips),
    previewUrl,
    reviewLog,
    ledger,
    concepts,
    // The current attempt speaks for the run; an older attempt's error is history.
    error: job ? job.error : run.error,
  };
}

function uniqueMedia(items: MotionMedia[]): MotionMedia[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

export async function refreshRun(run: MotionRun): Promise<MotionRun> {
  const progress = await scanMotionProgress(run);
  const job = await currentAttempt(run);
  let status = run.status;
  let error = run.error;
  let step = run.step;

  if (progress.concepts.length > 0 && !run.approval && !run.codeOnly) {
    status = "awaiting_approval";
    step = "approval";
  }
  const builtAndReviewed =
    (job?.status === "completed" ||
      job?.status === "awaiting_review" ||
      // Cancelled after a passing review: finished work taken off the queue.
      (job?.status === "cancelled" && job.review?.verdict === "pass")) &&
    (run.approval || run.codeOnly) &&
    progress.stages.every((stage) => stage.status === "complete" || stage.id === "copy");

  if (builtAndReviewed) {
    // Waiting on review still means the build is done: what is left is the
    // operator's sign-off, not more work from the studio.
    status = "completed";
    step = "progress";
    error = undefined;
  } else if (job?.status === "failed") {
    status = "failed";
    error = job.error ?? "The Claude Code job failed.";
  } else if (job?.status === "cancelled") {
    status = "cancelled";
    error = job.error;
  } else if (job && ["running", "preparing", "queued", "validating"].includes(job.status)) {
    status = run.approval ? "building" : "running";
  }

  // Follow the newest attempt, so "Open worker job" and notes reach it.
  const buildJobId = run.buildJobId && job && job.id !== run.buildJobId ? job.id : run.buildJobId;

  const next: MotionRun = {
    ...run,
    buildJobId,
    status,
    step,
    error,
    concepts: progress.concepts.length > 0 ? progress.concepts : run.concepts,
  };
  if (
    next.status === run.status &&
    next.buildJobId === run.buildJobId &&
    next.step === run.step &&
    next.error === run.error &&
    JSON.stringify(next.concepts) === JSON.stringify(run.concepts)
  ) {
    return run;
  }
  return saveRun(next);
}

export async function resolveMediaFile(run: MotionRun, relative: string): Promise<string | undefined> {
  const safe = relative.replace(/\\/g, "/");
  if (safe.startsWith("/") || safe.includes("..")) return undefined;
  const job = await currentAttempt(run);
  const roots = [await siteInWorktree(job, run.siteRepoPath), run.siteRepoPath].filter((root): root is string => Boolean(root));
  for (const root of roots) {
    const target = path.resolve(root, safe);
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
    try {
      await fs.access(target);
      return target;
    } catch {
      // Try the next root.
    }
  }
  return undefined;
}
