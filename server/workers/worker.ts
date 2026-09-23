import type {
  WorkerCapability,
  WorkerEvent,
  WorkerEventType,
  WorkerId,
  WorkerJob,
  WorkerJobResult,
} from "../../shared/worker-types";

/**
 * What every worker must be able to do.
 *
 * The contract is deliberately small. A worker takes one scoped job, reports
 * what it is doing as it goes, and returns what it did. It is not asked to
 * decide what to work on, whether the result is good, or what to do next —
 * those belong to Hermes and to the operator.
 *
 * Nothing in this file knows how any particular runner works. An adapter's
 * whole job is to make its runner look like this.
 */

/** How a worker reports progress. Adapters translate their own events into these. */
export type EmitWorkerEvent = (
  type: WorkerEventType,
  message?: string,
  metadata?: Record<string, unknown>,
) => void;

export interface WorkerRunContext {
  /** The isolated checkout to work in, when the job has one. */
  worktreePath?: string;
  /** The scoped handoff: objective, constraints, acceptance, validation. */
  contextPacket: string;
  emit: EmitWorkerEvent;
  /** Aborted when the operator cancels the job. */
  signal: AbortSignal;
}

export interface Worker {
  id: WorkerId;
  name: string;
  /** One line on what this worker is for, shown on the workers screen. */
  role: string;
  capabilities: WorkerCapability[];

  /**
   * True for a worker that rehearses the pipeline instead of doing the work.
   *
   * Routing skips these. A simulated worker accumulates a spotless record —
   * it never fails, never needs a revision, and costs nothing — so on the
   * evidence alone it is the strongest candidate there is, and would win every
   * automatic selection it was offered for. It stays selectable by hand, which
   * is what it is for.
   */
  simulated?: boolean;

  /**
   * Whether this worker can actually be used right now.
   *
   * Fails closed: a worker that cannot answer is unavailable, never assumed
   * ready. The reason is surfaced so an operator can fix it.
   */
  healthCheck(): Promise<{ available: boolean; reason?: string }>;

  start(job: WorkerJob, context: WorkerRunContext): Promise<WorkerJobResult>;

  /** Optional: a worker that cannot be steered simply does not offer it. */
  steer?(jobId: string, instruction: string): Promise<void>;

  /**
   * Optional: extra teardown beyond aborting the run signal, which the job
   * manager does for every worker.
   */
  cancel?(jobId: string): Promise<void>;
}

/** Builds one event. Ids and timestamps are the manager's business, not a worker's. */
export function createWorkerEvent(
  jobId: string,
  type: WorkerEventType,
  message?: string,
  metadata?: Record<string, unknown>,
): WorkerEvent {
  return {
    id: crypto.randomUUID(),
    jobId,
    timestamp: new Date().toISOString(),
    type,
    message,
    metadata,
  };
}
