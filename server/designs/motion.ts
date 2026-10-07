import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  MotionJobSchema,
  MotionRoundSchema,
  type MotionJob,
  type MotionJobDetail,
  type MotionJobRequest,
  type MotionLogEntry,
  type MotionRound,
  type MotionStudioInfo,
} from "../../shared/motion-types";
import { recordActivity } from "../activity/ui-events";
import { uiStateDir } from "../agentos/session-store";
import { findOnPath } from "../ai-stack/detect";
import { createAsset } from "./library";
import { mediaRoot, probeVideo, storeVideo } from "./media";
import { buildStudioPrompt, fillTemplate, readMotionPrompts } from "./motion-prompts";
import { projectContext, resolveReferences } from "./review-context";

/**
 * The motion studio runner.
 *
 * A film takes Claude Code twenty minutes or more: write the film, render
 * contact sheets, score them, fix, render. That is far longer than AgentOS
 * stays up while it is being worked on — every save under `server/` restarts
 * it — so a film is not run *inside* AgentOS the way worker jobs are.
 *
 * Instead Claude Code is started detached, in its own process group, with its
 * event stream written to a file in the studio. AgentOS reads that file as it
 * grows. When AgentOS restarts, it finds the film still running by its pid and
 * carries on reading from where it stopped. Nothing about a film depends on
 * the process that started it still being alive.
 *
 * It runs on the operator's Claude Code plan: the API key is removed from its
 * environment so a film can never quietly bill the API instead.
 */

const KIT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "motion-kit");
const REPO_NODE_MODULES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules");

/** A film that has not finished in this long is stuck, not ambitious. */
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const POLL_MS = 1500;
const MAX_LOG = 400;

/** What Claude Code may do in a studio without asking. Anything else is refused. */
export const MOTION_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Write",
  "Edit",
  "WebFetch",
  "Bash(node:*)",
  "Bash(npx:*)",
  "Bash(ffmpeg:*)",
  "Bash(ffprobe:*)",
  "Bash(ls:*)",
  "Bash(mkdir:*)",
  "Bash(cp:*)",
  "Bash(mv:*)",
  "Bash(cat:*)",
  "Bash(head:*)",
  "Bash(file:*)",
  "Bash(sips:*)",
];

/** Refused whatever the brief says. */
export const MOTION_DENIED_TOOLS = [
  "Bash(rm -rf:*)",
  "Bash(sudo:*)",
  "Bash(git push:*)",
  "Bash(git commit:*)",
  "Bash(curl:*)",
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Edit(**/.env)",
];

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** What is kept on disk: the wire job, plus how to find its process and output. */
const StoredMotionJobSchema = MotionJobSchema.extend({
  run: z
    .object({
      pid: z.number().int().positive(),
      /** Studio-relative. */
      logFile: z.string(),
      /** Bytes of the log already read. Only complete lines are ever consumed. */
      offset: z.number().int().nonnegative(),
      deadline: z.string(),
      cancelRequested: z.boolean().default(false),
    })
    .optional(),
  /** Out-file → asset, so a resumed film files only what changed. */
  imported: z.record(z.string(), z.object({ assetId: z.string(), mtimeMs: z.number() })).default({}),
  resultError: z.string().optional(),
  /** The operator's changes, waiting for the next run to pick them up. */
  pendingNote: z.string().optional(),
});
type StoredMotionJob = z.infer<typeof StoredMotionJobSchema>;

const idPattern = /^mot_[a-f0-9]{16}$/;
export const isMotionId = (id: string) => idPattern.test(id);

function jobsDir(): string {
  return path.join(uiStateDir(), "motion-jobs");
}

function jobFile(id: string): string {
  if (!isMotionId(id)) throw new Error(`Invalid motion job id: ${id}`);
  return path.join(jobsDir(), `${id}.json`);
}

/** Where films are made. Beside the media they become, outside the vault. */
export function studioDir(id: string): string {
  if (!isMotionId(id)) throw new Error(`Invalid motion job id: ${id}`);
  return path.join(mediaRoot(), "motion", id);
}

/** Saves are chained per job, so two writes never race on one temporary file. */
const saving = new Map<string, Promise<void>>();

function save(job: StoredMotionJob): Promise<void> {
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

async function read(id: string): Promise<StoredMotionJob | undefined> {
  try {
    const parsed = StoredMotionJobSchema.safeParse(JSON.parse(await fs.readFile(jobFile(id), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readAll(): Promise<StoredMotionJob[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir());
  } catch {
    return [];
  }
  const jobs = await Promise.all(
    entries.filter((entry) => entry.endsWith(".json")).map((entry) => read(entry.replace(/\.json$/, ""))),
  );
  return jobs.filter((job): job is StoredMotionJob => job !== undefined);
}

/** The browser's view: no pids, no paths. */
function toWire(job: StoredMotionJob): MotionJob {
  // Parsing against the wire schema drops every server-only field.
  return MotionJobSchema.parse(job);
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export function motionModel(): string {
  return process.env.AGENTOS_MOTION_MODEL?.trim() || "opus";
}

async function missingRequirements(): Promise<string[]> {
  const missing: string[] = [];
  if (!(await findOnPath("claude"))) missing.push("Claude Code (`claude`) is not installed.");
  if (!(await findOnPath("ffmpeg"))) missing.push("ffmpeg is not installed. `brew install ffmpeg`.");
  if (!(await findOnPath("ffprobe"))) missing.push("ffprobe is not installed. It comes with ffmpeg.");
  if (!existsSync(path.join(REPO_NODE_MODULES, "playwright"))) missing.push("Playwright is missing from AgentOS's node_modules.");
  return missing;
}

export async function studioInfo(): Promise<MotionStudioInfo> {
  const [prompts, missing] = await Promise.all([readMotionPrompts(), missingRequirements()]);
  return { ...prompts, readiness: { ready: missing.length === 0, missing } };
}

// ---------------------------------------------------------------------------
// Creating a film
// ---------------------------------------------------------------------------

/** A filesystem-safe version of a label, for names Claude and the operator will read. */
export function slug(text: string, fallback = "film"): string {
  const cleaned = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return cleaned || fallback;
}

async function seedStudio(dir: string, request: MotionJobRequest): Promise<void> {
  await fs.mkdir(path.join(dir, "assets", "brand"), { recursive: true });
  await fs.mkdir(path.join(dir, "sheet"), { recursive: true });
  await fs.mkdir(path.join(dir, "out"), { recursive: true });
  await fs.mkdir(path.join(dir, ".agentos"), { recursive: true });
  await fs.cp(KIT_DIR, dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "film.config.json"),
    `${JSON.stringify({ duration: request.durationSec, fps: 30, bpm: 120, formats: request.formats, motionBlur: 1 }, null, 2)}\n`,
  );
  // Linked, not installed: Playwright and its Chromium are AgentOS's own.
  await fs.symlink(REPO_NODE_MODULES, path.join(dir, "node_modules"), "dir").catch(() => undefined);
}

export async function createMotionJob(request: MotionJobRequest): Promise<MotionJob> {
  const missing = await missingRequirements();
  if (missing.length > 0) throw new MotionUnavailableError(missing.join(" "));

  const prompts = await readMotionPrompts();
  const template = prompts.templates.find((entry) => entry.id === request.template)!;
  const brief = fillTemplate(request.template, template.text, request);

  const id = `mot_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const dir = studioDir(id);
  await seedStudio(dir, request);

  // Brand material: copies, so the studio can be reworked freely.
  const { references } = await resolveReferences(request.referenceAssetIds);
  const brandFiles: string[] = [];
  for (const [index, reference] of references.entries()) {
    const extension = path.extname(reference.path);
    const name = `${String(index + 1).padStart(2, "0")}-${slug(path.basename(reference.filename, path.extname(reference.filename)), "asset")}${extension}`;
    await fs.copyFile(reference.path, path.join(dir, "assets", "brand", name));
    brandFiles.push(name);
  }

  const context = request.project ? await projectContext(request.project).catch(() => "") : "";
  await fs.writeFile(
    path.join(dir, "BRIEF.md"),
    [`# Brief`, "", brief, request.template !== "custom" && request.brief ? `\n## Further direction\n\n${request.brief}` : "",
      context ? `\n## Workspace context (${request.project})\n\n${context}` : ""].join("\n"),
  );

  const title =
    request.template === "custom"
      ? (request.product?.trim() || request.brief!.split("\n")[0]).slice(0, 72)
      : `${request.product} · ${template.label}`;

  const job: StoredMotionJob = {
    id,
    title,
    status: "queued",
    request,
    prompt: buildStudioPrompt({ request, rules: prompts.rules.text, brief, brandFiles, hasWorkspaceContext: Boolean(context) }),
    promptSources: { rules: prompts.rules.source, template: template.source },
    model: motionModel(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    log: [{ at: new Date().toISOString(), kind: "system", message: "Studio set up. Waiting for Claude Code." }],
    assetIds: [],
    revisions: [],
    imported: {},
  };

  await save(job);
  void pump();
  return toWire(job);
}

export class MotionUnavailableError extends Error {}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const RESUME_PROMPT = [
  "AgentOS restarted or the operator asked you to carry on. Continue this film from where you stopped:",
  "check what is already in sheet/, scores.json and out/, then finish the loop and the render as briefed.",
  "End with the same short summary.",
].join(" ");

export function revisionPrompt(note: string): string {
  return [
    "The operator watched the film and wants changes:",
    "",
    note.trim(),
    "",
    "Make them, run your review loop again (continue the round numbering in sheet/ and scores.json),",
    "then re-render every format to the same out/ names. End with the same short summary.",
  ].join("\n");
}

export function claudeArgs(
  job: Pick<StoredMotionJob, "prompt" | "sessionId" | "attempts" | "request" | "model" | "pendingNote">,
): string[] {
  const resume = job.attempts > 0 && job.sessionId;
  const prompt = resume
    ? job.pendingNote ? revisionPrompt(job.pendingNote) : RESUME_PROMPT
    : job.pendingNote ? `${job.prompt}\n\n${revisionPrompt(job.pendingNote)}` : job.prompt;
  return [
    ...(resume ? ["--resume", job.sessionId!] : []),
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    // The operator's own settings, hooks and MCP servers are theirs, not the film's.
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--model",
    job.model || motionModel(),
    "--effort",
    job.request.effort,
    "--allowedTools",
    ...MOTION_ALLOWED_TOOLS,
    "--disallowedTools",
    ...MOTION_DENIED_TOOLS,
  ];
}

/** The plan, never the API: a key in the environment would switch billing. */
export function planEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  // ffmpeg is usually Homebrew's; a launchd-started AgentOS may not have it on PATH.
  env.PATH = [env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(path.delimiter);
  return env;
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Stops the whole process group: Claude, and any render it started. */
export function stopGroup(pid: number): void {
  for (const signal of ["SIGTERM"] as const) {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    }
  }
  setTimeout(() => {
    try {
      if (alive(pid)) process.kill(-pid, "SIGKILL");
    } catch {
      // Gone.
    }
  }, 5000).unref();
}

let starting = false;

/** Starts the oldest queued film when nothing else is rendering. One at a time: renders are CPU-bound. */
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

function timeoutMs(): number {
  const configured = Number(process.env.AGENTOS_MOTION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

async function start(job: StoredMotionJob): Promise<void> {
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

  const args = claudeArgs(job);
  job.attempts = attempt;
  const revising = Boolean(job.pendingNote);
  job.pendingNote = undefined;

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
  job.run = { pid, logFile, offset: 0, deadline: new Date(Date.now() + timeoutMs()).toISOString(), cancelRequested: false };
  pushLog(
    job,
    "system",
    attempt === 1
      ? `Claude Code started · ${job.model} · effort ${job.request.effort}`
      : `${revising ? "Revising" : "Resumed"} (run ${attempt}) · ${job.model}`,
  );
  await save(job);

  if (attempt === 1) {
    await recordActivity({ type: "motion.started", description: job.title, project: job.request.project, metadata: { motionJobId: job.id } });
  }

  watch(job.id);
}

// ---------------------------------------------------------------------------
// Watching
// ---------------------------------------------------------------------------

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

function clip(text: string, limit = 280): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function pushLog(job: StoredMotionJob, kind: MotionLogEntry["kind"], message: string): void {
  job.log.push({ at: new Date().toISOString(), kind, message });
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** A tool call, in the words an operator scanning a log would want. */
export function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const detail =
    (typeof input?.command === "string" && input.command) ||
    (typeof input?.file_path === "string" && path.basename(input.file_path)) ||
    (typeof input?.url === "string" && input.url) ||
    (typeof input?.pattern === "string" && input.pattern) ||
    "";
  return clip(detail ? `${name} · ${detail}` : name, 200);
}

/** Applies one line of Claude Code's stream to the record. */
export function applyEvent(
  job: Pick<StoredMotionJob, "log" | "sessionId" | "model" | "summary" | "usage" | "resultError">, 
  line: string,
  context?: { lastToolError?: string; stderr?: string }
): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.type === "system" && event.subtype === "init") {
    if (typeof event.session_id === "string") job.sessionId = event.session_id;
    if (typeof event.model === "string") job.model = event.model;
    return;
  }

  if (event.type === "assistant") {
    const content = record(event.message)?.content;
    if (!Array.isArray(content)) return;
    for (const part of content) {
      const block = record(part);
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        pushLog(job as StoredMotionJob, "text", clip(block.text));
      } else if (block?.type === "tool_use" && typeof block.name === "string") {
        pushLog(job as StoredMotionJob, "tool", describeTool(block.name, record(block.input)));
      }
    }
    return;
  }

  // Track tool errors from tool_result events
  if (event.type === "tool_result") {
    const isError = event.is_error === true;
    if (isError && context) {
      const errorContent = typeof event.content === "string" ? event.content : 
        Array.isArray(event.content) && typeof event.content[0]?.text === "string" ? event.content[0].text :
        "Tool execution failed";
      context.lastToolError = errorContent.trim().slice(0, 200);
    }
    return;
  }

  if (event.type === "result") {
    if (typeof event.result === "string") job.summary = event.result.trim();
    const usage = record(event.usage);
    job.usage = {
      turns: typeof event.num_turns === "number" ? event.num_turns : undefined,
      inputTokens:
        ((usage?.input_tokens as number) ?? 0) + ((usage?.cache_creation_input_tokens as number) ?? 0) || undefined,
      outputTokens: (usage?.output_tokens as number) ?? undefined,
    };
    
    // Determine if this was actually a failure
    // Never use the word "success" in an error message when is_error is true
    const subtype = typeof event.subtype === "string" ? event.subtype : undefined;
    const isError = event.is_error === true;
    const failed = isError || (subtype !== undefined && subtype !== "success");
    
    if (failed) {
      // Extract concrete error in priority order:
      // 1. Last tool error from the stream
      // 2. Stderr tail (provided via context)
      // 3. Exit code/subtype (but never say "success" if is_error is true)
      // 4. Generic fallback
      let errorMessage: string;
      
      if (context?.lastToolError) {
        errorMessage = `Tool error: ${context.lastToolError}`;
      } else if (context?.stderr) {
        errorMessage = `Error: ${context.stderr}`;
      } else if (subtype && subtype !== "success") {
        // Only use subtype if it's not "success"
        errorMessage = subtype === "timeout" ? "Claude Code did not finish within the time limit."
          : subtype === "cancelled" ? "Claude Code was cancelled."
          : subtype === "tool_error" ? "A tool call failed during execution."
          : `Claude Code stopped: ${subtype}.`;
      } else {
        // is_error is true but subtype is "success" or missing - use generic
        errorMessage = "Claude Code encountered an error during execution.";
      }
      
      job.resultError = errorMessage;
    } else {
      // Even on "success", let the settle function verify deliverables exist
      job.resultError = undefined;
    }
  }
}

async function readNewLines(job: StoredMotionJob): Promise<number> {
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
    
    // Track context for error extraction
    const context = { lastToolError: undefined as string | undefined, stderr: undefined as string | undefined };
    
    // Read stderr to include in context
    const stderrTailContent = await stderrTail(job);
    if (stderrTailContent) {
      context.stderr = stderrTailContent;
    }
    
    for (const line of lines) {
      if (line.trim()) {
        applyEvent(job, line, context);
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
        job.resultError = `Claude Code did not finish within ${Math.round(timeoutMs() / 60_000)} minutes and was stopped.`;
      }
      if (lines > 0 || overdue) await save(job);
      return;
    }

    // The process has ended. Read anything it wrote on the way out, then decide.
    await readNewLines(job);
    unwatch(id);
    await settle(job);
  } finally {
    ticking.delete(id);
  }
}

async function stderrTail(job: StoredMotionJob): Promise<string> {
  try {
    const text = await fs.readFile(path.join(studioDir(job.id), ".agentos", `run-${job.attempts}.stderr.log`), "utf8");
    return text.trim().split("\n").filter(Boolean).slice(-3).join(" ");
  } catch {
    return "";
  }
}

async function settle(job: StoredMotionJob): Promise<void> {
  if (job.run?.cancelRequested) {
    await finishWith(job, "cancelled", undefined);
    return;
  }

  const filed = await fileOutputs(job);
  // Never mark as completed when resultError exists, even if films were filed
  if (job.resultError) {
    pushLog(job, "system", filed > 0 ? `Filed ${filed} film${filed === 1 ? "" : "s"}, but the run failed validation.` : "No films to file.");
    await finishWith(job, "failed", job.resultError);
    return;
  }
  if (job.assetIds.length > 0) {
    pushLog(job, "system", filed > 0 ? `Filed ${filed} film${filed === 1 ? "" : "s"} in Creative.` : "No new renders to file.");
    await finishWith(job, "completed", undefined);
    return;
  }

  const reason =
    (await stderrTail(job)) || "Claude Code stopped without leaving a film in out/. Resume to let it carry on.";
  await finishWith(job, "failed", reason);
}

async function finishWith(job: StoredMotionJob, status: "completed" | "failed" | "cancelled", error: string | undefined): Promise<void> {
  job.status = status;
  job.error = error;
  job.completedAt = new Date().toISOString();
  if (job.run) job.run = { ...job.run, cancelRequested: false };
  pushLog(job, "system", status === "completed" ? "Done." : status === "cancelled" ? "Cancelled." : `Failed: ${error}`);
  await save(job);

  if (status !== "cancelled") {
    await recordActivity({
      type: status === "completed" ? "motion.completed" : "motion.failed",
      description: status === "completed" ? job.title : `${job.title}: ${error}`,
      project: job.request.project,
      metadata: { motionJobId: job.id, assets: job.assetIds.length },
    });
  }

  void pump();
}

/**
 * Files every finished MP4 in `out/` into Creative.
 *
 * Checked with ffprobe first: a half-written file from a stopped render is
 * not a film. A file already filed and unchanged since is skipped, so a
 * resumed film adds only what it re-rendered.
 */
async function fileOutputs(job: StoredMotionJob): Promise<number> {
  const outDir = path.join(studioDir(job.id), "out");
  let names: string[];
  try {
    names = (await fs.readdir(outDir)).filter((name) => /\.(mp4|mov|webm)$/i.test(name) && !name.startsWith("."));
  } catch {
    return 0;
  }

  let filed = 0;
  for (const name of names.sort()) {
    const file = path.join(outDir, name);
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
      filename: `${slug(job.title)}${name === "final.mp4" ? "" : `-${slug(path.basename(name, extension))}`}${extension}`,
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
      tags: ["motion", format],
      prompt: job.prompt.split("\n# ")[0].replace(/^# Brief\s*/, "").trim().slice(0, 2000),
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

export async function listMotionJobs(): Promise<MotionJob[]> {
  return (await readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toWire);
}

async function readRounds(dir: string, sheets: Set<string>, id: string): Promise<MotionRound[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, "scores.json"), "utf8"));
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(record(parsed)?.rounds) ? (record(parsed)!.rounds as unknown[]) : [];
    return entries.flatMap((entry, index) => {
      const result = MotionRoundSchema.safeParse({ round: index + 1, ...(record(entry) ?? {}) });
      if (!result.success) return [];
      const name = `round-${result.data.round}.png`;
      return [{ ...result.data, sheetUrl: sheets.has(name) ? `/api/designs/motion/${id}/sheets/${name}` : undefined }];
    });
  } catch {
    return [];
  }
}

export async function readMotionJob(id: string): Promise<MotionJobDetail | undefined> {
  if (!isMotionId(id)) return undefined;
  const job = await read(id);
  if (!job) return undefined;

  const dir = studioDir(id);
  const sheetNames = await fs
    .readdir(path.join(dir, "sheet"))
    .then((names) => names.filter((name) => /^(round-\d+|contact)\.png$/.test(name)))
    .catch(() => [] as string[]);
  const sheetStats = await Promise.all(
    sheetNames.map(async (name) => ({ name, at: (await fs.stat(path.join(dir, "sheet", name)).catch(() => undefined))?.mtimeMs ?? 0 })),
  );
  const outputs = await fs
    .readdir(path.join(dir, "out"))
    .then((names) => names.filter((name) => /\.(mp4|mov|webm)$/i.test(name)))
    .catch(() => [] as string[]);

  return {
    ...toWire(job),
    rounds: await readRounds(dir, new Set(sheetNames), id),
    sheets: sheetStats
      .sort((a, b) => a.at - b.at)
      .map(({ name, at }) => ({ name, url: `/api/designs/motion/${id}/sheets/${name}?v=${Math.round(at)}` })),
    outputs: outputs.sort(),
  };
}

/** A contact sheet's path, for serving. Names are matched, never joined blindly. */
export function sheetPath(id: string, name: string): string | undefined {
  if (!isMotionId(id) || !/^(round-\d+|contact)\.png$/.test(name)) return undefined;
  return path.join(studioDir(id), "sheet", name);
}

export async function cancelMotionJob(id: string): Promise<MotionJob | undefined> {
  const job = await read(id);
  if (!job) return undefined;

  if (job.status === "queued") {
    await finishWith(job, "cancelled", undefined);
  } else if (job.status === "running" && job.run) {
    job.run.cancelRequested = true;
    pushLog(job, "system", "Stopping…");
    await save(job);
    stopGroup(job.run.pid);
  }
  return toWire(job);
}

/**
 * Carries a film on: the same studio, the same Claude session.
 *
 * Without a note it picks up a film that stopped. With one it is a revision:
 * the operator has watched the film and says what to change.
 */
export async function resumeMotionJob(id: string, note?: string): Promise<MotionJob | undefined> {
  const job = await read(id);
  if (!job) return undefined;
  if (!["failed", "cancelled", "interrupted", "completed"].includes(job.status)) return toWire(job);
  if (job.status === "completed" && !note?.trim()) return toWire(job);

  job.status = "queued";
  job.error = undefined;
  job.completedAt = undefined;
  if (note?.trim()) {
    job.pendingNote = note.trim();
    job.revisions.push({ at: new Date().toISOString(), note: note.trim() });
  }
  pushLog(job, "system", note?.trim() ? "Queued to revise." : "Queued to resume.");
  await save(job);
  void pump();
  return toWire(job);
}

/**
 * Picks films back up after AgentOS starts.
 *
 * A film whose Claude is still running is watched again from where reading
 * stopped. One whose Claude ended while nobody was watching is settled from
 * what it left behind — which usually means a finished film to file.
 */
export async function reconcileMotionJobs(): Promise<void> {
  for (const job of await readAll()) {
    if (job.status !== "running") continue;
    if (job.run && alive(job.run.pid)) watch(job.id);
    else await tick(job.id);
  }
  await pump();
}
