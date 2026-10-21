import type { WorkerValidation } from "../../shared/worker-types";

/**
 * Whether an implementation attempt actually did the work.
 *
 * A worker that wrote nothing, then had `npm run build` run against the
 * unchanged tree, used to be recorded as a pass because the output was
 * non-empty. That is a rehearsal of the baseline, not evidence the objective
 * was met.
 */

export interface AttemptJudgement {
  /** The attempt failed to implement anything. */
  failed: boolean;
  /** Skip the job's build/browser checks: they would only describe the baseline. */
  skipValidation: boolean;
  /** What to write on the attempt's validation field. */
  detail: string;
  /** Blocker shown on the job when the worker changed nothing. */
  blocker?: string;
}

export interface AttemptHonestyInput {
  /** Simulated workers write nothing on purpose and are not judged as implementations. */
  simulated?: boolean;
  /** Coding jobs have a worktree; text jobs do not. */
  worktreePath?: string;
  changedFiles: readonly string[];
  /** Whether this worker is expected to change code. */
  implementsCode: boolean;
}

export function judgeImplementationAttempt(input: AttemptHonestyInput): AttemptJudgement {
  if (input.simulated || !input.worktreePath || !input.implementsCode) {
    return {
      failed: false,
      skipValidation: false,
      detail: input.worktreePath
        ? "The worker finished in an isolated checkout."
        : "No repository was involved; the deliverable is the reply itself.",
    };
  }

  if (input.changedFiles.length === 0) {
    return {
      failed: true,
      skipValidation: true,
      detail: "The worker produced no file changes. Implementation jobs cannot pass without a diff.",
      blocker:
        "The worker made no file changes. Build and browser checks were skipped (they would only describe the unchanged baseline). This job did not meet its objective.",
    };
  }

  return {
    failed: false,
    skipValidation: false,
    detail: `The worker changed ${input.changedFiles.length} file${input.changedFiles.length === 1 ? "" : "s"}.`,
  };
}

/** Label a validation row that ran against an unchanged tree, if one is kept. */
export function baselineValidation(command: string): WorkerValidation {
  return {
    command,
    success: false,
    detail: "baseline (no changes) — not evidence the objective passed.",
  };
}
