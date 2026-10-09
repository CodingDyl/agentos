import type {
  WorkerArtifact,
  WorkerEvent,
  WorkerEventType,
  WorkerId,
  WorkerJob,
  WorkerJobRequest,
  WorkerJobStatus,
} from "../../shared/worker-types";
import type { ArtifactSource } from "../../shared/agentos-types";
import { parseArtifactDeclarations, registerJobArtifacts } from "../agentos/mutations/documents";
import { projectTaskLinks, saveTaskLink } from "../agentos/task-jobs";
import type { VisualVerificationResult } from "../../shared/visual-verification-types";
import { recordActivity } from "../activity/ui-events";
import {
  verifyJobVisually,
  wantsVisualVerification,
} from "../visual-verification";
import type { WorkerRoutingDecision } from "../../shared/worker-routing-types";
import { collectWorkerUsage } from "../usage/collector";
import { buildContextPacket, resolveContextFiles } from "./context-builder";
import { listConnectors } from "../connectors/registry";
import { SkillError, skillForJob } from "../skills/registry";
import { retrieveMemoryContext } from "../memory/retrieval";
import { memoryService } from "../memory/service";
import {
  beginAttempt,
  bridgeAttempt,
  failureInfo,
  finishAttempt,
  initialOption,
  nextFallback,
  planRoute,
} from "../route-policy/dispatch";
import { validateOutput } from "./providers/ollama-worker";
import { routeJob } from "./router";
import {
  appendEvent,
  createJobId,
  listJobs,
  readEvents,
  readJob,
  saveJob,
} from "./job-store";
import { getWorker } from "./registry";
import { authorize } from "../connectors/policy";
import { runValidation } from "./validation";
import { createWorkerEvent, type Worker } from "./worker";
import { repositoryProblem } from "../agentos/git";
import { changedFiles, createWorktree, isRepository } from "./worktree";

/**
 * Runs jobs.
 *
 * One place decides the shape of every delegated task: validate it, resolve a
 * worker, isolate the work, start it, record what happens, and write down what
 * came back. Workers differ; this does not.
 *
 * A running job lives in memory — its events stream to whoever is watching —
 * while its record and its event log are written to disk as it goes, so a
 * restart loses the stream but never the history.
 *
 * Because the run lives in this process, the process dying is the one failure
 * the run loop itself cannot record. Three things cover it: every event
 * updates a heartbeat on the record; a shutdown signal marks live jobs
 * interrupted before the process exits; and startup settles any job still
 * claiming to be live with nothing running it. A stall watch turns silence
 * into a visible warning in between.
 */

/**
 * A worker returned something that does not meet the task's output rules.
 * Carries a `kind` so failure handling can tell it from a crash.
 */
class OutputRejected extends Error {
  readonly kind = "invalid_output";
  readonly fallbackEligible = true;

  constructor(reason: string) {
    super(`The result was rejected: ${reason}`);
    this.name = "OutputRejected";
  }
}

/** Live runs, so a job can be cancelled and its events subscribed to. */
interface RunningJob {
  worker: Worker;
  controller: AbortController;
  listeners: Set<(event: WorkerEvent) => void>;
}

const running = new Map<string, RunningJob>();

/**
 * Jobs this process is not executing itself but can still observe — Claude
 * Motion, started detached, watched by pid. Without this, `isRunning` is
 * always false for them and every screen hedges "may have finished".
 */
const external = new Set<string>();

/** Marks a detached run as observed and live. Idempotent. */
export function claimExternalRun(jobId: string): void {
  external.add(jobId);
}

/** Drops a detached run once it has settled or its pid is gone. */
export function releaseExternalRun(jobId: string): void {
  external.delete(jobId);
}

/**
 * Statuses a job never moves out of on its own.
 *
 * `awaiting_review` is settled rather than finished: the run is over, nothing
 * is executing, and what happens next is a person's decision. Treating it as
 * still running would leave the console offering to cancel a job that stopped
 * some time ago.
 */
const TERMINAL: readonly WorkerJobStatus[] = [
  "awaiting_review",
  "completed",
  "failed",
  "cancelled",
];

export function isTerminal(status: WorkerJobStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * Subscribes to a live job's events.
 *
 * Returns a function that stops listening. A job that is not running has
 * nothing to stream — its history is read from disk instead.
 */
export function subscribe(
  jobId: string,
  listener: (event: WorkerEvent) => void,
): () => void {
  const job = running.get(jobId);
  if (!job) return () => undefined;

  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
}

export function isRunning(jobId: string): boolean {
  return running.has(jobId) || external.has(jobId);
}

/**
 * Resolves which worker runs this job.
 *
 * `auto` is answered by routing rather than by a guess. The decision comes
 * back with the id so it can be recorded on the job: a routed job that did not
 * keep the reasoning behind it would be indistinguishable afterwards from one
 * an operator picked, which is the one distinction routing exists to make.
 *
 * A decision the caller already has is honoured as-is. The console shows the
 * recommendation before anything starts, so re-routing here would risk running
 * a different decision from the one the operator actually agreed to.
 */
export async function resolveWorkerId(
  requested: WorkerId | "auto",
  job: { objective: string; project: string },
  existing?: WorkerRoutingDecision,
): Promise<{
  id?: WorkerId;
  routing?: WorkerRoutingDecision;
  error?: string;
}> {
  if (requested !== "auto") return { id: requested, routing: existing };

  if (existing) {
    return { id: existing.selectedWorker, routing: existing };
  }

  const { decision, error } = await routeJob(job);

  if (!decision) {
    return {
      error: error ?? "No worker could be selected for this job.",
    };
  }

  return { id: decision.selectedWorker, routing: decision };
}

export interface StartJobResult {
  job?: WorkerJob;
  error?: string;
}

/**
 * Creates a job and starts it.
 *
 * Returns as soon as the job is recorded and running: the work itself is
 * asynchronous, and progress arrives on the event stream. Everything that can
 * be refused is refused here, before a worker is ever started.
 */
export async function startJob(
  request: WorkerJobRequest,
  /** Fields the job carries from birth that are not part of the request, e.g. `retryOf`. */
  extra: Pick<Partial<WorkerJob>, "retryOf" | "skill"> = {},
): Promise<StartJobResult> {
  let resolved: Awaited<ReturnType<typeof resolveWorkerId>>;

  // A named skill is checked and copied first: a disabled skill, or one whose
  // connectors are not connected, never leaves a job behind. A retry brings
  // the copy its first attempt had, so it runs by the same instructions.
  let skill = extra.skill;
  if (!skill && request.skillId) {
    try {
      skill = await skillForJob(request.skillId, {
        connectors: async () => (await listConnectors()).connectors,
        activeRuns: () => 0,
      });
    } catch (error) {
      return { error: error instanceof SkillError ? error.message : "The skill could not be read." };
    }
  }

  // The route policy plans a job once, here, before anything runs. A decision
  // the caller already holds (the console showed it) is honoured as-is, and a
  // plain explicit worker with no routing mode keeps its legacy behaviour.
  const wantsPolicy =
    !request.routing?.policy && (request.routingMode !== undefined || request.worker === "auto");

  const planned = wantsPolicy
    ? await planRoute({
        ...request,
        manualOptionId:
          request.manualOptionId ?? (request.worker !== "auto" ? request.worker : undefined),
      })
    : undefined;

  if (planned) {
    if (planned.record.status === "blocked" || !planned.decision) {
      return { error: planned.record.blockedReason ?? planned.record.reason };
    }
    resolved = { id: planned.decision.selectedWorker, routing: planned.decision };
  } else {
    resolved = await resolveWorkerId(
      request.worker,
      { objective: request.objective, project: request.project },
      request.routing,
    );
  }

  if (!resolved.id) return { error: resolved.error };

  const worker = getWorker(resolved.id);
  if (!worker) return { error: `There is no worker called ${resolved.id}.` };

  // Health is checked before anything is created, so an unavailable worker
  // never leaves a job record or a worktree behind.
  const health = await worker.healthCheck().catch(() => ({
    available: false,
    reason: "The worker could not report its health.",
  }));

  if (!health.available) {
    return { error: health.reason ?? `${worker.name} is not available.` };
  }

  // Claude and Grok are connectors too; their switch is the AI stack's, which
  // the health check above already honours. This only records the run.
  if (worker.id === "claude" || worker.id === "grok") {
    authorize(`${worker.id}.run_job`, { initiator: "system", detail: request.project ? `Job for ${request.project}` : "Coding job" });
  }

  let job: WorkerJob = {
    ...request,
    // Whatever named these — Hermes scoping, a retry, a hand-typed form — the
    // worker gets paths that exist, or none.
    contextFiles: request.contextFiles
      ? await resolveContextFiles(request.contextFiles, {
          slug: request.project,
          repoPath: request.repoPath,
        })
      : undefined,
    // Retrieved now and kept on the record: the brief this job runs with is
    // fixed at birth, whatever is edited in the vault afterwards.
    memoryContext: await retrieveMemoryContext(memoryService(), {
      project: request.project,
      query: request.objective,
    }).catch((error: unknown) => ({
      status: "unavailable" as const,
      retrievedAt: new Date().toISOString(),
      budgetTokens: 0,
      usedTokens: 0,
      query: request.objective,
      sources: [],
      missing: [],
      warnings: [`Vault memory could not be retrieved: ${(error as Error).message}`],
      text: "",
    })),
    id: createJobId(),
    status: "queued",
    resolvedWorker: worker.id,
    // What was asked for, which is not always what ran.
    requestedWorker: request.requestedWorker ?? request.worker,
    routing: resolved.routing,
    revision: 1,
    createdAt: new Date().toISOString(),
    ...extra,
    ...(skill ? { skill } : {}),
  };

  // First attempt of a policy-routed job: the exact option, recorded before
  // it runs so a crash still shows where the work was sent.
  const first = initialOption(job);
  if (first) job = beginAttempt(job, first, "initial");

  await saveJob(job);

  // Recorded before the job starts, and as its own happening. Who chose the
  // worker is a different fact from what the worker then did, and a timeline
  // that folded them together would lose the only record of a decision that
  // was made on the operator's behalf.
  if (job.routing) {
    const overridden = job.routing.selectedWorker !== worker.id;

    await recordActivity({
      type: "worker.routed",
      description: overridden
        ? `${job.routing.selectedWorker} recommended, ${worker.name} chosen instead: ${job.objective}`
        : `${worker.name} selected for: ${job.objective}`,
      project: job.project,
      metadata: {
        jobId: job.id,
        worker: worker.id,
        recommended: job.routing.selectedWorker,
        confidence: job.routing.confidence,
        decidedBy: job.routing.decidedBy,
        taskType: job.routing.taskType,
        overridden,
      },
    });
  }

  await recordActivity({
    type: "worker.started",
    description: `${worker.name}: ${job.objective}`,
    project: job.project,
    metadata: { jobId: job.id, worker: worker.id },
  });

  // Deliberately not awaited: the caller gets the job, the work continues.
  void run(job, worker);

  return { job };
}

/**
 * Serialises event writes.
 *
 * Order is part of what an event log means: "validation started, validation
 * completed" is a different story from the two arriving the other way round.
 * Appends are queued so the file records them in the order they happened.
 */
let writes: Promise<unknown> = Promise.resolve();

/**
 * Records one event: to anyone watching, and to disk.
 *
 * Listeners are notified synchronously, before the write is even queued —
 * a subscriber must see events in the order the worker emitted them, not in
 * whatever order the filesystem got round to them.
 */
function emit(
  jobId: string,
  type: WorkerEventType,
  message?: string,
  metadata?: Record<string, unknown>,
): void {
  const event = createWorkerEvent(jobId, type, message, metadata);

  for (const listener of running.get(jobId)?.listeners ?? []) {
    listener(event);
  }

  writes = writes.then(() => appendEvent(event));

  // Every event is proof of life. The stall watch reads this; the record on
  // disk gets it too, so the console can say "last heard from 2 min ago" for
  // a job whose stream it is not subscribed to.
  if (type !== "job.stalled") heartbeat(jobId, event.timestamp);
}

/**
 * Liveness.
 *
 * `lastEventAt` and `stalledSince` are facts about a run in *this* process, so
 * they live in memory and are merged into the record on every write the run
 * makes (`update`), and onto every read the API serves (`withLiveness`). No
 * second writer races the run loop; the disk copy is simply the last thing
 * the run wrote, which for a job that ended is exact.
 */
export interface Liveness {
  lastEventAt?: string;
  stalledSince?: string;
}

const liveness = new Map<string, Liveness>();

function heartbeat(jobId: string, at: string): void {
  // A fresh event ends a stall.
  liveness.set(jobId, { lastEventAt: at, stalledSince: undefined });
}

/** What this process knows about a job's pulse, or nothing for a job it is not running. */
export function livenessOf(jobId: string): Liveness | undefined {
  return liveness.get(jobId);
}

/** A record with the live pulse laid over it. For the API; cheap. */
export function withLiveness<T extends WorkerJob>(job: T): T {
  const live = liveness.get(job.id);
  return live ? { ...job, ...live } : job;
}

/**
 * How long a live job may be silent before the console is told.
 *
 * Long enough for a slow model turn or a big test run; short enough that a
 * worker that has hung is noticed within the hour rather than the day.
 */
const STALL_MS = Number(process.env.AGENTOS_JOB_STALL_MS) > 0
  ? Number(process.env.AGENTOS_JOB_STALL_MS)
  : 5 * 60 * 1000;

const STALL_SWEEP_MS = 30_000;

/**
 * Notices silence.
 *
 * Only for jobs with a live runner in this process — a job with no runner is
 * not stalled, it is interrupted, and that is settled at startup. A stall is
 * a warning: the run continues, the worker's own timeout still applies, and
 * the operator can now see it and choose to cancel.
 */
async function sweepForStalls(): Promise<void> {
  const now = Date.now();

  for (const jobId of running.keys()) {
    const live = liveness.get(jobId);
    if (!live?.lastEventAt || live.stalledSince) continue;

    const silentFor = now - new Date(live.lastEventAt).getTime();
    if (silentFor < STALL_MS) continue;

    const job = await readJob(jobId).catch(() => undefined);
    if (!job || isTerminal(job.status)) continue;
    // Waiting for a person to trigger Grok is not silence worth a warning.
    if (isParkedOnBridge(job)) continue;

    live.stalledSince = new Date().toISOString();
    await saveJob(withLiveness(job));

    emit(
      jobId,
      "job.stalled",
      `No activity for ${Math.round(silentFor / 60_000)} minutes. Still running; cancel if it is not coming back.`,
      { lastEventAt: live.lastEventAt, silentForMs: silentFor },
    );

    await recordActivity({
      type: "worker.stalled",
      description: `${job.resolvedWorker ?? job.worker}: silent for ${Math.round(silentFor / 60_000)} min: ${job.objective.slice(0, 80)}`,
      project: job.project,
      metadata: { jobId, worker: job.resolvedWorker ?? job.worker, lastEventAt: live.lastEventAt },
    });
  }
}

let stallWatch: NodeJS.Timeout | undefined;

/** Starts the stall watch. Idempotent; called once at boot. */
export function startStallWatch(): void {
  if (stallWatch) return;
  stallWatch = setInterval(() => void sweepForStalls(), STALL_SWEEP_MS);
  stallWatch.unref?.();
}

/**
 * A job parked on a file bridge: its task is on the SSD and nothing has come
 * back yet. Nothing is executing, so a restart does not lose it — the next
 * process picks the wait up again from the job record.
 */
export function isParkedOnBridge(job: WorkerJob): boolean {
  return job.status === "waiting" && Boolean(job.bridge) && !job.bridge?.importedAt;
}

/** Statuses that mean "a process is supposed to be doing something right now". */
const LIVE: readonly WorkerJobStatus[] = [
  "queued",
  "preparing",
  "running",
  "waiting",
  "validating",
  "visual_validating",
  "reviewing",
  "approved",
  "integrating",
];

function interruptionMessage(job: WorkerJob, reason: string): string {
  const last = job.lastEventAt ?? job.startedAt ?? job.createdAt;
  return `Interrupted: ${reason} (last activity ${last}). The work cannot be resumed; retry to start a fresh run.`;
}

/**
 * Settles jobs the last process left behind.
 *
 * A job record that says `running` when no process is running it is the worst
 * kind of lie the console can tell: it looks like progress and it never ends.
 * This is the fix for that. At boot, every job in a live status with no
 * runner in memory — which at boot is all of them — is marked interrupted,
 * with when it was last heard from, so the operator sees a failure they can
 * retry rather than a spinner they cannot trust.
 *
 * `awaiting_review` and `changes_required` are not live: nothing is executing,
 * and the work is intact on disk waiting for a person.
 */
export async function reconcileInterruptedJobs(
  reason = "AgentOS restarted while this job was running",
): Promise<WorkerJob[]> {
  const interrupted: WorkerJob[] = [];

  let jobs: WorkerJob[];
  try {
    jobs = await listJobs(500);
  } catch {
    return interrupted;
  }

  for (const job of jobs) {
    if (!LIVE.includes(job.status) || running.has(job.id)) continue;

    // A job waiting on a file bridge was never running; pick the wait back up.
    const bridgeWorker = isParkedOnBridge(job) ? getWorker(job.resolvedWorker ?? job.worker as WorkerId) : undefined;
    if (bridgeWorker) {
      emit(job.id, "job.progress", "AgentOS restarted. Still awaiting the result file", { resultPath: job.bridge?.resultPath });
      void run(job, bridgeWorker);
      continue;
    }

    const at = new Date().toISOString();
    const message = interruptionMessage(job, reason);

    const next: WorkerJob = {
      ...job,
      status: "failed",
      error: message,
      interruptedAt: at,
      completedAt: at,
      stalledSince: undefined,
    };

    await saveJob(next);
    emit(job.id, "job.interrupted", message, { reason, lastEventAt: job.lastEventAt });

    await recordActivity({
      type: "worker.interrupted",
      description: `${job.resolvedWorker ?? job.worker}: ${job.objective.slice(0, 80)}`,
      project: job.project,
      metadata: { jobId: job.id, worker: job.resolvedWorker ?? job.worker, reason },
    });

    interrupted.push(next);
  }

  await flushEvents();
  return interrupted;
}

/**
 * The process is going down: say so on every live job before it does.
 *
 * `tsx watch` sends SIGTERM before it restarts, and a Ctrl-C sends SIGINT, so
 * in development this is the common path. Each run is aborted, marked
 * interrupted with the reason, and its events flushed. Startup reconciliation
 * is the backstop for the cases this cannot catch — a kill -9, a crash.
 */
export async function interruptRunningJobs(reason: string): Promise<void> {
  const live = [...running.entries()];

  for (const [jobId, entry] of live) {
    // Take the job away from its run loop *before* aborting it. The loop's
    // failure path only writes if the entry still holds its controller, and
    // it runs during the awaits below; left in place, it wrote `cancelled`
    // over a job parked on the bridge, and over a job about to be marked
    // interrupted. Swapping the controller (rather than deleting the entry)
    // keeps the listeners, so the interruption still reaches open streams.
    running.set(jobId, { ...entry, controller: new AbortController() });
    entry.controller.abort();
    await entry.worker.cancel?.(jobId).catch(() => undefined);

    const job = await readJob(jobId).catch(() => undefined);
    if (!job || isTerminal(job.status)) {
      running.delete(jobId);
      continue;
    }

    // Parked on the SSD: the task is safe there and the next process resumes
    // the wait. Only the in-memory runner goes.
    if (isParkedOnBridge(job)) {
      running.delete(jobId);
      continue;
    }

    const at = new Date().toISOString();
    const message = interruptionMessage(withLiveness(job), reason);

    await saveJob({
      ...withLiveness(job),
      status: "failed",
      error: message,
      interruptedAt: at,
      completedAt: at,
      stalledSince: undefined,
    });

    emit(jobId, "job.interrupted", message, { reason });
    // The run loop's own failure path would now write `cancelled` over this;
    // dropping the runner first means it finds nothing to update.
    running.delete(jobId);
  }

  await flushEvents();
}

/**
 * Runs a job again from scratch: same brief, fresh worktree, new id.
 *
 * For a job that failed or was interrupted. Not a revision — there is no
 * review to respond to and possibly no work to continue — so it is a new job
 * that remembers which one it replaced.
 */
/**
 * Starts a fresh run of a finished job. `worker` hands it to someone else:
 * the answer to a worker that ran out of quota is rarely the same worker.
 */
export async function retryJob(jobId: string, options: { worker?: WorkerId } = {}): Promise<StartJobResult> {
  const previous = await readJob(jobId);
  if (!previous) return { error: "That job does not exist." };

  if (!isTerminal(previous.status) || running.has(jobId)) {
    return { error: "Only a finished job can be retried. Cancel it first." };
  }

  const worker = options.worker ?? previous.requestedWorker ?? previous.worker;
  const request: WorkerJobRequest = {
    worker,
    requestedWorker: worker,
    project: previous.project,
    objective: previous.objective,
    repoPath: previous.sourceRepoPath ?? previous.repoPath,
    baseRef: previous.baseRef,
    contextFiles: previous.contextFiles,
    constraints: previous.constraints,
    acceptanceCriteria: previous.acceptanceCriteria,
    validationCommands: previous.validationCommands,
    visualAcceptance: previous.visualAcceptance,
    skillId: previous.skillId,
  };

  const started = await startJob(request, { retryOf: previous.id, ...(previous.skill ? { skill: previous.skill } : {}) });

  if (started.job) {
    emit(started.job.id, "job.progress", `Retry of ${previous.id}`, { retryOf: previous.id });

    // The task follows the retry. A task that stayed linked to the dead
    // attempt would show "interrupted" while the fresh run finished unseen,
    // and its artifacts would be filed under a job id rather than under it.
    const link = (await projectTaskLinks(previous.project)).find((entry) => entry.jobId === previous.id);

    if (link) {
      await saveTaskLink({ ...link, jobId: started.job.id, delegatedAt: started.job.createdAt, completedAt: undefined });
    }
  }

  return started;
}

/**
 * Registers the documents a run produced.
 *
 * Never fails the job: a document that could not be copied is a lost
 * convenience, not a broken run. Each registration is its own event and its
 * own activity entry, so the timeline can say "Claude created Implementation
 * Plan" rather than burying it in a completion message.
 */
async function collectArtifacts(
  job: WorkerJob,
  worker: Worker,
  worktreePath: string,
  summary: string,
  changed: readonly string[],
): Promise<WorkerArtifact[]> {
  try {
    const link = (await projectTaskLinks(job.project)).find((entry) => entry.jobId === job.id);
    const source: ArtifactSource =
      worker.id === "claude" ? "claude" : worker.id === "grok" ? "grok" : "human";

    const { registered, skipped } = await registerJobArtifacts({
      job,
      worktreePath,
      declared: parseArtifactDeclarations(summary),
      changedFiles: changed,
      taskId: link?.taskId,
      source: worker.id === "mock" ? "claude" : source,
    });

    for (const artifact of registered) {
      emit(job.id, "artifact.created", `${artifact.detected ? "Found" : "Kept"} ${artifact.title}`, {
        path: artifact.registeredPath,
        type: artifact.type,
        detected: artifact.detected ?? false,
      });

      await recordActivity({
        type: "document.created",
        description: `${worker.name} created ${artifact.title}`,
        project: job.project,
        metadata: { jobId: job.id, taskId: link?.taskId, path: artifact.registeredPath, type: artifact.type },
      });
    }

    for (const entry of skipped) {
      emit(job.id, "job.progress", `Artifact skipped: ${entry.path} (${entry.reason})`);
    }

    return registered;
  } catch (error) {
    console.error("[agentos] could not register a job's artifacts:", error);
    return [];
  }
}

/** Waits for queued writes, so a finished job's log is complete on disk. */
function flushEvents(): Promise<unknown> {
  return writes;
}

async function update(
  job: WorkerJob,
  changes: Partial<WorkerJob>,
): Promise<WorkerJob> {
  // The pulse rides along on every write, so a status change never erases
  // when the worker was last heard from.
  const next = { ...job, ...liveness.get(job.id), ...changes };
  await saveJob(next);
  return next;
}

/**
 * The job lifecycle.
 *
 * Prepare, isolate, run, record. Every exit — success, failure, cancellation —
 * writes a terminal state, so a job is never left claiming to be running when
 * nothing is.
 */
async function run(
  initial: WorkerJob,
  worker: Worker,
  /**
   * The brief to send instead of the job's own.
   *
   * Used for a revision: the worker is continuing work it already did, in the
   * checkout it already has, and needs the review findings rather than the
   * original packet.
   */
  briefOverride?: string,
): Promise<void> {
  const controller = new AbortController();
  // A fallback attempt is a second run of the same job. Whoever is watching
  // its stream keeps watching.
  const priorListeners = running.get(initial.id)?.listeners;
  running.set(initial.id, { worker, controller, listeners: priorListeners ?? new Set() });

  let job = initial;

  try {
    job = await update(job, {
      status: "preparing",
      // A resumed bridge job started when it was first exported.
      startedAt: job.bridge ? (job.startedAt ?? new Date().toISOString()) : new Date().toISOString(),
    });

    emit(job.id, "job.started", `${worker.name} picked up the job`);

    // Coding work is isolated, always. A worker never edits the live checkout.
    //
    // A revision reuses the checkout it already has: making a second worktree
    // would throw away the work being revised and review something else.
    if (job.worktreePath) {
      emit(job.id, "job.progress", `Continuing in the existing worktree`, {
        worktree: job.worktreePath,
        revision: job.revision ?? 1,
      });
    } else if (job.repoPath && worker.capabilities.includes("code")) {
      if (!(await isRepository(job.repoPath))) {
        throw new Error(await repositoryProblem(job.repoPath));
      }

      const worktree = await createWorktree(job.repoPath, job.id, job.baseRef);

      // Where this came from and what it was branched off. Checked again
      // before anything is integrated, so work reviewed against one commit is
      // never fast-forwarded onto a different one.
      job = await update(job, {
        worktreePath: worktree.path,
        sourceRepoPath: job.repoPath,
        baseCommit: worktree.baseRef,
        targetBranch: worktree.targetBranch,
        workerBranch: worktree.branch,
      });

      emit(job.id, "job.progress", "Isolated worktree created", {
        worktree: worktree.path,
        branch: worktree.branch,
        base: worktree.baseRef,
        targetBranch: worktree.targetBranch,
      });
    }

    job = await update(job, { status: "running" });

    const result = await worker.start(job, {
      worktreePath: job.worktreePath,
      contextPacket: briefOverride ?? buildContextPacket(job),
      emit: (type, message, metadata) => emit(job.id, type, message, metadata),
      signal: controller.signal,
      updateJob: async (patch) => {
        job = await update(job, patch);
        return job;
      },
    });

    // A text job's deliverable is checked here for every worker, not just the
    // local one: invalid JSON must never become a successful result, whoever
    // produced it.
    if (!job.worktreePath && job.expectedOutput) {
      const check = validateOutput(result.summary, job.expectedOutput);
      if (!check.ok) throw new OutputRejected(check.reason);
      result.summary = check.value;
    }

    // What actually changed on disk is read from git, not taken on trust —
    // and read before validation runs, so a build's own output cannot be
    // mistaken for something the worker wrote.
    const changed = job.worktreePath
      ? await changedFiles(job.worktreePath)
      : result.changedFiles;

    // The worker has had its say. Whether the work stands is decided here, by
    // running the commands rather than by reading what the worker claimed.
    const commands = (job.validationCommands ?? []).filter(
      (command) => command.trim().length > 0,
    );

    let validation: Awaited<ReturnType<typeof runValidation>> = {
      results: [],
      passed: false,
    };

    // Held before the record is rewritten: validation runs where the work
    // happened, whatever the job record says afterwards.
    const worktree = job.worktreePath;

    if (worktree && commands.length > 0) {
      job = await update(job, { status: "validating" });

      emit(job.id, "job.progress", "Validating the work", {
        commands: commands.length,
      });

      validation = await runValidation(
        commands,
        worktree,
        (type, message, metadata) => emit(job.id, type, message, metadata),
        controller.signal,
      );
    }

    if (controller.signal.aborted) throw new Error("Cancelled");

    // Only a validation that actually ran can fail one. A job that was never
    // checked is unverified, which is a different thing from broken.
    const validated = Boolean(worktree) && commands.length > 0;
    const failed = validated && !validation.passed;

    const blockers = [...(result.blockers ?? [])];

    // What the worker wrote down, kept. Declared documents and any Markdown it
    // left at the worktree root are copied into the vault under the task,
    // where a person will find them — not left in a worktree that gets
    // discarded on approval.
    const artifacts = worktree
      ? await collectArtifacts(job, worker, worktree, result.summary, changed ?? [])
      : [];

    if (!validated && !((job.routing?.policy || job.bridge) && !job.worktreePath)) {
      // Said out loud, because "no failures" and "nothing was checked" look
      // identical on a screen otherwise.
      blockers.push(
        commands.length === 0
          ? "No validation commands were given, so nothing was verified."
          : "The job had no worktree to validate in, so nothing was verified.",
      );
    }

    // Whether the screen looks right is a separate question from whether the
    // code works, asked separately and only when the job said looking matters.
    //
    // Skipped when validation failed, deliberately: a build that does not
    // compile has nothing to photograph, and "the margins are wrong" is not
    // the finding an operator needs at that moment.
    let visual: VisualVerificationResult | undefined;

    if (!failed && wantsVisualVerification(job)) {
      job = await update(job, { status: "visual_validating" });

      visual = await verifyJobVisually(job, (type, message, metadata) =>
        emit(job.id, type, message, metadata),
      );

      if (visual.verdict === "unverifiable") {
        // Same honesty as an unvalidated job: "it was checked and it is fine"
        // and "it could not be checked" must not look the same on a screen.
        blockers.push(
          `The implementation could not be verified visually. ${visual.unverifiableReason ?? visual.summary}`,
        );
      }
    }

    if (controller.signal.aborted) throw new Error("Cancelled");

    // A visual mismatch is not a broken build. The job goes back to the worker
    // rather than being recorded as a failure, because the code may be
    // perfectly correct and a margin being wrong is not a technical fault.
    const visualChanges = visual?.verdict === "changes_required";

    job = await update(job, {
      // A worker finishing is not a job completing. The work is verified and
      // then waits for a person; nothing here marks its own homework.
      status: failed
        ? "failed"
        : visualChanges
          ? "changes_required"
          : "awaiting_review",
      visualVerification: visual,
      // A file-bridge job (Grok Bot) is started by hand, not routed, so it has no attempt to
      // finish: it gets one now, so its review knows the imported result was validated.
      attempts: !job.attempts?.length && job.bridge
        ? [bridgeAttempt(job, failed ? "failed" : "succeeded", failed ? "AgentOS's own validation failed after the result was imported." : undefined)]
        : finishAttempt(job, {
        outcome: failed ? "failed" : "succeeded",
        modelDigest: result.providerMetrics?.modelDigest,
        inputTokens: result.providerMetrics?.inputTokens,
        outputTokens: result.providerMetrics?.outputTokens,
        queueMs: result.providerMetrics?.queueMs,
        loadMs: result.providerMetrics?.loadMs,
        totalMs: result.providerMetrics?.totalMs,
        validation: job.routing?.policy
          ? {
              passed: !failed,
              detail: job.expectedOutput
                ? "Output matched the expected format."
                : "Output was non-empty.",
            }
          : undefined,
      }).attempts,
      completedAt: new Date().toISOString(),
      error: failed
        ? `Validation failed: ${validation.results
            .filter((entry) => !entry.success)
            .map((entry) => entry.command)
            .join(", ")}`
        : undefined,
      result: {
        ...result,
        changedFiles: changed,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        // Only AgentOS's own runs are recorded as tests. A worker's claims
        // about its testing are not evidence and are not kept as if they were.
        tests: validation.results,
        blockers: blockers.length > 0 ? blockers : undefined,
        worktreePath: job.worktreePath,
      },
    });

    emit(
      job.id,
      failed ? "job.failed" : "job.completed",
      failed ? `Validation failed. ${result.summary}` : result.summary,
      { changed: changed?.length ?? 0, validated: validation.results.length },
    );

    // Recorded once per *run*, not once per job. A job sent back twice writes
    // three ledger entries, because each attempt cost real money — folding
    // them into one would make revisions look free, which is exactly the
    // comparison the usage screen exists to get right.
    //
    // The context figures come from the packet this run was actually handed,
    // so "94k input tokens" can be read beside "18 files, 240k characters"
    // rather than remaining a mystery about the model.
    try {
      collectWorkerUsage(job, {
        files: job.contextFiles?.length,
        characters: buildContextPacket(job).length,
      });
    } catch (error) {
      console.error("[agentos] could not record worker usage:", error);
    }

    await recordActivity({
      type: failed ? "worker.failed" : "worker.completed",
      description: `${worker.name}: ${result.summary}`,
      project: job.project,
      metadata: { jobId: job.id, worker: worker.id, status: job.status },
    });

    // Filed as its own happening, and attributed to Hermes rather than to the
    // worker. A timeline that folded the visual verdict into the worker's
    // completion would lose the fact that something else looked at it.
    if (visual) {
      await recordActivity({
        type:
          visual.verdict === "pass"
            ? "worker.visual.passed"
            : visual.verdict === "changes_required"
              ? "worker.visual.changes"
              : "worker.visual.unverifiable",
        description: visual.summary,
        project: job.project,
        metadata: {
          jobId: job.id,
          revision: visual.revision,
          verdict: visual.verdict,
          issues: visual.issues.length,
          screenshots: visual.screenshots.length,
        },
      });
    }
  } catch (error) {
    // Settled by someone else — the shutdown path marks a job interrupted and
    // drops its runner before aborting it. Writing `cancelled` over that would
    // turn "the process died" back into "the operator stopped it".
    // Also true when a resumed run has taken its place: this run is no longer
    // the job's, so it must not write over the one that is.
    if (running.get(initial.id)?.controller !== controller) return;

    const cancelled = controller.signal.aborted;
    const detail =
      error instanceof Error ? error.message : "The job failed for an unknown reason.";

    const failure = failureInfo(error);
    job = finishAttempt(job, {
      outcome: cancelled ? "cancelled" : "failed",
      failureKind: cancelled ? "cancelled" : failure.kind,
      failureReason: cancelled ? undefined : failure.message,
    });

    // At most one fallback, and never after a cancellation: a cancelled job
    // makes no further attempts anywhere. Everything that could cause a loop
    // or send a local-only task to the cloud is checked in `nextFallback`.
    const fallback = cancelled ? undefined : await nextFallback(job, failure, cancelled).catch(() => undefined);
    const fallbackWorker = fallback ? getWorker(fallback.workerId) : undefined;
    const fallbackHealth = fallbackWorker
      ? await fallbackWorker.healthCheck().catch(() => ({ available: false }))
      : undefined;

    if (fallback && fallbackWorker && fallbackHealth?.available && !controller.signal.aborted) {
      const message = `${failure.kind}: ${failure.message} Falling back to ${fallback.optionId}.`;
      job = await update(beginAttempt(job, fallback, "fallback"), {
        status: "queued",
        resolvedWorker: fallback.workerId,
        error: undefined,
      });
      emit(job.id, "job.progress", message, { fallbackTo: fallback.optionId, failureKind: failure.kind });
      await recordActivity({
        type: "worker.fallback",
        description: `${worker.name} failed (${failure.kind}); ${fallbackWorker.name} took over: ${job.objective}`,
        project: job.project,
        metadata: { jobId: job.id, from: worker.id, to: fallback.optionId, failureKind: failure.kind },
      });
      await run(job, fallbackWorker);
      return;
    }

    job = await update(job, {
      status: cancelled ? "cancelled" : "failed",
      completedAt: new Date().toISOString(),
      error: cancelled ? undefined : detail,
    });

    emit(
      job.id,
      cancelled ? "job.cancelled" : "job.failed",
      cancelled ? "Cancelled by the operator" : detail,
    );

    await recordActivity({
      type: cancelled ? "worker.cancelled" : "worker.failed",
      description: cancelled
        ? `${worker.name} job cancelled`
        : `${worker.name}: ${detail}`,
      project: job.project,
      metadata: { jobId: job.id, worker: worker.id },
    });
  } finally {
    // The stream is closed once listeners are dropped, so the log has to be
    // safely on disk before that happens.
    await flushEvents();
    if (running.get(initial.id)?.controller === controller) {
      running.delete(initial.id);
      liveness.delete(initial.id);
    }
  }
}

/**
 * Runs a job again, with new instructions, in the checkout it already has.
 *
 * Everything after the worker — reading the diff from git, running the
 * validation commands, parking for review — is the same code path as the first
 * attempt. A revision is not a lesser kind of run: it is verified exactly as
 * rigorously as the work it replaces.
 */
export async function rerunJob(
  job: WorkerJob,
  brief: string,
): Promise<{ ok: boolean; error?: string }> {
  if (running.has(job.id)) {
    return { ok: false, error: "That job is already running." };
  }

  const worker = getWorker(job.resolvedWorker ?? job.worker as WorkerId);

  if (!worker) {
    return { ok: false, error: "The worker that ran this job is not available." };
  }

  const health = await worker.healthCheck().catch(() => ({
    available: false,
    reason: "The worker could not report its health.",
  }));

  if (!health.available) {
    return { ok: false, error: health.reason ?? `${worker.name} is not available.` };
  }

  const next = await update(job, {
    revision: (job.revision ?? 1) + 1,
    status: "queued",
    // The previous attempt's verdicts and error do not describe this one. The
    // earlier visual verification is not deleted — it stays on disk with its
    // screenshots — it simply stops being the current one.
    error: undefined,
    review: undefined,
    visualVerification: undefined,
    completedAt: undefined,
  });

  void run(next, worker, brief);

  return { ok: true };
}

/** Asks a running job to stop. A job that already finished is left alone. */
export type CancelResult =
  | { ok: true; job: WorkerJob; stopped: boolean }
  | { ok: false; error: string };

/** Statuses a cancel can no longer change: the job is over, one way or another. */
const SETTLED: readonly WorkerJobStatus[] = ["completed", "rejected", "failed", "cancelled"];

/**
 * Cancels a job, wherever it is in its life.
 *
 * A live run is aborted, and its own failure path records the cancellation.
 * A job with nothing executing — finished and waiting on review, sent back
 * for changes, approved but not applied, or orphaned by a restart — is
 * settled here directly: otherwise the only way out of those states was to
 * reject work that might never have been looked at, and a job left stranded
 * by a restart could not be closed at all.
 *
 * The worktree is kept either way. Cancelling ends the job, not the evidence:
 * discarding the checkout is still its own decision, and Retry still works.
 *
 * The one refusal is `integrating`: the work is being written into the real
 * repository, and stopping halfway is worse than letting it land.
 */
export async function cancelJob(jobId: string): Promise<CancelResult> {
  const live = running.get(jobId);

  if (live) {
    live.controller.abort();
    await live.worker.cancel?.(jobId).catch(() => undefined);
    const job = await readJob(jobId);
    return job ? { ok: true, job, stopped: true } : { ok: false, error: "There is no such job." };
  }

  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (SETTLED.includes(job.status)) {
    return { ok: false, error: `That job is already ${job.status}.` };
  }

  if (job.status === "integrating") {
    return {
      ok: false,
      error: "That job is being applied to the repository right now. Let it finish, then revert if needed.",
    };
  }

  const previous = job.status;
  const next = await update(job, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
    error: undefined,
  });

  emit(jobId, "job.cancelled", `Cancelled by the operator (was ${previous.replace(/_/g, " ")}). The worktree is kept.`);
  await flushEvents();

  await recordActivity({
    type: "worker.cancelled",
    description: `${job.objective}: cancelled`,
    project: job.project,
    metadata: { jobId, worker: job.resolvedWorker ?? job.worker, previous },
  });

  return { ok: true, job: next, stopped: false };
}

export interface SteerResult {
  ok: boolean;
  error?: string;
}

/** Passes guidance to a running job, when its worker accepts any. */
export async function steerJob(
  jobId: string,
  instruction: string,
): Promise<SteerResult> {
  const live = running.get(jobId);
  if (!live) return { ok: false, error: "That job is not running." };

  if (!live.worker.steer) {
    return { ok: false, error: `${live.worker.name} cannot be steered.` };
  }

  try {
    await live.worker.steer(jobId, instruction);
    emit(jobId, "job.progress", `Steering: ${instruction}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The worker refused the guidance.",
    };
  }
}

export { readEvents, readJob };
