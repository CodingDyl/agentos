import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AnimateJobSchema,
  ANIMATE_GATES,
  ANIMATE_SKILL_ID,
  ANIMATE_STAGES,
  type AnimateCheckpoint,
  type AnimateJob,
  type AnimateRequest,
  type AnimateSkillState,
  type AnimateStage,
  type AnimateStudio,
  type AnimateStyle,
} from "../../shared/animate-types";
import type { MotionLogEntry } from "../../shared/motion-types";
import type { WorkerJob } from "../../shared/worker-types";
import { recordActivity } from "../activity/ui-events";
import { uiStateDir } from "../agentos/session-store";
import { findOnPath } from "../ai-stack/detect";
import { listConnectors } from "../connectors/registry";
import { listSkills, skillSources, type SkillDeps } from "../skills/registry";
import { activeRunCount } from "../website-rebuild/store";
import { saveJob as saveWorkerJob, readJob as readWorkerJob, appendEvent, createJobId } from "../workers/job-store";
import { createAsset } from "./library";
import { mediaRoot, probeVideo, storeVideo } from "./media";
import {
  alive,
  applyEvent,
  MOTION_ALLOWED_TOOLS,
  MOTION_DENIED_TOOLS,
  motionModel,
  planEnvironment,
  slug,
  stopGroup,
} from "./motion";
import { projectContext, resolveReferences } from "./review-context";

/**
 * Claude Motion: the installed Animate skill, run one gated stage at a time.
 *
 * Animate is written for a person at a keyboard: it asks, shows, waits. Here
 * each stage is its own Claude Code run that does exactly one step of the
 * skill, writes what the person needs to judge it to `checkpoints/<stage>/`
 * and stops. AgentOS shows that checkpoint in Creative. Approving it resumes
 * the same Claude session for the next stage; asking for changes resumes it
 * on the same stage with the note.
 *
 * Process handling is the motion studio's: Claude is started detached with
 * its event stream in a file, so a stage survives AgentOS restarting, and it
 * runs on the Claude Code plan, never the API.
 */

const REPO_NODE_MODULES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules");

const POLL_MS = 1500;
const MAX_LOG = 400;
const GATE_TIMEOUT_MS = 45 * 60 * 1000;
const BUILD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class AnimateUnavailableError extends Error {}

// ---------------------------------------------------------------------------
// The skill
// ---------------------------------------------------------------------------

const skillDeps: SkillDeps = {
  connectors: async () => (await listConnectors()).connectors,
  activeRuns: activeRunCount,
};

interface ResolvedSkill {
  state: AnimateSkillState;
  /** The skill's folder, when it is installed at all. */
  dir?: string;
}

/**
 * Finds the Animate skill among the installed ones. Installed from a plugin
 * marketplace it is `animate@animate`: the skill `animate` of the `animate` plugin.
 */
export async function resolveAnimateSkill(): Promise<ResolvedSkill> {
  const skills = await listSkills(skillDeps).catch(() => []);
  const skill = skills.find((entry) => entry.id === ANIMATE_SKILL_ID);
  if (!skill) return { state: { state: "missing" } };

  const ref = `${skill.id}@${skill.origin?.plugin ?? skill.id}`;
  const source = skillSources().find((entry) => entry.source === skill.source);
  const dir = source ? path.join(source.dir, skill.id) : undefined;

  if (skill.errors.length > 0) return { state: { state: "broken", ref, name: skill.name, errors: skill.errors }, dir };
  if (!skill.enabled) return { state: { state: "disabled", ref, name: skill.name }, dir };
  return { state: { state: "ready", ref, name: skill.name, version: skill.version }, dir };
}

const STYLE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The skill's shipped styles, as the intake gallery shows them. */
async function readStyles(skillDir: string): Promise<AnimateStyle[]> {
  const root = path.join(skillDir, "styles");
  let entries: string[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && STYLE_ID.test(entry.name)).map((entry) => entry.name).sort();
  } catch {
    return [];
  }

  const styles: AnimateStyle[] = [];
  for (const id of entries) {
    const text = await fs.readFile(path.join(root, id, "STYLE.md"), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const blurb =
      text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .find((block) => block && !block.startsWith("#") && !block.startsWith("![")) ?? "";
    styles.push({
      id,
      name: id.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()),
      blurb: blurb.split(/\n\s*[-*] /)[0].replace(/[*`]/g, "").replace(/\s+/g, " ").trim().slice(0, 200),
      sampleUrl: existsSync(path.join(root, id, "sample.png")) ? `/api/designs/animate/styles/${id}/sample.png` : undefined,
    });
  }
  return styles;
}

export async function samplePath(styleId: string): Promise<string | undefined> {
  if (!STYLE_ID.test(styleId)) return undefined;
  const { dir } = await resolveAnimateSkill();
  const file = dir ? path.join(dir, "styles", styleId, "sample.png") : undefined;
  return file && existsSync(file) ? file : undefined;
}

async function missingRequirements(): Promise<string[]> {
  const missing: string[] = [];
  if (!(await findOnPath("claude"))) missing.push("Claude Code (`claude`) is not installed.");
  if (!(await findOnPath("ffmpeg"))) missing.push("ffmpeg is not installed. `brew install ffmpeg`.");
  if (!existsSync(path.join(REPO_NODE_MODULES, "playwright"))) missing.push("Playwright is missing from AgentOS's node_modules.");
  return missing;
}

export async function animateStudio(): Promise<AnimateStudio> {
  const [{ state, dir }, missing] = await Promise.all([resolveAnimateSkill(), missingRequirements()]);
  return { skill: state, styles: state.state === "ready" && dir ? await readStyles(dir) : [], missing };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const StoredAnimateJobSchema = AnimateJobSchema.extend({
  /** The piece's folder name under `pieces/`. */
  piece: z.string(),
  run: z
    .object({
      pid: z.number().int().positive(),
      logFile: z.string(),
      offset: z.number().int().nonnegative(),
      deadline: z.string(),
      cancelRequested: z.boolean().default(false),
    })
    .optional(),
  imported: z.record(z.string(), z.object({ assetId: z.string(), mtimeMs: z.number() })).default({}),
  resultError: z.string().optional(),
  /** What the next run is told, after a decision. */
  pendingPrompt: z.string().optional(),
  /** The worker job ID for this animate run, so it appears in Workers / Today. Stable across syncs. */
  workerJobId: z.string().optional(),
  /** The last tool error captured from the stream, persisted for result event processing. */
  lastToolError: z.string().optional(),
});
type StoredJob = z.infer<typeof StoredAnimateJobSchema>;

const idPattern = /^anm_[a-f0-9]{16}$/;
export const isAnimateId = (id: string) => idPattern.test(id);

function jobsDir(): string {
  return path.join(uiStateDir(), "animate-jobs");
}

function jobFile(id: string): string {
  if (!isAnimateId(id)) throw new Error(`Invalid animate job id: ${id}`);
  return path.join(jobsDir(), `${id}.json`);
}

export function studioDir(id: string): string {
  if (!isAnimateId(id)) throw new Error(`Invalid animate job id: ${id}`);
  return path.join(mediaRoot(), "animate", id);
}

const saving = new Map<string, Promise<void>>();

function save(job: StoredJob): Promise<void> {
  const previous = saving.get(job.id) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.mkdir(jobsDir(), { recursive: true });
    const target = jobFile(job.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
  });
  saving.set(job.id, next.catch(() => undefined));
  return next;
}

async function read(id: string): Promise<StoredJob | undefined> {
  try {
    const parsed = StoredAnimateJobSchema.safeParse(JSON.parse(await fs.readFile(jobFile(id), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readAll(): Promise<StoredJob[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir());
  } catch {
    return [];
  }
  const jobs = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) => read(entry.replace(/\.json$/, ""))));
  return jobs.filter((job): job is StoredJob => job !== undefined);
}

function toWire(job: StoredJob): AnimateJob {
  return AnimateJobSchema.parse(job);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const STAGE_TASK: Record<AnimateStage, (piece: string) => string> = {
  story: (piece) =>
    [
      "Do step 1 of the skill only: the Story check. Intake (step 0) is answered above — do not ask for anything.",
      "If the operator left the style open, pick the best shipped style from skill/styles/README.md and say why.",
      "Web-check every factual claim and list each with its source.",
      "Write `checkpoints/story/notes.md` for the operator to read: the one-line idea and the sayable device; the format and why; the style, length and BPM;",
      "a numbered beat table (time, what happens, the bridge into the next beat, the sound's role); and the claims with sources.",
      `The piece will live at pieces/${piece}/. Do not create it yet. No frames at this stage.`,
    ].join(" "),
  look: (piece) =>
    [
      `Do step 2 of the skill only: the Look check. Start the piece at pieces/${piece}/ as the skill says, set its style, and draw the 2 to 4 most different beats as full-size frames.`,
      "Check each against grammar/FRAME.md and the style's own checklist.",
      "Render them with the skill's still tool into `checkpoints/look/` as look-1.png, look-2.png and so on (or one side-by-side look.png).",
      "Write `checkpoints/look/notes.md`: which beat each frame is, and what the operator should judge in it.",
    ].join(" "),
  storyboard: (piece) =>
    [
      `Do step 3 of the skill only: the Storyboard check for pieces/${piece}/. Draw every beat in the approved look and fill TIMELINE.board with one key time per beat.`,
      "Render the board with the skill's storyboard tool to `checkpoints/storyboard/board.png`, and each panel on its own as panel-1.png, panel-2.png and so on if the tool can.",
      "Write `checkpoints/storyboard/notes.md`: a numbered list, one line per panel — title, sound, transition into the next — so the operator can answer by panel number.",
    ].join(" "),
  build: (piece) =>
    [
      `Do steps 4 and 5 of the skill: Build, then Deliver, for pieces/${piece}/. Animate the scenes, build, test tiles across every morph and cut, write the score, export with --share for every requested format, and run tools/review.mjs until it passes. View the contact sheets.`,
      "The final MP4s must be in pieces/" + piece + "/renders/ (share.mp4 and final.mp4, plus a final-<w>x<h>.mp4 per extra format).",
      "Then write `checkpoints/delivery/notes.md`: what the video is, the review checks' numbers (not 'looks good'), what the review caught and fixed, the weakest shot, and what you could not verify (you cannot listen to the score).",
      "End with that same short summary.",
    ].join(" "),
};

function intakeBlock(request: AnimateRequest, brandFiles: string[], context: string): string {
  return [
    "## Intake (already answered by the operator — do not ask)",
    `- About: ${request.topic}`,
    request.brief ? `- Brief: ${request.brief}` : undefined,
    `- Style: ${request.style ? `${request.style} (a shipped style)` : "operator has no preference — recommend one"}`,
    `- Length: about ${request.durationSec}s`,
    `- Formats: ${request.formats.join(", ")} (the first is the master)`,
    "- Voice-over: no. Music track: no. Use a composed score.",
    brandFiles.length > 0
      ? `- Reference images in assets/ (use them as the operator's own screenshots/logos, or as look references): ${brandFiles.join(", ")}`
      : "- Reference images: none",
    context ? `\n## Workspace context (${request.project})\n\n${context}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function firstPrompt(request: AnimateRequest, piece: string, brandFiles: string[], context: string): string {
  return [
    "You are running the Animate skill inside AgentOS, unattended. Your working directory is the studio.",
    "The skill is in ./skill — read ./skill/SKILL.md now and follow it, with these AgentOS rules that override it:",
    "- Its tools run as `node skill/tools/<tool>.mjs`; its files are under ./skill. Pieces live in ./pieces/<name>/ in this folder.",
    "- You cannot ask the operator questions. The skill's AskUserQuestion check-ins are replaced by review gates in AgentOS: you run ONE stage, write its checkpoint under `checkpoints/<stage>/`, and stop. Never run ahead to the next stage.",
    "- Never animate before the storyboard is approved. Never claim a fact on screen you did not check.",
    "- Playwright and ffmpeg are installed. If something is genuinely missing, say so in your closing message and stop.",
    `- The piece name is \`${piece}\`.`,
    "",
    intakeBlock(request, brandFiles, context),
    "",
    "## This run",
    STAGE_TASK.story(piece),
    "Finish with one short sentence saying the checkpoint is ready.",
  ].join("\n");
}

const RESUME_PROMPT = [
  "AgentOS restarted or the operator asked you to carry on. Continue the current stage from where you stopped:",
  "check what is already in pieces/ and checkpoints/, finish the stage, write its checkpoint, and stop.",
].join(" ");

function nextStagePrompt(approved: AnimateStage, next: AnimateStage, piece: string, note?: string): string {
  return [
    `The operator approved the ${approved}.`,
    note ? `Their remark: ${note}` : undefined,
    STAGE_TASK[next](piece),
    next === "build" ? undefined : "Finish with one short sentence saying the checkpoint is ready.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function changesPrompt(stage: AnimateStage, note: string): string {
  return [
    `The operator reviewed the ${stage} and wants changes:`,
    "",
    note.trim(),
    "",
    `Make them, redo the ${stage} checkpoint in checkpoints/${stage}/ (replace the files, same names), and stop. Do not move to the next stage.`,
  ].join("\n");
}

function revisionPrompt(note: string): string {
  return [
    "The operator watched the finished video and wants changes:",
    "",
    note.trim(),
    "",
    "Make them, rebuild, re-export every format to the same renders/ names, run tools/review.mjs again, and rewrite checkpoints/delivery/notes.md with the new numbers. End with the same short summary.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Worker job integration
// ---------------------------------------------------------------------------

/**
 * Creates or updates a worker job for this animate run, so it appears in
 * Workers / Today. Uses a stable ID that never changes once set.
 */
export async function syncWorkerJob(job: StoredJob): Promise<void> {
  // Use stable ID: workerJobId if it exists, otherwise create a new one
  // Never change once set to avoid duplicate jobs
  const workerJobId = job.workerJobId ?? createJobId();
  
  // Store the worker job ID if it's new
  if (!job.workerJobId) {
    job.workerJobId = workerJobId;
    await save(job);
  }
  
  // Determine worker job status from animate status
  let workerStatus: WorkerJob["status"];
  let error: string | undefined;
  
  if (job.status === "queued" || job.status === "running") {
    workerStatus = "running";
  } else if (job.status === "awaiting_review") {
    workerStatus = "awaiting_review";
  } else if (job.status === "completed") {
    workerStatus = "completed";
  } else if (job.status === "failed") {
    workerStatus = "failed";
    error = job.error;
  } else if (job.status === "cancelled") {
    workerStatus = "cancelled";
  } else {
    workerStatus = "failed";
    error = job.error ?? "Run was interrupted.";
  }
  
  const existing = await readWorkerJob(workerJobId);
  
  const workerJob: WorkerJob = {
    id: workerJobId,
    worker: "claude-code",
    resolvedWorker: "claude-code",
    status: workerStatus,
    project: job.request.project ?? "unassigned",
    objective: `Claude Motion · ${job.title} · ${job.stage === "story" ? "Story check" : job.stage === "look" ? "Look" : job.stage === "storyboard" ? "Storyboard" : "Build and delivery"}`,
    createdAt: existing?.createdAt ?? job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error,
    result: job.status === "completed" || job.status === "failed" ? {
      summary: job.summary ?? (job.status === "completed" ? `Completed ${job.title}` : job.error ?? "Run failed"),
      artifacts: job.assetIds.map((assetId) => ({
        title: `Video asset ${assetId}`,
        path: `/designs?asset=${assetId}`,
        type: "video",
      })),
    } : undefined,
    // Always update lastEventAt on sync so Workers shows current activity
    lastEventAt: new Date().toISOString(),
  };
  
  await saveWorkerJob(workerJob);
  
  // Record failure events only once when transitioning into failed status
  // Check if this is the first time entering failed (compare against existing status)
  const justFailed = workerStatus === "failed" && existing && existing.status !== "failed";
  
  if (justFailed && error) {
    // This is the first failed state - record the error as an event
    await appendEvent({
      id: crypto.randomUUID(),
      jobId: workerJobId,
      timestamp: new Date().toISOString(),
      type: "job.failed",
      message: error,
      metadata: {
        stage: job.stage,
        animateJobId: job.id,
        sessionId: job.sessionId,
      },
    });
    
    // Include recent log lines as context
    const recentLogs = job.log.slice(-5).filter(entry => entry.kind !== "system");
    for (const logEntry of recentLogs) {
      await appendEvent({
        id: crypto.randomUUID(),
        jobId: workerJobId,
        timestamp: logEntry.at,
        type: "job.progress",
        message: logEntry.kind === "tool" ? `Tool: ${logEntry.message}` : logEntry.message,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

async function seedStudio(dir: string, skillDir: string): Promise<void> {
  for (const folder of ["assets", "pieces", "checkpoints", ".agentos"]) await fs.mkdir(path.join(dir, folder), { recursive: true });
  // A copy, so a skill update never changes a video that is half made.
  await fs.cp(skillDir, path.join(dir, "skill"), { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules`) });
  // Linked, not installed: Playwright and its Chromium are AgentOS's own.
  await fs.symlink(REPO_NODE_MODULES, path.join(dir, "node_modules"), "dir").catch(() => undefined);
}

export async function createAnimateJob(request: AnimateRequest): Promise<AnimateJob> {
  const resolved = await resolveAnimateSkill();
  if (resolved.state.state !== "ready" || !resolved.dir) {
    throw new AnimateUnavailableError(
      resolved.state.state === "missing"
        ? "The Animate skill is not installed. Install it from Connectors → Skills."
        : resolved.state.state === "disabled"
          ? "The Animate skill is switched off. Turn it on in Connectors → Skills."
          : "The Animate skill has problems. Open Connectors → Skills.",
    );
  }
  const missing = await missingRequirements();
  if (missing.length > 0) throw new AnimateUnavailableError(missing.join(" "));

  if (request.style) {
    const styles = await readStyles(resolved.dir);
    if (!styles.some((style) => style.id === request.style)) throw new AnimateUnavailableError(`Animate has no style called ${request.style}.`);
  }

  const id = `anm_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const dir = studioDir(id);
  await seedStudio(dir, resolved.dir);

  const { references } = await resolveReferences(request.referenceAssetIds);
  const brandFiles: string[] = [];
  for (const [index, reference] of references.entries()) {
    const extension = path.extname(reference.path);
    const name = `${String(index + 1).padStart(2, "0")}-${slug(path.basename(reference.filename, path.extname(reference.filename)), "asset")}${extension}`;
    await fs.copyFile(reference.path, path.join(dir, "assets", name));
    brandFiles.push(name);
  }

  const context = request.project ? await projectContext(request.project).catch(() => "") : "";
  const piece = slug(request.topic, "piece");
  const prompt = firstPrompt(request, piece, brandFiles, context);

  const job: StoredJob = {
    id,
    title: request.topic.slice(0, 72),
    status: "queued",
    stage: "story",
    request,
    skill: { id: ANIMATE_SKILL_ID, ref: resolved.state.ref, name: resolved.state.name, version: resolved.state.version },
    model: motionModel(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    log: [{ at: new Date().toISOString(), kind: "system", message: `Studio set up with ${resolved.state.ref} ${resolved.state.version}. Waiting for Claude Code.` }],
    checkpoints: [],
    revisions: [],
    assetIds: [],
    prompt,
    piece,
    imported: {},
  };

  await save(job);
  void pump();
  return toWire(job);
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function effortFor(stage: AnimateStage): string {
  return process.env.AGENTOS_ANIMATE_EFFORT?.trim() || (stage === "build" ? "max" : "high");
}

export function animateClaudeArgs(job: Pick<StoredJob, "prompt" | "sessionId" | "attempts" | "model" | "pendingPrompt" | "stage">): string[] {
  const resume = job.attempts > 0 && job.sessionId;
  const prompt = resume ? (job.pendingPrompt ?? RESUME_PROMPT) : job.pendingPrompt ? `${job.prompt}\n\n${job.pendingPrompt}` : job.prompt;
  return [
    ...(resume ? ["--resume", job.sessionId!] : []),
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--model",
    job.model || motionModel(),
    "--effort",
    effortFor(job.stage),
    "--allowedTools",
    ...MOTION_ALLOWED_TOOLS,
    // Animate checks every on-screen claim against the web.
    "WebSearch",
    "--disallowedTools",
    ...MOTION_DENIED_TOOLS,
  ];
}

let starting = false;

/** One stage at a time: renders are CPU-bound. A film waiting for review does not hold the slot. */
async function pump(): Promise<void> {
  if (starting) return;
  starting = true;
  try {
    const jobs = await readAll();
    if (jobs.some((job) => job.status === "running")) return;
    const next = jobs.filter((job) => job.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (next) await start(next);
  } finally {
    starting = false;
  }
}

function timeoutMs(stage: AnimateStage): number {
  const configured = Number(process.env.AGENTOS_ANIMATE_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return stage === "build" ? BUILD_TIMEOUT_MS : GATE_TIMEOUT_MS;
}

function pushLog(job: StoredJob, kind: MotionLogEntry["kind"], message: string): void {
  job.log.push({ at: new Date().toISOString(), kind, message });
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
}

async function start(job: StoredJob): Promise<void> {
  const binary = await findOnPath("claude");
  if (!binary) {
    await finishWith(job, "failed", "Claude Code (`claude`) is not installed.");
    return;
  }

  const dir = studioDir(job.id);
  const attempt = job.attempts + 1;
  const logFile = path.join(".agentos", `run-${attempt}.jsonl`);
  await fs.mkdir(path.join(dir, ".agentos"), { recursive: true });
  const out = openSync(path.join(dir, logFile), "a");
  const err = openSync(path.join(dir, ".agentos", `run-${attempt}.stderr.log`), "a");

  const args = animateClaudeArgs(job);
  job.attempts = attempt;
  job.pendingPrompt = undefined;

  let pid: number | undefined;
  try {
    const child = spawn(binary, args, { cwd: dir, env: planEnvironment(), stdio: ["ignore", out, err], detached: true });
    pid = child.pid;
    child.on("exit", () => void tick(job.id));
    child.on("error", () => void tick(job.id));
    child.unref();
  } finally {
    closeSync(out);
    closeSync(err);
  }

  if (!pid) {
    await finishWith(job, "failed", "Claude Code could not be started.");
    return;
  }

  job.status = "running";
  job.startedAt = job.startedAt ?? new Date().toISOString();
  job.error = undefined;
  job.resultError = undefined;
  job.run = { pid, logFile, offset: 0, deadline: new Date(Date.now() + timeoutMs(job.stage)).toISOString(), cancelRequested: false };
  pushLog(job, "system", `${attempt === 1 ? "Claude Code started" : "Claude Code resumed"} · ${job.model} · ${job.stage}`);
  await save(job);

  if (attempt === 1) {
    await recordActivity({ type: "motion.started", description: `Claude Motion: ${job.title}`, project: job.request.project, metadata: { animateJobId: job.id } });
  }
  
  // Create/update worker job so it appears in Workers / Today
  await syncWorkerJob(job);
  
  watch(job.id);
}

const watchers = new Map<string, NodeJS.Timeout>();
const ticking = new Set<string>();

function watch(id: string): void {
  if (watchers.has(id)) return;
  watchers.set(id, setInterval(() => void tick(id), POLL_MS));
}

function unwatch(id: string): void {
  clearInterval(watchers.get(id));
  watchers.delete(id);
}

async function readNewLines(job: StoredJob): Promise<number> {
  if (!job.run) return 0;
  const file = path.join(studioDir(job.id), job.run.logFile);
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(file, "r");
    const { size } = await handle.stat();
    if (size <= job.run.offset) return 0;
    const length = Math.min(size - job.run.offset, 8 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, job.run.offset);
    const text = buffer.toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) return 0;
    const lines = text.slice(0, lastNewline).split("\n");
    
    // The motion studio's event reader: same stream, same record shape.
    const view = job as unknown as Parameters<typeof applyEvent>[0];
    for (const line of lines) {
      if (line.trim()) {
        applyEvent(view, line);
      }
    }
    
    // Add stderr as fallback if resultError was set but no tool error was captured
    if (job.resultError && !job.lastToolError) {
      const stderr = await stderrTail(job);
      if (stderr) {
        job.resultError = `Error: ${stderr}`;
      }
    }
    
    job.run.offset += Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8");
    return lines.length;
  } catch {
    return 0;
  } finally {
    await handle?.close();
  }
}

async function tick(id: string): Promise<void> {
  if (ticking.has(id)) return;
  ticking.add(id);
  try {
    const job = await read(id);
    if (!job || job.status !== "running" || !job.run) {
      unwatch(id);
      return;
    }

    const lines = await readNewLines(job);

    if (alive(job.run.pid)) {
      const overdue = Date.parse(job.run.deadline) < Date.now();
      if (overdue) {
        stopGroup(job.run.pid);
        job.resultError = `Claude Code did not finish the ${job.stage} within ${Math.round(timeoutMs(job.stage) / 60_000)} minutes and was stopped.`;
      }
      if (lines > 0 || overdue) await save(job);
      return;
    }

    await readNewLines(job);
    unwatch(id);
    await settle(job);
  } finally {
    ticking.delete(id);
  }
}

async function stderrTail(job: StoredJob): Promise<string> {
  try {
    const text = await fs.readFile(path.join(studioDir(job.id), ".agentos", `run-${job.attempts}.stderr.log`), "utf8");
    return text.trim().split("\n").filter(Boolean).slice(-3).join(" ");
  } catch {
    return "";
  }
}

const IMAGE_NAME = /^[A-Za-z0-9][\w.-]{0,80}\.(png|jpe?g|webp)$/;

async function readCheckpoint(job: StoredJob, stage: AnimateStage, fallbackNotes: string | undefined): Promise<AnimateCheckpoint | undefined> {
  const folder = path.join(studioDir(job.id), "checkpoints", stage === "build" ? "delivery" : stage);
  const notes = (await fs.readFile(path.join(folder, "notes.md"), "utf8").catch(() => "")).trim() || fallbackNotes?.trim() || "";
  const names = (await fs.readdir(folder).catch(() => [] as string[])).filter((name) => IMAGE_NAME.test(name));
  const stats = await Promise.all(names.map(async (name) => ({ name, at: (await fs.stat(path.join(folder, name)).catch(() => undefined))?.mtimeMs ?? 0 })));
  const images = stats
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map(({ name, at }) => ({ name, url: `/api/designs/animate/${job.id}/checkpoints/${stage}/${name}?v=${Math.round(at)}` }));
  if (!notes && images.length === 0) return undefined;
  return { stage, at: new Date().toISOString(), notes, images };
}

/** The file served for a checkpoint frame. Names are matched, never joined blindly. */
export function checkpointImagePath(id: string, stage: string, name: string): string | undefined {
  if (!isAnimateId(id) || !(ANIMATE_STAGES as readonly string[]).includes(stage) || !IMAGE_NAME.test(name)) return undefined;
  return path.join(studioDir(id), "checkpoints", stage === "build" ? "delivery" : stage, name);
}

async function settle(job: StoredJob): Promise<void> {
  if (job.run?.cancelRequested) {
    await finishWith(job, "cancelled", undefined);
    return;
  }

  const stage = job.stage;
  const isGate = (ANIMATE_GATES as readonly string[]).includes(stage);

  if (isGate) {
    const checkpoint = await readCheckpoint(job, stage, job.summary);
    const needsFrames = stage === "look" || stage === "storyboard";
    if (checkpoint && (!needsFrames || checkpoint.images.length > 0) && !job.resultError) {
      job.checkpoints.push(checkpoint);
      job.status = "awaiting_review";
      job.completedAt = undefined;
      job.error = undefined;
      if (job.run) job.run = { ...job.run, cancelRequested: false };
      pushLog(job, "system", `${checkpoint.stage === "story" ? "Story check" : stage === "look" ? "Look" : "Storyboard"} is ready for your review.`);
      await save(job);
      await syncWorkerJob(job);
      void pump();
      return;
    }
    const reason =
      job.resultError ??
      (checkpoint ? `Claude stopped before drawing the ${stage} frames.` : (await stderrTail(job)) || `Claude Code stopped without leaving the ${stage} checkpoint.`);
    await finishWith(job, "failed", reason);
    return;
  }

  const filed = await fileOutputs(job);
  // Never mark as completed when resultError exists, even if videos were filed
  if (job.resultError) {
    pushLog(job, "system", filed > 0 ? `Filed ${filed} video${filed === 1 ? "" : "s"}, but the build failed validation.` : "No videos to file.");
    await finishWith(job, "failed", job.resultError);
    return;
  }
  if (job.assetIds.length > 0) {
    const delivery = await readCheckpoint(job, "build", job.summary);
    if (delivery) job.checkpoints.push(delivery);
    pushLog(job, "system", filed > 0 ? `Filed ${filed} video${filed === 1 ? "" : "s"} in Creative.` : "No new renders to file.");
    await finishWith(job, "completed", undefined);
    return;
  }
  const reason = (await stderrTail(job)) || "Claude Code stopped without leaving a video in renders/. Resume to let it carry on.";
  await finishWith(job, "failed", reason);
}

async function finishWith(job: StoredJob, status: "completed" | "failed" | "cancelled", error: string | undefined): Promise<void> {
  job.status = status;
  job.error = error;
  job.completedAt = new Date().toISOString();
  if (job.run) job.run = { ...job.run, cancelRequested: false };
  pushLog(job, "system", status === "completed" ? "Done." : status === "cancelled" ? "Cancelled." : `Failed: ${error}`);
  await save(job);

  if (status !== "cancelled") {
    await recordActivity({
      type: status === "completed" ? "motion.completed" : "motion.failed",
      description: status === "completed" ? `Claude Motion: ${job.title}` : `Claude Motion: ${job.title}: ${error}`,
      project: job.request.project,
      metadata: { animateJobId: job.id, assets: job.assetIds.length },
    });
  }
  
  // Update worker job with final status
  await syncWorkerJob(job);
  
  void pump();
}

/**
 * Files the finished MP4s into Creative. `share.mp4` and its per-format
 * siblings are what Animate hands over; `final*.mp4` are the fallback when no
 * share cut was made. A file already filed and unchanged since is skipped.
 */
async function fileOutputs(job: StoredJob): Promise<number> {
  const rendersDir = path.join(studioDir(job.id), "pieces", job.piece, "renders");
  let names: string[];
  try {
    names = (await fs.readdir(rendersDir)).filter((name) => /\.(mp4|mov|webm)$/i.test(name) && !name.startsWith("."));
  } catch {
    return 0;
  }
  const shares = names.filter((name) => name.startsWith("share"));
  const chosen = (shares.length > 0 ? shares : names.filter((name) => name.startsWith("final"))).sort();

  let filed = 0;
  for (const name of chosen) {
    const file = path.join(rendersDir, name);
    const stat = await fs.stat(file).catch(() => undefined);
    if (!stat) continue;
    if (job.imported[name]?.mtimeMs === stat.mtimeMs) continue;

    const probe = await probeVideo(file);
    if (!probe?.durationSec) {
      pushLog(job, "system", `Skipped ${name}: not a readable video.`);
      continue;
    }

    const id = crypto.randomUUID();
    const extension = path.extname(name).toLowerCase();
    const stored = await storeVideo(id, extension, { path: file });
    const format = /(\d+)x(\d+)/.exec(name)?.slice(1).join(":") ?? job.request.formats[0];
    const asset = await createAsset({
      id,
      filename: `${slug(job.title)}${/^(share|final)\.mp4$/i.test(name) ? "" : `-${slug(path.basename(name, extension))}`}${extension}`,
      storedName: stored.storedName,
      hasThumbnail: stored.hasThumbnail,
      dimensions: stored.dimensions,
      durationSec: stored.durationSec,
      type: "generated",
      mediaType: "video",
      source: "agentos",
      provider: "claude-code",
      model: job.model,
      project: job.request.project,
      product: job.request.productTag,
      tags: ["motion", "animate", format],
      prompt: `Claude Motion · Animate · ${job.request.topic}`.slice(0, 2000),
      generationId: job.id,
      referenceAssetIds: job.request.referenceAssetIds,
    });

    job.imported[name] = { assetId: asset.id, mtimeMs: stat.mtimeMs };
    job.assetIds.push(asset.id);
    filed += 1;
  }
  return filed;
}

// ---------------------------------------------------------------------------
// Operator actions
// ---------------------------------------------------------------------------

export async function listAnimateJobs(): Promise<AnimateJob[]> {
  return (await readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toWire);
}

export async function readAnimateJob(id: string): Promise<AnimateJob | undefined> {
  if (!isAnimateId(id)) return undefined;
  const job = await read(id);
  return job ? toWire(job) : undefined;
}

export async function cancelAnimateJob(id: string): Promise<AnimateJob | undefined> {
  const job = await read(id);
  if (!job) return undefined;
  if (job.status === "queued" || job.status === "awaiting_review") {
    await finishWith(job, "cancelled", undefined);
  } else if (job.status === "running" && job.run) {
    job.run.cancelRequested = true;
    pushLog(job, "system", "Stopping…");
    await save(job);
    stopGroup(job.run.pid);
  }
  return toWire(job);
}

/** A person's answer at a review gate. */
export async function decideAnimateJob(id: string, decision: "approve" | "changes", note?: string): Promise<AnimateJob | { error: string } | undefined> {
  const job = await read(id);
  if (!job) return undefined;
  if (job.status !== "awaiting_review") return { error: "This video isn't waiting for a review." };

  const checkpoint = [...job.checkpoints].reverse().find((entry) => entry.stage === job.stage && !entry.decision);
  if (!checkpoint) return { error: "There is nothing to review." };
  const at = new Date().toISOString();
  checkpoint.decidedAt = at;

  if (decision === "changes") {
    const text = note?.trim();
    if (!text) return { error: "Say what should change." };
    checkpoint.decision = "changes";
    checkpoint.note = text;
    job.pendingPrompt = changesPrompt(job.stage, text);
    pushLog(job, "system", `Changes asked for on the ${job.stage}.`);
  } else {
    checkpoint.decision = "approved";
    checkpoint.note = note?.trim() || undefined;
    const next = ANIMATE_STAGES[ANIMATE_STAGES.indexOf(job.stage) + 1];
    job.pendingPrompt = nextStagePrompt(job.stage, next, job.piece, checkpoint.note);
    pushLog(job, "system", `${job.stage === "story" ? "Story" : job.stage === "look" ? "Look" : "Storyboard"} approved.`);
    job.stage = next;
  }
  job.status = "queued";
  await save(job);
  void pump();
  return toWire(job);
}

/** Carries a stopped stage on, or — with a note — revises a delivered video. */
export async function resumeAnimateJob(id: string, note?: string): Promise<AnimateJob | undefined> {
  const job = await read(id);
  if (!job) return undefined;
  if (!["failed", "cancelled", "interrupted", "completed"].includes(job.status)) return toWire(job);
  if (job.status === "completed" && !note?.trim()) return toWire(job);

  if (job.status === "completed") {
    job.stage = "build";
    job.pendingPrompt = revisionPrompt(note!);
    job.revisions.push({ at: new Date().toISOString(), note: note!.trim() });
  }
  job.status = "queued";
  job.error = undefined;
  job.completedAt = undefined;
  pushLog(job, "system", note?.trim() ? "Queued to revise." : "Queued to resume.");
  await save(job);
  void pump();
  return toWire(job);
}

export async function reconcileAnimateJobs(): Promise<void> {
  for (const job of await readAll()) {
    if (job.status !== "running") continue;
    if (job.run && alive(job.run.pid)) watch(job.id);
    else await tick(job.id);
  }
  await pump();
}
