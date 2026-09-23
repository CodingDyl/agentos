import type { WorkerJob, WorkerJobResult } from "../../../shared/worker-types";
import type { Worker, WorkerRunContext } from "../worker";

/**
 * A worker that does nothing, convincingly.
 *
 * This exists so the whole architecture — isolation, events, persistence,
 * streaming, cancellation — can be proven end to end without spending a single
 * token on a real runner. If a job cannot complete through Mock, it will not
 * complete through Grok either, and finding that out here is free.
 *
 * It is deliberately honest about what it is: it writes no files and claims no
 * work, so nothing downstream can mistake a rehearsal for an implementation.
 */

/** Slow enough to watch, fast enough not to be tedious. */
const STEP_MS = 500;

/** Waits, unless the job is cancelled first. */
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Cancelled"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Cancelled"));
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const mockWorker: Worker = {
  id: "mock",
  name: "Mock",
  role: "Development worker — proves the pipeline without running anything",
  capabilities: ["code", "research", "review"],

  // It writes no files and claims no work, so routing must never pick it to
  // do any. Choosing it by hand, to rehearse the pipeline, is the point.
  simulated: true,

  healthCheck: async () => ({ available: true }),

  async start(
    job: WorkerJob,
    { emit, signal, worktreePath, contextPacket }: WorkerRunContext,
  ): Promise<WorkerJobResult> {
    // The packet is what a real worker would be handed; reporting its size is
    // how an operator can tell the scoping actually happened.
    emit("job.progress", "Reading project context", {
      contextBytes: contextPacket.length,
      contextFiles: job.contextFiles?.length ?? 0,
    });
    await pause(STEP_MS, signal);

    emit("tool.started", "Planning the change");
    await pause(STEP_MS, signal);
    emit("tool.completed", "Plan ready");

    emit("job.progress", `Implementing: ${job.objective}`);
    await pause(STEP_MS, signal);

    const tests = [];

    // Validation is rehearsed, not run: Mock must never claim a command
    // succeeded when it never executed one.
    for (const command of job.validationCommands ?? []) {
      emit("validation.started", command);
      await pause(STEP_MS, signal);
      emit("validation.completed", `${command} — rehearsed, not executed`, {
        command,
        executed: false,
      });

      tests.push({
        command,
        success: true,
        detail: "Rehearsed by the mock worker; nothing was executed.",
      });
    }

    await pause(STEP_MS, signal);

    return {
      summary: worktreePath
        ? "Mock run completed. An isolated worktree was prepared; no files were changed."
        : "Mock run completed. No worktree was requested and no files were changed.",
      changedFiles: [],
      tests,
      worktreePath,
    };
  },

  async steer(_jobId: string, instruction: string): Promise<void> {
    // Accepting guidance is enough to prove the path; a mock has no plan to
    // change in response to it.
    if (instruction.trim().length === 0) {
      throw new Error("Guidance cannot be empty.");
    }
  },
};
