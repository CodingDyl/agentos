import { execFile, spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import { promisify } from "node:util";
import type { WorkerJob, WorkerJobResult } from "../../../shared/worker-types";
import type { Worker, WorkerRunContext } from "../worker";
import { GrokStream } from "./grok-events";

/**
 * Grok Build, as an AgentOS worker.
 *
 * Grok is run headlessly: one prompt in, a stream of NDJSON out, one process
 * per job. Everything AgentOS-specific — what the job is, where it runs, what
 * counts as done — is decided elsewhere and handed in. This file knows how to
 * start Grok, read it, and stop it, and nothing else.
 *
 * Three decisions are worth stating, because they are what make running a model
 * unattended defensible:
 *
 * - **AgentOS owns the isolation.** Grok can make its own git worktree, and is
 *   deliberately not asked to. The job manager already created one; nesting a
 *   second inside it would leave work somewhere nobody is looking. Grok is
 *   pointed at the directory it was given and confined to it.
 * - **The prompt is not the safety mechanism.** Asking a model not to push is a
 *   request. Deny rules are a refusal, enforced whatever the prompt says, and
 *   they outrank the auto-approval that makes unattended running possible.
 * - **Nothing it says is taken as fact.** Its closing summary is recorded as a
 *   claim. What changed is read from git, and whether it works is decided by
 *   running the validation commands.
 */

const run = promisify(execFile);

/** Long enough for a real health check, short enough not to hang a page load. */
const HEALTH_TIMEOUT_MS = 10_000;

/** A job that has not finished by now is stuck, not slow. */
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;

/** How long a cancelled process gets to exit before it is killed outright. */
const SIGKILL_GRACE_MS = 5_000;

/** Kept for the failure message; the whole of a noisy run is not worth holding. */
const MAX_STDERR_CHARS = 4_000;

/**
 * What Grok may never do, whatever the prompt says.
 *
 * Deny rules are matched against every segment of a chained command and
 * outrank auto-approval, so this holds even though the run is unattended.
 *
 * The patterns are prefixes on purpose. Grok compares a prefix character for
 * character with no word boundary, so `git push` catches a bare `git push` as
 * well as `git push origin main` — where a pattern written as `git push *`
 * would require an argument and let the bare command through.
 */
const DENY_RULES: readonly string[] = [
  // Publishing and history are the operator's, via review. Not a worker's.
  "Bash(git push)",
  "Bash(git commit)",
  "Bash(git remote)",
  "Bash(git reset --hard)",
  // A second worktree would put work outside the one being reviewed.
  "Bash(git worktree)",
  // Destructive and privileged commands have no place in a scoped job.
  "Bash(rm -rf)",
  "Bash(rm -fr)",
  "Bash(sudo)",
  // Credentials are not part of any job's context.
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Read(**/*.pem)",
  "Edit(**/.env)",
];

/**
 * Web tools, off unless asked for.
 *
 * Child-process network blocking is a no-op on macOS, so the sandbox cannot be
 * relied on for this. Removing the tools is the lever that actually works.
 */
const WEB_TOOLS = "web_search,web_fetch";

function grokBinary(): string {
  return process.env.AGENTOS_GROK_BIN?.trim() || "grok";
}

/**
 * The sandbox profile to run under.
 *
 * `workspace` is the default rather than `strict` for a practical reason:
 * `strict` and `read-only` refuse to start on machines where a denied runtime
 * socket is a symlink — Docker Desktop on macOS is the common case — and a
 * profile that will not start is not protection, it is an outage. `workspace`
 * confines writes to the working directory, which is the worktree, and that is
 * the property this design actually depends on.
 *
 * Set `AGENTOS_GROK_SANDBOX=off` to omit the flag, or name any profile Grok
 * knows, including one defined in `sandbox.toml`.
 */
function sandboxProfile(): string | undefined {
  const configured = process.env.AGENTOS_GROK_SANDBOX?.trim();

  if (configured === "off" || configured === "none") return undefined;

  return configured && configured.length > 0 ? configured : "workspace";
}

function jobTimeoutMs(): number {
  const configured = Number(process.env.AGENTOS_GROK_TIMEOUT_MS);

  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_JOB_TIMEOUT_MS;
}

function maxTurns(): string {
  const configured = Number(process.env.AGENTOS_GROK_MAX_TURNS);

  return Number.isFinite(configured) && configured > 0
    ? String(Math.floor(configured))
    : "40";
}

/**
 * The brief Grok is actually sent.
 *
 * The packet is the same one every worker gets. What is added here is only what
 * Grok specifically needs to be told: that it is running unattended, that some
 * things are refused rather than discouraged, and what to say at the end.
 */
export function buildGrokPrompt(contextPacket: string): string {
  return [
    "AGENTOS WORKER JOB",
    "",
    "You are running unattended as a worker for AgentOS. You have been given",
    "one scoped job in an isolated checkout that exists only for this job.",
    "",
    contextPacket,
    "",
    "How this run is judged:",
    "- Committing, pushing, and changing git remotes are blocked, not merely",
    "  discouraged. Leave your work uncommitted in the working tree.",
    "- AgentOS reads the changed files from git and runs the validation",
    "  commands itself. Reporting success does not make a job pass.",
    "",
    "When you are finished, reply with a short summary of what you changed and",
    "anything that blocked you. That summary is what a person reads first.",
  ].join("\n");
}

/** The full argument list for one headless run. Exported so it can be tested. */
export function buildGrokArgs(options: {
  cwd: string;
  prompt: string;
  allowWeb: boolean;
  sandbox?: string;
  turns: string;
}): string[] {
  const args = [
    // An update check mid-job would change the binary underneath a run.
    "--no-auto-update",
    "--cwd",
    options.cwd,
    "--output-format",
    "streaming-json",
    // Unattended means nothing can wait on a prompt. The deny rules below are
    // what keep that from meaning "anything goes".
    "--always-approve",
    "--max-turns",
    options.turns,
    // The packet is data, not instructions to Grok's own command layer: an
    // objective that happens to begin with `/` is an objective, not a command.
    "--verbatim",
  ];

  if (options.sandbox) args.push("--sandbox", options.sandbox);
  if (!options.allowWeb) args.push("--disallowed-tools", WEB_TOOLS);

  for (const rule of DENY_RULES) args.push("--deny", rule);

  args.push("-p", options.prompt);

  return args;
}

/** Live Grok processes, by job id, so a job can be stopped. */
const processes = new Map<string, ChildProcess>();

/**
 * Stops a process, then makes sure.
 *
 * SIGTERM lets Grok close its session cleanly; a process that ignores it is not
 * negotiated with, because a cancelled job that keeps writing to the worktree
 * is exactly what cancelling was meant to prevent.
 */
function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");

  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, SIGKILL_GRACE_MS);

  // A cancelled job must not hold the event loop open waiting to kill again.
  timer.unref?.();
  child.once("exit", () => clearTimeout(timer));
}

export const grokWorker: Worker = {
  id: "grok",
  name: "Grok Build",
  role: "Implementation. Writes code in an isolated checkout",
  capabilities: ["code", "review", "research"],

  /**
   * Whether Grok can be run at all.
   *
   * Deliberately only asks the binary its version. Health is checked every time
   * the workers screen loads, and a check that sent a prompt would spend tokens
   * to answer a question `--version` already answers.
   *
   * It does not prove the session is authenticated. That surfaces on the first
   * job, with Grok's own message, rather than being guessed at here.
   */
  async healthCheck() {
    try {
      const { stdout } = await run(grokBinary(), ["version"], {
        timeout: HEALTH_TIMEOUT_MS,
      });

      return { available: true, reason: stdout.trim() || undefined };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      if (detail.includes("ENOENT")) {
        return {
          available: false,
          reason:
            "The grok binary is not on PATH. Install Grok Build, or set AGENTOS_GROK_BIN to its path.",
        };
      }

      return {
        available: false,
        reason: `Grok did not report a version: ${detail}`,
      };
    }
  },

  async start(
    job: WorkerJob,
    { emit, signal, worktreePath, contextPacket }: WorkerRunContext,
  ): Promise<WorkerJobResult> {
    // Isolation is the whole basis for running this unattended. Without a
    // worktree, Grok would be writing into the operator's live checkout.
    if (!worktreePath) {
      throw new Error(
        "Grok needs an isolated worktree. Give the job a repository so one can be created.",
      );
    }

    const prompt = buildGrokPrompt(contextPacket);
    const sandbox = sandboxProfile();

    const args = buildGrokArgs({
      cwd: worktreePath,
      prompt,
      allowWeb: process.env.AGENTOS_GROK_ALLOW_WEB === "1",
      sandbox,
      turns: maxTurns(),
    });

    emit("job.progress", "Starting Grok Build", {
      sandbox: sandbox ?? "off",
      maxTurns: maxTurns(),
      denyRules: DENY_RULES.length,
      promptBytes: prompt.length,
    });

    const child = spawn(grokBinary(), args, {
      // Both are set: `--cwd` is what Grok reports and resolves against, and
      // the process cwd is what the sandbox confines writes to.
      cwd: worktreePath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    processes.set(job.id, child);

    const stream = new GrokStream();
    let stderr = "";

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      // Only the tail is kept: the failure message wants the last thing that
      // went wrong, not the whole of a long run.
      stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
    });

    const onAbort = () => terminate(child);
    signal.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => terminate(child), jobTimeoutMs());

    try {
      const lines = readline.createInterface({ input: child.stdout! });

      lines.on("line", (line) => {
        for (const emission of stream.handleLine(line)) {
          emit(emission.type, emission.message, emission.metadata);
        }
      });

      const { code, signalName } = await new Promise<{
        code: number | null;
        signalName: NodeJS.Signals | null;
      }>((resolve, reject) => {
        // Waiting on `close` rather than `exit` means every line Grok wrote has
        // been read before the run is called over.
        child.once("close", (code, signalName) => resolve({ code, signalName }));
        child.once("error", reject);
      });

      lines.close();

      if (signal.aborted) throw new Error("Cancelled");

      if (code !== 0) {
        throw new Error(grokFailure(code, signalName, stderr, stream));
      }

      // Grok can exit cleanly having stopped early — a turn limit, a refusal.
      // That is a blocker on the job, not a failure of the run.
      const blockers = [...stream.blockers];
      const stopReason = stream.stopReason;

      if (stopReason && stopReason !== "end_turn") {
        blockers.push(`Grok stopped early: ${stopReason}.`);
      }

      for (const unfinished of stream.unfinishedTools) {
        blockers.push(`${unfinished} never reported finishing.`);
      }

      emit("job.progress", "Grok finished", {
        stopReason: stopReason ?? "unknown",
        usage: stream.usage,
      });

      return {
        // Grok's own words, recorded as a claim. `changedFiles` is left for the
        // job manager to fill from git — this worker does not get a say in it.
        summary: stream.summary || "Grok finished without a closing summary.",
        blockers: blockers.length > 0 ? blockers : undefined,
        worktreePath,
        // Turns and tokens, and deliberately no cost: Grok does not price its
        // own runs, and a figure this codebase multiplied out itself would be
        // an estimate wearing a measurement's clothes.
        providerMetrics: stream.metrics,
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(
          `Could not run ${grokBinary()}. Install Grok Build, or set AGENTOS_GROK_BIN to its path.`,
          { cause: error },
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      processes.delete(job.id);
      terminate(child);
    }
  },

  /**
   * Stops a running job.
   *
   * The job manager aborts the run signal for every worker, which already
   * reaches the process. This is here so cancelling works even if that path
   * changes, and it is safe to call for a job that has already gone.
   */
  async cancel(jobId: string): Promise<void> {
    const child = processes.get(jobId);
    if (child) terminate(child);
  },
};

/**
 * Why a run failed, in terms an operator can act on.
 *
 * Grok's stderr carries the actionable part — an unavailable sandbox profile, a
 * session that is not signed in — so it is quoted rather than summarised away.
 */
function grokFailure(
  code: number | null,
  signalName: NodeJS.Signals | null,
  stderr: string,
  stream: GrokStream,
): string {
  const detail = stderr.trim().split("\n").filter(Boolean).slice(-4).join(" ");

  const reason = signalName
    ? `Grok was stopped by ${signalName}`
    : `Grok exited with code ${code ?? "unknown"}`;

  const reported = stream.blockers.at(-1);

  return [reason, detail || reported].filter(Boolean).join(": ");
}
