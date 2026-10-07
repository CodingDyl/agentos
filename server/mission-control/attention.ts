import type { Automation, ProjectSummary } from "../../shared/agentos-types";
import type { AttentionItem } from "../../shared/mission-control-types";
import type { WorkerJob } from "../../shared/worker-types";

/**
 * What is waiting on the operator, worked out rather than asked about.
 *
 * Every item here is derived from a status that already exists — a job's
 * `status`, a review's `verdict`, an automation's last run, a project's state.
 * No model is consulted. That is not a performance decision: "what needs me?"
 * has a correct answer, and a screen that asked a model for it would give a
 * slightly different answer every time it was opened, which is precisely the
 * property an operations screen must not have.
 *
 * The order is fixed and severity-first, because the order *is* the advice:
 *
 *     1. failed / blocked          something is broken
 *     2. approval required          a decision only a person can make
 *     3. changes required           work that needs sending back
 *     4. review required            work nobody has looked at yet
 *     5. automation attention       a schedule that is not running
 *     6. system warnings            everything else
 *
 * Nothing invents work. An empty list is a real and good answer, and this
 * module will happily return one.
 */

/** Rank within the list. Lower sorts first. */
const TYPE_ORDER: Record<AttentionItem["type"], number> = {
  failed: 0,
  blocked: 1,
  approval: 2,
  changes_required: 3,
  review: 4,
  automation: 5,
  system: 6,
};

function jobHref(job: WorkerJob): string {
  return `/workers/jobs/${job.id}`;
}

/** The one-line name for a job, short enough to read in a card. */
function jobTitle(job: WorkerJob): string {
  const line = job.objective.split("\n")[0].trim();
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

/** A usage or rate limit, not a broken task: the fix is another worker, not a rerun. */
const LIMIT_HIT = /usage limit|rate.?limit|quota|out of credits|insufficient (?:credits|balance|quota)|too many requests|\b429\b/i;

function retryFor(job: WorkerJob): NonNullable<AttentionItem["retry"]> {
  return {
    jobId: job.id,
    worker: job.resolvedWorker ?? job.worker,
    limitHit: LIMIT_HIT.test(job.error ?? ""),
  };
}

/**
 * The piece of work a job is an attempt at: its workspace and the first line
 * of its objective. Retries and re-delegations of the same work share it.
 */
export function workKey(job: Pick<WorkerJob, "project" | "objective">): string {
  const line = job.objective.split("\n")[0].trim().toLowerCase().replace(/\s+/g, " ");
  return `${job.project ?? ""}|${line}`;
}

/** When this became the operator's problem, which is not when the job began. */
function settledAt(job: WorkerJob): string {
  return job.completedAt ?? job.startedAt ?? job.createdAt;
}

/**
 * What one worker job is asking for, if anything.
 *
 * A job produces at most one attention item. It can be simultaneously
 * unreviewed, visually unverified and waiting for approval, but the operator
 * has exactly one next move on it, and three cards for one job would be three
 * times the noise for none of the information.
 */
export function jobAttention(job: WorkerJob): AttentionItem | undefined {
  const base = {
    id: `job-${job.id}`,
    project: job.project,
    createdAt: settledAt(job),
  };

  if (job.status === "failed") {
    // An interruption is a different fact from a failure: the worker did not
    // break, the process under it went away. Said so, with the retry as the
    // action, because that is the answer to it.
    if (job.interruptedAt) {
      return {
        ...base,
        type: "failed",
        severity: "warning",
        title: jobTitle(job),
        description: job.error ?? "The run was interrupted. Retry to start a fresh run.",
        action: { label: "Open job", href: jobHref(job) },
        retry: retryFor(job),
      };
    }

    return {
      ...base,
      type: "failed",
      severity: "critical",
      title: jobTitle(job),
      description:
        job.error ?? "The job failed. Nothing has been integrated.",
      action: { label: "Open job", href: jobHref(job) },
      retry: retryFor(job),
    };
  }

  // Still running, but silent past the threshold. The operator should look:
  // a worker that has hung will otherwise sit until its own timeout.
  if (job.stalledSince) {
    const minutes = Math.max(1, Math.round((Date.now() - new Date(job.stalledSince).getTime()) / 60_000));
    return {
      ...base,
      type: "blocked",
      severity: "warning",
      title: jobTitle(job),
      description: `No activity from ${job.resolvedWorker ?? job.worker} for ${minutes}+ min. Still running; cancel if it is not coming back.`,
      action: { label: "Open job", href: jobHref(job) },
    };
  }

  if (job.status === "changes_required") {
    // Visual and code findings are counted together, but named apart: "2
    // visual issues" and "2 review findings" send the worker somewhere very
    // different, and the operator is the one choosing which.
    const visual = job.visualVerification?.issues.length ?? 0;
    const code = job.review?.issues.length ?? 0;

    const description =
      visual > 0 && code > 0
        ? `${code} review finding${code === 1 ? "" : "s"} and ${visual} visual issue${visual === 1 ? "" : "s"}.`
        : visual > 0
          ? `Visual verification found ${visual} issue${visual === 1 ? "" : "s"}.`
          : code > 0
            ? `Review found ${code} finding${code === 1 ? "" : "s"}.`
            : "The review asked for changes.";

    return {
      ...base,
      type: "changes_required",
      severity: "warning",
      title: jobTitle(job),
      description,
      // Straight to the evidence when the finding is something you look at.
      action: {
        label: visual > 0 && code === 0 ? "View visual review" : "View review",
        href: visual > 0 && code === 0 ? `${jobHref(job)}#visual` : jobHref(job),
      },
      workerJob: {
        jobId: job.id,
        canApprove: false,
        canRevise: code > 0,
      },
    };
  }

  if (job.status !== "awaiting_review") return undefined;

  // Reviewed and passed, so the only thing left is a person. This is the item
  // the whole pipeline exists to produce.
  if (job.review?.verdict === "pass") {
    const verified = job.visualAcceptance?.enabled
      ? job.visualVerification?.verdict === "pass"
      : true;

    if (verified) {
      return {
        ...base,
        type: "approval",
        severity: "warning",
        title: jobTitle(job),
        description: job.visualAcceptance?.enabled
          ? "Review passed and the implementation matches the approved design."
          : "Review passed. Nothing has been integrated yet.",
        action: { label: "Review & approve", href: jobHref(job) },
        workerJob: {
          jobId: job.id,
          canApprove: true,
          canRevise: false,
        },
      };
    }

    // Passed its code review but was never actually looked at. Said plainly:
    // "not checked" must never be able to pass for "checked and fine".
    return {
      ...base,
      type: "review",
      severity: "warning",
      title: jobTitle(job),
      description:
        job.visualVerification?.verdict === "unverifiable"
          ? "Review passed, but the implementation could not be verified visually."
          : "Review passed, but it has not been verified visually yet.",
      action: { label: "Open job", href: `${jobHref(job)}#visual` },
      workerJob: {
        jobId: job.id,
        canApprove: false,
        canRevise: false,
      },
    };
  }

  return {
    ...base,
    type: "review",
    severity: job.review?.verdict === "blocked" ? "warning" : "info",
    title: jobTitle(job),
    description: job.review
      ? "The review could not reach a verdict."
      : "Finished and validated. Nobody has reviewed it yet.",
    action: { label: "Open job", href: jobHref(job) },
    workerJob: {
      jobId: job.id,
      canApprove: false,
      canRevise: false,
    },
  };
}

/**
 * An automation that is meant to be running and is not.
 *
 * A schedule you turned off is a decision, not a fault, so a disabled or
 * finished job never appears here however long it has been quiet.
 */
export function automationAttention(
  automation: Automation,
): AttentionItem | undefined {
  if (automation.state === "disabled" || automation.state === "completed") {
    return undefined;
  }

  const failed = automation.lastRun?.status === "failed";
  const warnings = automation.warnings ?? [];

  if (!failed && warnings.length === 0) return undefined;

  return {
    id: `automation-${automation.id}`,
    type: "automation",
    severity: failed ? "critical" : "warning",
    title: automation.name,
    description: failed
      ? (automation.lastRun?.detail ?? "The last scheduled run failed.")
      : warnings.join(" "),
    action: { label: "View automations", href: "/automations" },
    createdAt: automation.lastRun?.timestamp ?? new Date().toISOString(),
  };
}

/**
 * A project the vault itself says is blocked.
 *
 * Taken from the project's own state rather than guessed at from its task
 * list: `STATUS.md` saying "blocked" is a person's statement, and it outranks
 * anything this screen could infer.
 */
export function projectAttention(
  project: ProjectSummary,
): AttentionItem | undefined {
  if (project.state !== "blocked") return undefined;

  return {
    id: `project-${project.slug}`,
    type: "blocked",
    severity: "critical",
    title: project.name,
    description: project.status ?? "This project is blocked.",
    project: project.name,
    action: { label: "Open workspace", href: `/workspaces/${project.slug}` },
    createdAt: project.lastActivity ?? new Date().toISOString(),
  };
}

export interface AttentionInput {
  jobs: readonly WorkerJob[];
  /**
   * Every recent job, finished ones included, so a failure that a later
   * attempt has already taken over can be recognised and left out.
   */
  history?: readonly WorkerJob[];
  automations: readonly Automation[];
  projects: readonly ProjectSummary[];
  /** Subsystems that could not be read, each becoming one `system` item. */
  degraded: readonly { label: string; detail: string }[];
}

/**
 * Everything waiting on the operator, worst first.
 *
 * Ties break on age, oldest first: between two decisions of equal weight, the
 * one that has been waiting longer is the one that has been waiting longer.
 */
/**
 * Failed jobs, one card per piece of work.
 *
 * Two failed attempts at the same thing are one problem, so they are one card
 * ("failed 2×") showing the latest attempt. And a failure that a newer attempt
 * has already superseded (running now, or finished) is not a problem at all
 * any more, so it is left out.
 */
export function failedJobAttention(
  jobs: readonly WorkerJob[],
  history: readonly WorkerJob[] = jobs,
): AttentionItem[] {
  const created = (job: WorkerJob) => Date.parse(job.createdAt);

  const failedByWork = new Map<string, WorkerJob[]>();
  for (const job of jobs) {
    if (job.status !== "failed") continue;
    const key = workKey(job);
    failedByWork.set(key, [...(failedByWork.get(key) ?? []), job]);
  }

  const items: AttentionItem[] = [];
  const everything = [...history, ...jobs];
  for (const [key, failed] of failedByWork) {
    const latest = failed.reduce((a, b) => (created(b) > created(a) ? b : a));

    // Superseded: a later attempt at the same work that didn't fail.
    const supersededBy = everything.find(
      (job) => job.status !== "failed" && workKey(job) === key && created(job) > created(latest),
    );
    if (supersededBy) continue;

    const item = jobAttention(latest);
    if (item) items.push(failed.length > 1 ? { ...item, occurrences: failed.length } : item);
  }
  return items;
}

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [
    ...failedJobAttention(input.jobs, input.history),
    ...input.jobs.filter((job) => job.status !== "failed").flatMap((job) => jobAttention(job) ?? []),
    ...input.automations.flatMap((entry) => automationAttention(entry) ?? []),
    ...input.projects.flatMap((project) => projectAttention(project) ?? []),
    ...input.degraded.map((source) => ({
      id: `system-${source.label.toLowerCase().replace(/\s+/g, "-")}`,
      type: "system" as const,
      severity: "info" as const,
      title: `${source.label} could not be read`,
      description: source.detail,
      action: { label: "Open activity", href: "/activity" },
      createdAt: new Date().toISOString(),
    })),
  ];

  return items.sort((a, b) => {
    const byType = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
    if (byType !== 0) return byType;

    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}
