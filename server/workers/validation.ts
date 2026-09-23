import { spawn } from "node:child_process";
import type { WorkerValidation } from "../../shared/worker-types";
import type { EmitWorkerEvent } from "./worker";

/**
 * Checking the work, rather than believing it.
 *
 * A worker that says "all tests passed" has made a claim. This module is what
 * turns that claim into a fact or a contradiction: the job's validation
 * commands are run by AgentOS, in the worktree, and what counts is the exit
 * code. A worker has no input into this and cannot influence the result.
 *
 * That separation is the point of the whole arrangement — the worker
 * implements, AgentOS verifies, Hermes reviews, and the operator decides.
 */

/** Long enough for a real build, short enough that a hung command still ends. */
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

/** Enough output to see why something failed, not so much it fills the record. */
const MAX_OUTPUT_CHARS = 2_000;

function commandTimeoutMs(): number {
  const configured = Number(process.env.AGENTOS_VALIDATION_TIMEOUT_MS);

  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_COMMAND_TIMEOUT_MS;
}

/** The tail of a command's output — where the error usually is. */
function tail(output: string): string | undefined {
  const trimmed = output.trim();
  if (trimmed.length === 0) return undefined;

  return trimmed.length > MAX_OUTPUT_CHARS
    ? `…${trimmed.slice(-MAX_OUTPUT_CHARS)}`
    : trimmed;
}

export interface ValidationOutcome {
  results: WorkerValidation[];
  /** Whether every command was run and every one of them passed. */
  passed: boolean;
}

/**
 * Runs one command in the worktree and reports what happened.
 *
 * Through a shell, because these are the commands an operator would type —
 * `npm run build`, not an argv array. They come from the job request, which is
 * the operator's own input, and they run with the operator's own permissions;
 * this is not a boundary a worker can reach across.
 */
function runCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<WorkerValidation> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;

    const capture = (chunk: Buffer) => {
      // Only the tail is kept, so a chatty build cannot grow without bound.
      output = `${output}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT_CHARS * 2);
    };

    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    const stop = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, commandTimeoutMs());

    const onAbort = () => stop();
    signal.addEventListener("abort", onAbort, { once: true });

    const finish = (result: WorkerValidation) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    child.once("error", (error) => {
      finish({
        command,
        success: false,
        detail: `Could not run the command: ${error.message}`,
      });
    });

    child.once("close", (code, signalName) => {
      if (timedOut) {
        finish({
          command,
          success: false,
          detail: `Timed out after ${Math.round(commandTimeoutMs() / 1000)}s.`,
        });
        return;
      }

      if (signal.aborted) {
        finish({ command, success: false, detail: "Cancelled." });
        return;
      }

      const success = code === 0;

      finish({
        command,
        success,
        // A passing command needs no explanation; a failing one always does.
        detail: success
          ? `Exit code 0.`
          : [
              signalName
                ? `Stopped by ${signalName}.`
                : `Exit code ${code ?? "unknown"}.`,
              tail(output),
            ]
              .filter(Boolean)
              .join(" "),
      });
    });
  });
}

/**
 * Runs a job's validation commands, in order, and says whether they passed.
 *
 * Runs every command even after one fails: an operator reading the result wants
 * to know whether the build *and* the lint are broken, not just the first thing
 * that went wrong.
 *
 * A job with no validation commands has not passed validation — it simply had
 * none to run, which is reported as such rather than as a pass.
 */
export async function runValidation(
  commands: readonly string[],
  cwd: string,
  emit: EmitWorkerEvent,
  signal: AbortSignal,
): Promise<ValidationOutcome> {
  const results: WorkerValidation[] = [];

  for (const raw of commands) {
    const command = raw.trim();
    if (command.length === 0) continue;

    if (signal.aborted) {
      results.push({ command, success: false, detail: "Not run — cancelled." });
      continue;
    }

    emit("validation.started", command);

    const result = await runCommand(command, cwd, signal);
    results.push(result);

    emit(
      "validation.completed",
      `${command} — ${result.success ? "passed" : "failed"}`,
      { command, success: result.success, executed: true },
    );
  }

  return {
    results,
    passed: results.length > 0 && results.every((result) => result.success),
  };
}
