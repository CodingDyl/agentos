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
import { readJob } from "../workers/job-manager";
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
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(relative, entry.name));
  } catch {
    return [];
  }
}

export function parseConcepts(text: string): MotionConcept[] {
  try {
    const parsed: unknown = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && "concepts" in parsed ? (parsed as { concepts: unknown }).concepts : [];
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry, index) => {
      const result = MotionConceptSchema.safeParse({
        ...(typeof entry === "object" && entry ? entry : {}),
        id: (entry as { id?: string })?.id ?? (index === 0 ? "a" : "b"),
        title: (entry as { title?: string })?.title ?? `Concept ${index === 0 ? "A" : "B"}`,
        plannedCredits: Number((entry as { plannedCredits?: number })?.plannedCredits ?? (entry as { credits?: number })?.credits ?? 0),
      });
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

function parseReviewLog(markdown: string): ReviewLogEntry[] {
  const entries: ReviewLogEntry[] = [];
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

export async function scanMotionProgress(run: MotionRun): Promise<MotionProgress> {
  const roots = [run.siteRepoPath];
  const jobId = run.buildJobId ?? run.proposalJobId;
  const job = jobId ? await readJob(jobId) : undefined;
  if (job?.worktreePath) roots.unshift(job.worktreePath);

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
    for (const folder of ["motion-studio/images", "motion-studio/keyframes", "public"]) {
      for (const file of await listFiles(root, folder)) {
        if (IMAGE.test(file)) {
          present.images = true;
          keyframes.push({ name: path.basename(file), url: `/api/motion-design/${run.id}/media?path=${encodeURIComponent(file)}`, kind: "image" });
        }
      }
    }
    for (const folder of ["motion-studio/clips", "motion-studio/video", "public"]) {
      for (const file of await listFiles(root, folder)) {
        if (VIDEO.test(file)) {
          present.video = true;
          clips.push({ name: path.basename(file), url: `/api/motion-design/${run.id}/media?path=${encodeURIComponent(file)}`, kind: "video" });
        }
      }
    }
    if (await readText(root, "package.json")) present.build = true;
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
    error: job?.error ?? run.error,
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
  const jobId = run.buildJobId ?? run.proposalJobId;
  const job = jobId ? await readJob(jobId) : undefined;
  let status = run.status;
  let error = run.error;
  let step = run.step;

  if (progress.concepts.length > 0 && !run.approval && !run.codeOnly) {
    status = "awaiting_approval";
    step = "approval";
  }
  if (job?.status === "failed") {
    status = "failed";
    error = job.error ?? "The Claude Code job failed.";
  } else if (job?.status === "cancelled") {
    status = "cancelled";
    error = job.error;
  } else if (job?.status === "completed" && (run.approval || run.codeOnly) && progress.stages.every((stage) => stage.status === "complete" || stage.id === "copy")) {
    status = "completed";
    step = "progress";
  } else if (job && ["running", "preparing", "queued", "validating"].includes(job.status)) {
    status = run.approval ? "building" : "running";
  }

  const next: MotionRun = {
    ...run,
    status,
    step,
    error,
    concepts: progress.concepts.length > 0 ? progress.concepts : run.concepts,
  };
  if (
    next.status === run.status &&
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
  const jobId = run.buildJobId ?? run.proposalJobId;
  const job = jobId ? await readJob(jobId) : undefined;
  const roots = [job?.worktreePath, run.siteRepoPath].filter((root): root is string => Boolean(root));
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
