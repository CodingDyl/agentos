import type { WorkerId } from "../../shared/worker-ids";
import type { WorkerJob, WorkerJobRequest } from "../../shared/worker-types";
import { isRunning, startJob } from "../workers/job-manager";
import { readJob, saveJob } from "../workers/job-store";
import { getWorker } from "../workers/registry";
import { changedFiles, commitWorktree, fastForward, removeWorktree } from "../workers/worktree";
import { tagRevision } from "./client-repo";

/**
 * The rebuild's use of AgentOS workers.
 *
 * Each stage names its workers in order of preference; the first one that is
 * switched on and healthy gets the job, so subscriptions (Claude Code, Codex)
 * are used before paid API calls. A manual worker (Grok Bot, which waits for
 * you to paste its instruction into Grok) is never picked automatically: only
 * when you choose it for a stage, and even then the wait has a limit. The job runs through the normal
 * worker pipeline: an isolated worktree, and AgentOS running the validation
 * commands itself rather than trusting the worker.
 *
 * What the rebuild does differently is the end: instead of Hermes' review and
 * a second approval screen, a validated job is committed into the client repo
 * as a tagged revision, and the person approves it on the rebuild page with
 * screenshots in front of them.
 */

export class WorkerStageBlocked extends Error {}

export interface PickedWorker {
  id: WorkerId;
  name: string;
}

export interface WorkerDeps {
  health: (id: WorkerId) => Promise<{ available: boolean; name: string; reason?: string; manualOnly?: boolean }>;
  start: (request: WorkerJobRequest) => Promise<{ job?: WorkerJob; error?: string }>;
  read: (jobId: string) => Promise<WorkerJob | undefined>;
  sleep: (ms: number) => Promise<void>;
  /** Milliseconds, for how long a hand-started worker has been waited on. Defaults to the clock. */
  now?: () => number;
}

export const defaultWorkerDeps: WorkerDeps = {
  health: async (id) => {
    const worker = getWorker(id);
    if (!worker) return { available: false, name: id, reason: "not installed in AgentOS" };
    const health = await worker.healthCheck().catch(() => ({ available: false, reason: "could not report its health" }));
    return { available: health.available, name: worker.name, reason: health.reason, manualOnly: worker.manualOnly };
  },
  start: (request) => startJob(request),
  read: readJob,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * The first worker in the list that is ready, or a blocker naming what to
 * switch on. A hand-started worker counts only when it was chosen (`chosen`):
 * picked automatically, it would sit waiting for someone who doesn't know.
 */
export async function pickWorker(candidates: readonly WorkerId[], deps: WorkerDeps = defaultWorkerDeps, chosen = false): Promise<PickedWorker> {
  const reasons: string[] = [];
  for (const id of candidates) {
    const health = await deps.health(id);
    if (health.manualOnly && !chosen) {
      reasons.push(`${health.name}: started by hand, so only used when you choose it with "Try another worker"`);
      continue;
    }
    if (health.available) return { id, name: health.name };
    reasons.push(`${health.name}: ${health.reason ?? "not available"}`);
  }
  throw new WorkerStageBlocked(
    `No worker for this stage is available. Switch one on in Operations → AI Stack. ${reasons.join("; ")}.`,
  );
}

const FAILED = new Set(["failed", "cancelled", "rejected"]);

/** A job this stage can keep waiting on, rather than starting a duplicate. */
export function resumable(job: WorkerJob | undefined): job is WorkerJob {
  return Boolean(job && !FAILED.has(job.status));
}

export interface JobWatch {
  /** Called every poll: shows progress on the stage and renews its lease. */
  onProgress: (message: string) => void;
  /** Called once with the new job's id, so a restart can resume it. */
  onStarted: (jobId: string) => void;
  pollMs?: number;
  /** The person chose this worker for the stage, rather than the plan's order picking it. */
  chosen?: boolean;
}

/** How long a stage waits on a hand-started worker before it stops and asks. */
export const MANUAL_WAIT_MS = 30 * 60_000;

function manualWaitBlocker(workerName: string, jobId: string): string {
  return (
    `Still waiting for you to run ${workerName} (job ${jobId}). It only starts when you paste its instruction into ${workerName === "Grok Bot" ? "Grok" : "it"}. ` +
    `Either open the job in Workers, copy the instruction, run it, then Retry to keep waiting; or Try another worker, which runs on its own.`
  );
}

function describe(job: WorkerJob, workerName: string): string {
  if (job.bridge && !job.bridge.importedAt) return `Waiting for you to run ${workerName} on the task it was given (job ${job.id}).`;
  switch (job.status) {
    case "queued":
    case "preparing":
      return `${workerName} is getting ready`;
    case "validating":
      return `Checking ${workerName}'s work (build, lint, tests)`;
    default:
      return `${workerName} is working (${job.status})`;
  }
}

/** What to do about a failed job, in the person's terms. A login problem is not fixed by retrying. */
export function nextStep(worker: PickedWorker, error: string): string {
  if (/authenticat|oauth|log ?in|not logged|unauthori[sz]ed|credentials|session expired/i.test(error)) {
    return worker.id === "claude-code"
      ? "Claude Code's login on this machine has lapsed: run `claude` in a terminal and use /login (or set CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` in .env), then retry, or try another worker."
      : `${worker.name} needs signing in again on this machine. Sign in, then retry, or try another worker.`;
  }
  if (/usage limit|rate limit|quota|credit/i.test(error)) return `${worker.name} has hit a usage limit. Wait for it to reset, or try another worker.`;
  return "Retry to start a fresh attempt, or try another worker.";
}

/**
 * Starts the job, or picks up the one already started for this stage, and
 * waits until its work is ready to look at. A failed job is a blocker that
 * says why; nothing is retried behind the person's back.
 */
export async function runJob(
  /** Built once the worker is known: a file-bridge worker gets no checkout, a CLI worker does. */
  buildRequest: (worker: PickedWorker) => Omit<WorkerJobRequest, "worker">,
  candidates: readonly WorkerId[],
  existingJobId: string | undefined,
  watch: JobWatch,
  deps: WorkerDeps = defaultWorkerDeps,
): Promise<{ job: WorkerJob; worker: PickedWorker }> {
  let job = existingJobId ? await deps.read(existingJobId) : undefined;
  let worker: PickedWorker;

  if (resumable(job)) {
    const id = (job.resolvedWorker ?? job.worker) as WorkerId;
    const health = await deps.health(id);
    worker = { id, name: health.name };
    // A hand-started job the plan picked on its own (before that stopped) is not left waiting
    // for someone who may not know about it: the stage stops and offers the choice.
    if (health.manualOnly && !watch.chosen && job.bridge && !job.bridge.importedAt) {
      throw new WorkerStageBlocked(manualWaitBlocker(worker.name, job.id));
    }
    watch.onProgress(`Resuming ${worker.name}'s job ${job.id}`);
  } else {
    worker = await pickWorker(candidates, deps, watch.chosen);
    watch.onProgress(`Starting ${worker.name}`);
    const started = await deps.start({ ...buildRequest(worker), worker: worker.id, requestedWorker: worker.id });
    if (!started.job) throw new WorkerStageBlocked(`${worker.name} could not start: ${started.error ?? "no reason given"}.`);
    job = started.job;
    watch.onStarted(job.id);
  }

  const now = deps.now ?? Date.now;
  const waitingSince = now();
  for (;;) {
    const current = await deps.read(job.id);
    if (!current) throw new WorkerStageBlocked(`The job ${job.id} has disappeared from AgentOS.`);
    job = current;
    if (job.status === "awaiting_review" || job.status === "completed" || job.status === "approved") return { job, worker };
    if (FAILED.has(job.status) || job.status === "changes_required") {
      const tests = (job.result?.tests ?? []).filter((test) => !test.success).map((test) => test.command);
      throw new WorkerStageBlocked(
        `${worker.name}'s job ${job.id} ${job.status === "changes_required" ? "needs changes" : job.status}: ${job.error ?? job.result?.summary ?? "no detail"}${tests.length > 0 ? ` (failed: ${tests.join(", ")})` : ""}. ${nextStep(worker, job.error ?? "")}`,
      );
    }
    // A worker someone has to start by hand gets a fixed wait from when this stage began
    // watching (a Retry starts a fresh wait on the same job); then the stage asks.
    if (job.bridge && !job.bridge.importedAt && now() - waitingSince > MANUAL_WAIT_MS) {
      throw new WorkerStageBlocked(manualWaitBlocker(worker.name, job.id));
    }
    watch.onProgress(describe(job, worker.name));
    await deps.sleep(watch.pollMs ?? 4_000);
  }
}

/**
 * Puts a finished job's work into the client repo as one tagged commit and
 * closes the job. Called only after AgentOS' own validation passed.
 */
export async function integrateJob(job: WorkerJob, repo: string, message: string, tag: string): Promise<string> {
  if (job.integratedCommit) return job.integratedCommit;
  if (!job.worktreePath || !job.workerBranch) throw new WorkerStageBlocked(`Job ${job.id} has no checkout to bring into the client repo.`);
  if (isRunning(job.id)) throw new WorkerStageBlocked(`Job ${job.id} is still running.`);
  if ((await changedFiles(job.worktreePath)).length === 0) throw new WorkerStageBlocked(`The worker finished job ${job.id} without changing any files. Retry, or request changes with more detail.`);

  const commit = await commitWorktree(job.worktreePath, message);
  await fastForward(repo, job.workerBranch);
  await tagRevision(repo, commit, tag);
  await removeWorktree(repo, job.id);
  await saveJob({ ...job, status: "completed", approvedAt: new Date().toISOString(), integratedCommit: commit, worktreePath: undefined });
  return commit;
}
