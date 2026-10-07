import type {
  VisualAcceptanceContext,
  VisualVerificationVerdict,
} from "@shared/visual-verification-types";
import type { WorkerJobStatus, WorkerReviewVerdict } from "@shared/worker-types";
import type { AgentStatus } from "@/components/os";

/**
 * The workers screen's view model.
 *
 * Delegated work is the part of the system furthest from the operator's hands,
 * so how it reads matters: a job that is still going must never look finished,
 * and a job that was cancelled is a decision, not a failure.
 */

const STATUS_DISPLAY: Record<
  WorkerJobStatus,
  { label: string; status: AgentStatus }
> = {
  queued: { label: "Queued", status: "paused" },
  preparing: { label: "Preparing", status: "running" },
  running: { label: "Running", status: "running" },
  waiting: { label: "Waiting", status: "attention" },
  validating: { label: "Validating", status: "running" },
  // Named for what it is doing rather than for the check it belongs to:
  // "validating" twice in a row would read as the same step stalling.
  visual_validating: { label: "Photographing", status: "running" },
  // Reads as something asking for the operator rather than as a success: the
  // work is done and checked, and it is now waiting on a person.
  awaiting_review: { label: "Ready for review", status: "attention" },
  reviewing: { label: "In review", status: "running" },
  changes_required: { label: "Changes required", status: "attention" },
  approved: { label: "Approved", status: "running" },
  integrating: { label: "Integrating", status: "running" },
  completed: { label: "Completed", status: "completed" },
  // A decision, not a failure — the same reading cancellation gets.
  rejected: { label: "Rejected", status: "paused" },
  failed: { label: "Failed", status: "blocked" },
  cancelled: { label: "Cancelled", status: "paused" },
};

export function statusLabel(status: WorkerJobStatus): string {
  return STATUS_DISPLAY[status].label;
}

export function statusPill(status: WorkerJobStatus): AgentStatus {
  return STATUS_DISPLAY[status].status;
}

/**
 * Statuses where nothing is running any more.
 *
 * `awaiting_review` belongs here even though the job is not over: the run has
 * stopped, and a screen that still offered to cancel it would be offering to
 * stop something that already ended.
 */
const TERMINAL: readonly WorkerJobStatus[] = [
  "awaiting_review",
  "changes_required",
  "completed",
  "rejected",
  "failed",
  "cancelled",
];

export function isFinished(status: WorkerJobStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * Whether a job can still be cancelled.
 *
 * Anything that has not ended for good — running, queued, finished and
 * waiting on review, sent back for changes, approved but not applied, or
 * orphaned by a restart. Not `integrating`: the work is being written into
 * the repository, and stopping halfway is worse than letting it land.
 */
export function isCancellable(status: WorkerJobStatus): boolean {
  return !["completed", "rejected", "failed", "cancelled", "integrating"].includes(status);
}

/** Whether the job is waiting on a person rather than on a machine. */
export function isAwaitingReview(status: WorkerJobStatus): boolean {
  return status === "awaiting_review";
}

/**
 * Whether this job's work still exists to be looked at.
 *
 * A rejected job keeps everything until someone discards it, so the review, the
 * diff and the worktree are all still worth showing.
 */
export function hasReviewableWork(status: WorkerJobStatus): boolean {
  return [
    "awaiting_review",
    "changes_required",
    "reviewing",
    "rejected",
  ].includes(status);
}

/** Findings read worst-first: a critical issue should not sit below a nit. */
const SEVERITY_ORDER = { critical: 0, major: 1, minor: 2 } as const;

export function bySeverity(
  a: { severity: keyof typeof SEVERITY_ORDER },
  b: { severity: keyof typeof SEVERITY_ORDER },
): number {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
}

/** The verdict, said the way a person would say it. */
export function verdictLabel(verdict: WorkerReviewVerdict): string {
  if (verdict === "pass") return "Pass";
  if (verdict === "changes_required") return "Changes required";
  return "No verdict";
}

/**
 * How a verdict reads as a signal.
 *
 * `blocked` is a failure of the review, not of the work — it means nothing
 * could be concluded — so it reads as something wrong rather than as a
 * rejection of the implementation.
 */
export function verdictPill(verdict: WorkerReviewVerdict): AgentStatus {
  if (verdict === "pass") return "completed";
  if (verdict === "changes_required") return "attention";
  return "blocked";
}

/** How long the job took, or has been going. */
export function formatDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
  now: Date = new Date(),
): string | undefined {
  if (!startedAt) return undefined;

  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : now.getTime();

  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;

  const seconds = Math.max(0, Math.round((end - start) / 1000));

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * How an event reads in the activity list.
 *
 * A step is `done` only once something said it finished. Anything still open
 * when the job is over reads as unfinished rather than being quietly ticked.
 */
export type StepState = "running" | "done" | "failed";

export interface ActivityStep {
  id: string;
  label: string;
  state: StepState;
}

interface EventLike {
  id: string;
  type: string;
  message?: string;
}

/**
 * Folds a job's events into the steps a person reads.
 *
 * Started/completed pairs collapse into one line, so the list says what
 * happened rather than replaying a protocol. Pairing is by *family* — a
 * `tool.completed` closes the tool step that opened most recently — because a
 * worker rarely words a completion the same way it worded the start
 * ("Planning the change" closes as "Plan ready").
 */
export function toSteps(
  events: EventLike[],
  jobFinished: boolean,
): ActivityStep[] {
  const steps: ActivityStep[] = [];
  /** Open steps per family, most recent last. */
  const open = new Map<string, ActivityStep[]>();

  for (const event of events) {
    const label = event.message ?? event.type;
    const [family, phase] = splitEventType(event.type);

    // Three ways a run ends badly, all drawn as failures: the worker failed,
    // the process died under it, or — not an end, but the same colour — it
    // went silent past the stall threshold.
    if (event.type === "job.failed" || event.type === "job.interrupted" || event.type === "job.stalled") {
      steps.push({ id: event.id, label, state: "failed" });
      continue;
    }

    // `job.started` is a lifecycle marker, not work in progress: nothing will
    // ever "complete" it, so leaving it spinning would be a lie.
    if (phase === "started" && family !== "job") {
      const step: ActivityStep = { id: event.id, label, state: "running" };
      steps.push(step);
      open.set(family, [...(open.get(family) ?? []), step]);
      continue;
    }

    if (phase === "completed" && family !== "job") {
      const pending = open.get(family) ?? [];
      const step = pending.pop();

      if (step) {
        step.state = "done";
        // The completion is the more informative wording of the two.
        step.label = label;
        open.set(family, pending);
        continue;
      }
    }

    steps.push({ id: event.id, label, state: "done" });
  }

  // A job that is over cannot still have work in flight; whatever never
  // reported completion is shown as unfinished, not as done.
  if (jobFinished) {
    for (const pending of open.values()) {
      for (const step of pending) step.state = "failed";
    }
  }

  return steps;
}

/** `validation.started` → `["validation", "started"]`. */
function splitEventType(type: string): [string, string] {
  const separator = type.lastIndexOf(".");

  return separator === -1
    ? [type, ""]
    : [type.slice(0, separator), type.slice(separator + 1)];
}

/** The visual verdict, said the way a person would say it. */
export function visualVerdictLabel(verdict: VisualVerificationVerdict): string {
  if (verdict === "pass") return "Pass";
  if (verdict === "changes_required") return "Changes required";
  return "Not verified";
}

/**
 * How a visual verdict reads as a signal.
 *
 * `unverifiable` reads as something wrong rather than as a rejection: the
 * implementation was not judged and found wanting, it was not judged at all —
 * and the one reading it must never be allowed to pass for a pass.
 */
export function visualVerdictPill(
  verdict: VisualVerificationVerdict,
): AgentStatus {
  if (verdict === "pass") return "completed";
  if (verdict === "changes_required") return "attention";
  return "blocked";
}

/**
 * Why this contract is not ready to be sent, when it is not.
 *
 * Exported because the screens that submit it have to refuse rather than send
 * it: the adapter parses this strictly and drops a context it cannot read, so
 * a half-filled route would not fail loudly — it would quietly turn visual
 * verification off on a job that asked for it.
 */
export function visualAcceptanceProblem(
  context: VisualAcceptanceContext | undefined,
): string | undefined {
  if (!context?.enabled) return undefined;

  if (context.routes.length === 0) {
    return "Visual verification is on, but no routes were listed. Add a route, or turn it off.";
  }

  const incomplete = context.routes.filter(
    (route) => !route.path.trim() || !route.expectedPageId.trim(),
  );

  if (incomplete.length > 0) {
    return incomplete.length === 1
      ? "One route is missing its path or its expected page id."
      : `${incomplete.length} routes are missing a path or an expected page id.`;
  }

  return undefined;
}

/**
 * A job's headline: the objective's first line, cut to a readable length. A
 * generated brief (a website rebuild's research, say) runs to pages; the
 * page shows the whole thing under "Full brief" instead of as the title.
 */
export function jobTitle(objective: string, max = 140): string {
  const first = objective.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? objective.trim();
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}
