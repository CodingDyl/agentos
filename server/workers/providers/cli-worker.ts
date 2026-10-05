import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { WorkerCapability, WorkerId, WorkerJob, WorkerJobResult, WorkerProviderMetrics } from "../../../shared/worker-types";
import { aiModel } from "../../ai-stack/settings";
import { findOnPath } from "../../ai-stack/detect";
import type { Worker, WorkerRunContext } from "../worker";

/**
 * The operator's own coding CLIs, as AgentOS workers.
 *
 * Claude Code, Codex, Gemini and Hermes all have a headless mode: one prompt
 * in, work done in a directory, a final message out. This is the one engine
 * they share; each tool's file says only how to call it and how to read it.
 *
 * The rules that make running them unattended defensible are the same as for
 * Grok, and live here so no adapter can forget one:
 *
 * - **AgentOS owns the isolation.** Every run happens in the job's own
 *   worktree. No worktree, no run.
 * - **Nothing it says is taken as fact.** Its closing message is recorded as a
 *   claim; what changed is read from git and whether it works is decided by
 *   running the validation commands.
 * - **Health never runs the binary.** Health is checked on every workers-screen
 *   load, and these CLIs update themselves when started — which is how
 *   interrupting `codex --version` once deleted the Codex install. Finding the
 *   binary is enough; auth problems surface on the first job, in the tool's own
 *   words.
 */

const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const SIGKILL_GRACE_MS = 5_000;
const MAX_STDERR_CHARS = 4_000;
const MAX_STDOUT_CHARS = 16_000;

/** What a line of the tool's output meant, when it meant anything. */
export interface CliProgress {
  message: string;
  metadata?: Record<string, unknown>;
}

export interface CliRunFiles {
  /** A path the tool can write its final message to, for tools that support it. */
  lastMessage: string;
  /** A path the tool can write a usage report to, for tools that support it. */
  usage: string;
}

/** Reads one tool's output stream. A fresh one is made for every run. */
export interface CliOutputReader {
  line(line: string): CliProgress | undefined;
  finish(stdout: string, files: CliRunFiles): Promise<{
    summary?: string;
    metrics?: WorkerProviderMetrics;
    blockers?: string[];
  }>;
}

export interface CliWorkerSpec {
  id: WorkerId;
  name: string;
  role: string;
  capabilities: WorkerCapability[];
  binary: string;
  /** Said when the binary is missing — the exact install step. */
  installHint: string;
  /** Extra health requirement beyond the binary, e.g. a sign-in file. */
  ready?: () => Promise<{ ok: boolean; reason?: string }>;
  args(input: { cwd: string; prompt: string; model?: string; files: CliRunFiles }): string[];
  /** The child's environment. Defaults to the server's own. */
  env?(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  reader(input: { model?: string }): CliOutputReader;
}

/**
 * The brief every CLI worker is sent: the shared context packet, plus what a
 * worker running unattended needs to be told.
 */
export function buildCliPrompt(contextPacket: string): string {
  return [
    "AGENTOS WORKER JOB",
    "",
    "You are running unattended as a worker for AgentOS. You have been given",
    "one scoped job in an isolated checkout that exists only for this job.",
    "",
    contextPacket,
    "",
    "How this run is judged:",
    "- Do not commit, push, or change git remotes. Leave your work uncommitted",
    "  in the working tree; AgentOS reads the changes from git.",
    "- Do not read or edit .env files or credentials.",
    "- AgentOS runs the validation commands itself. Reporting success does not",
    "  make a job pass.",
    "",
    "When you are finished, reply with a short summary of what you changed and",
    "anything that blocked you. That summary is what a person reads first.",
  ].join("\n");
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");

  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, SIGKILL_GRACE_MS);

  timer.unref?.();
  child.once("exit", () => clearTimeout(timer));
}

function jobTimeoutMs(): number {
  const configured = Number(process.env.AGENTOS_CLI_WORKER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_JOB_TIMEOUT_MS;
}

export function createCliWorker(spec: CliWorkerSpec): Worker {
  const processes = new Map<string, ChildProcess>();

  return {
    id: spec.id,
    name: spec.name,
    role: spec.role,
    capabilities: spec.capabilities,

    async healthCheck() {
      const binary = await findOnPath(spec.binary);
      if (!binary) return { available: false, reason: `${spec.binary} is not installed. ${spec.installHint}` };

      if (spec.ready) {
        const ready = await spec.ready();
        if (!ready.ok) return { available: false, reason: ready.reason };
      }

      const model = aiModel(spec.id);
      return { available: true, reason: `${binary}${model ? ` · model ${model}` : ""}` };
    },

    async start(job: WorkerJob, { emit, signal, worktreePath, contextPacket }: WorkerRunContext): Promise<WorkerJobResult> {
      if (!worktreePath) {
        throw new Error(`${spec.name} needs an isolated worktree. Give the job a repository so one can be created.`);
      }

      const binary = await findOnPath(spec.binary);
      if (!binary) throw new Error(`${spec.binary} is not installed. ${spec.installHint}`);

      // Scratch files outside the worktree, so they never show up as changes.
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), `agentos-${spec.id}-`));
      const files: CliRunFiles = {
        lastMessage: path.join(scratch, `last-message-${randomUUID()}.txt`),
        usage: path.join(scratch, `usage-${randomUUID()}.json`),
      };

      const model = aiModel(spec.id);
      const prompt = buildCliPrompt(contextPacket);
      const args = spec.args({ cwd: worktreePath, prompt, model, files });

      emit("job.progress", `Starting ${spec.name}`, { model: model ?? "tool default", promptBytes: prompt.length });

      const child = spawn(binary, args, {
        cwd: worktreePath,
        env: spec.env ? spec.env(process.env) : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      processes.set(job.id, child);

      const reader = spec.reader({ model });
      let stdout = "";
      let stderr = "";

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
      });

      const onAbort = () => terminate(child);
      signal.addEventListener("abort", onAbort, { once: true });
      const timeout = setTimeout(() => terminate(child), jobTimeoutMs());

      try {
        const lines = readline.createInterface({ input: child.stdout! });
        lines.on("line", (line) => {
          stdout = `${stdout}${line}\n`.slice(-MAX_STDOUT_CHARS);
          const progress = reader.line(line);
          if (progress) emit("job.progress", progress.message, progress.metadata);
        });

        const { code, signalName } = await new Promise<{ code: number | null; signalName: NodeJS.Signals | null }>((resolve, reject) => {
          child.once("close", (exitCode, exitSignal) => resolve({ code: exitCode, signalName: exitSignal }));
          child.once("error", reject);
        });
        lines.close();

        if (signal.aborted) throw new Error("Cancelled");

        if (code !== 0) {
          const detail = exitDetail(stdout, stderr);
          const reason = signalName ? `${spec.name} was stopped by ${signalName}` : `${spec.name} exited with code ${code ?? "unknown"}`;
          throw new Error(detail ? `${reason}: ${detail}` : reason);
        }

        const outcome = await reader.finish(stdout, files);
        emit("job.progress", `${spec.name} finished`, { model: outcome.metrics?.model ?? model });

        return {
          summary: outcome.summary?.trim() || `${spec.name} finished without a closing summary.`,
          blockers: outcome.blockers && outcome.blockers.length > 0 ? outcome.blockers : undefined,
          worktreePath,
          providerMetrics: outcome.metrics,
        };
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        processes.delete(job.id);
        terminate(child);
        await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    async cancel(jobId: string) {
      const child = processes.get(jobId);
      if (child) terminate(child);
    },
  };
}

/**
 * Why a CLI exited badly, in its own words. Stderr first; but a tool that
 * streams JSON (Claude Code with `--output-format stream-json`) reports most
 * failures (expired login, usage limit, a refused flag) as a final `result`
 * event on stdout with nothing on stderr, so that is read next, then the
 * last plain lines of stdout. Without this the job said only "exited with code 1".
 */
export function exitDetail(stdout: string, stderr: string): string {
  const fromStderr = stderr.trim().split("\n").filter(Boolean).slice(-4).join(" ");
  if (fromStderr) return clip(fromStderr, 600);

  const lines = stdout.trim().split("\n").filter(Boolean);
  for (const line of [...lines].reverse()) {
    const event = jsonLine(line);
    if (!event) continue;
    const errors = Array.isArray(event.errors) ? event.errors.filter((entry): entry is string => typeof entry === "string") : [];
    const message =
      (typeof event.result === "string" && event.result.trim()) ||
      errors.join(" ") ||
      (typeof record(event.error)?.message === "string" ? String(record(event.error)?.message) : typeof event.error === "string" ? event.error : "") ||
      (event.type === "result" && typeof event.subtype === "string" && event.subtype !== "success" ? event.subtype.replace(/_/g, " ") : "");
    if (message && (event.is_error === true || event.type === "result" || event.type === "error" || event.error !== undefined)) return clip(message, 600);
  }

  const plain = lines.filter((line) => !line.trim().startsWith("{")).slice(-3).join(" ");
  return plain ? clip(plain, 600) : "";
}

/** Parses a line as a JSON object, or nothing. Tools interleave plain text with events. */
export function jsonLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;

  try {
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** A progress line, kept short. */
export function clip(text: string, limit = 160): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
}
