import type { AttentionItem, AttentionSource } from "../../shared/mission-control-types";
import type { MotionRun } from "../../shared/motion-design-types";
import type { OperatorRun } from "../../shared/operator-types";
import { GATED_STAGES, type RebuildRunSummary, type RebuildStage } from "../../shared/website-rebuild-types";
import type { WorkerJob } from "../../shared/worker-types";
import { jobAttention, sortAttentionItems } from "./attention";

/**
 * Everything waiting on the operator, from every system that already knows.
 *
 * Mission Control's original attention list is jobs, automations, projects and
 * degraded sources. The Dashboard inbox adds website rebuilds, Motion Design
 * credit gates, Operator runs, uncertain/stale worker jobs, and recorded
 * apply blockers — still derived, still never inventing work.
 */

const RUNNING_STATUSES = new Set([
  "queued",
  "preparing",
  "running",
  "validating",
  "visual_validating",
  "reviewing",
  "integrating",
]);

const SOURCE_FROM_ID: Record<string, AttentionSource> = {
  job: "workers",
  automation: "automation",
  project: "workspace",
  system: "system",
};

function inferSource(item: AttentionItem): AttentionSource {
  if (item.source) return item.source;
  const prefix = item.id.split("-")[0] ?? "";
  return SOURCE_FROM_ID[prefix] ?? "system";
}

function withSource(item: AttentionItem, source: AttentionSource): AttentionItem {
  return { ...item, source: item.source ?? source };
}

export function rebuildInbox(run: RebuildRunSummary): AttentionItem[] {
  return run.stages.flatMap((stage) => rebuildStageItem(run, stage) ?? []);
}

function rebuildStageItem(run: RebuildRunSummary, stage: RebuildStage): AttentionItem | undefined {
  if (stage.status !== "awaiting_approval" && stage.status !== "blocked") return undefined;

  const previewBlocked = stage.id === "preview" && stage.status === "blocked";
  const conceptPick = stage.id === "hero" && stage.status === "awaiting_approval";
  const gatedApproval = stage.status === "awaiting_approval" && GATED_STAGES.has(stage.id) && !conceptPick;

  const type = stage.status === "blocked" ? "blocked" : "approval";
  const title =
    conceptPick
      ? `Pick a hero concept for ${run.company}`
      : stage.status === "blocked"
        ? `${run.company}: ${stage.id} is blocked`
        : `${run.company}: ${stage.id} needs approval`;

  const description = conceptPick
    ? "Three concepts are waiting. Open the rebuild to pick one; the build cannot start without it."
    : previewBlocked
      ? (stage.blocker ?? "Vercel has not produced a usable preview of this commit yet.")
      : (stage.blocker ?? (stage.status === "awaiting_approval" ? `Revision ${stage.revision} is waiting for review.` : undefined));

  return {
    id: `rebuild-${run.id}-${stage.id}`,
    type,
    severity: stage.status === "blocked" ? "critical" : "warning",
    source: "rebuild",
    title,
    description,
    project: run.company,
    action: { label: "Open", href: `/rebuilds/${run.id}` },
    createdAt: stage.finishedAt ?? stage.startedAt ?? run.updatedAt,
    rebuild: {
      runId: run.id,
      stage: stage.id,
      revision: stage.revision > 0 ? stage.revision : undefined,
      approve: gatedApproval,
      retry: stage.status === "blocked" && !previewBlocked,
      forceDeploy: previewBlocked,
      recheck: previewBlocked,
    },
  };
}

export function motionInbox(run: MotionRun): AttentionItem[] {
  if (run.status === "awaiting_approval") {
    const brand = run.brief.brandName.trim() || "this site";
    return [
      {
        id: `motion-${run.id}`,
        type: "approval",
        severity: "warning",
        source: "motion",
        title: `Pick a concept and credit ceiling for ${brand}`,
        description: run.concepts.length > 0
          ? `${run.concepts.length} concept${run.concepts.length === 1 ? "" : "s"} waiting. Higgsfield spend is blocked until you approve a ceiling.`
          : "Credit approval is waiting. Higgsfield spend is blocked until you pick a concept and a ceiling.",
        project: run.workspaceSlug,
        action: { label: "Open", href: `/workspaces/${run.workspaceSlug}` },
        createdAt: run.updatedAt,
        motion: { runId: run.id },
      },
    ];
  }

  if (run.status === "failed") {
    return [
      {
        id: `motion-${run.id}`,
        type: "failed",
        severity: "critical",
        source: "motion",
        title: `${run.brief.brandName.trim() || run.workspaceSlug}: Motion Design failed`,
        description: run.error ?? "The Claude Code job failed.",
        project: run.workspaceSlug,
        action: { label: "Open", href: `/workspaces/${run.workspaceSlug}` },
        createdAt: run.updatedAt,
        motion: { runId: run.id },
      },
    ];
  }

  return [];
}

export function operatorInbox(run: OperatorRun): AttentionItem[] {
  if (run.status === "awaiting_approval") {
    return [
      {
        id: `operator-${run.id}`,
        type: "approval",
        severity: "warning",
        source: "operator",
        title: run.objective ?? run.input,
        description: "The plan is ready. Nothing runs until you approve it.",
        action: { label: "Open", href: `/operator/runs/${run.id}` },
        createdAt: run.startedAt,
        operator: { runId: run.id, approve: true },
      },
    ];
  }

  if (run.status === "blocked") {
    return [
      {
        id: `operator-${run.id}`,
        type: "blocked",
        severity: "critical",
        source: "operator",
        title: run.objective ?? run.input,
        description: run.statusDetail ?? "This run is blocked.",
        action: { label: "Open", href: `/operator/runs/${run.id}` },
        createdAt: run.startedAt,
        operator: { runId: run.id, approve: false },
      },
    ];
  }

  return [];
}

/**
 * A job recorded as executing whose process is not actually running — usually
 * a restart, and for Claude the leftover of a stale run.
 */
export function uncertainJobInbox(job: WorkerJob, runningJobIds: ReadonlySet<string>): AttentionItem | undefined {
  if (jobAttention(job)) return undefined;
  if (!RUNNING_STATUSES.has(job.status)) return undefined;
  if (runningJobIds.has(job.id)) return undefined;

  const worker = job.resolvedWorker ?? job.worker;
  const staleClaude = worker === "claude-code" || worker === "claude";

  return {
    id: `job-${job.id}`,
    type: "blocked",
    severity: "warning",
    source: "workers",
    title: job.objective.split("\n")[0]?.trim() || job.id,
    description: staleClaude
      ? `Claude is recorded as running this, but nothing is executing it. The run looks stale; open the job to retry or cancel.`
      : `${worker} is recorded as ${job.status}, but nothing is executing it. Unconfirmed; open the job to retry or cancel.`,
    project: job.project,
    action: { label: "Open", href: `/workers/jobs/${job.id}` },
    createdAt: job.startedAt ?? job.createdAt,
  };
}

export function applyBlockersInbox(job: WorkerJob): AttentionItem[] {
  if (job.status !== "awaiting_review") return [];
  if (job.review?.verdict !== "pass") return [];
  const blockers = job.result?.blockers?.filter((entry) => entry.trim()) ?? [];
  if (blockers.length === 0) return [];

  return [
    {
      id: `job-${job.id}`,
      type: "blocked",
      severity: "warning",
      source: "apply",
      title: job.objective.split("\n")[0]?.trim() || job.id,
      description: blockers.join(" "),
      project: job.project,
      action: { label: "Open", href: `/workers/jobs/${job.id}` },
      createdAt: job.completedAt ?? job.createdAt,
      workerJob: { jobId: job.id, canApprove: false, canRevise: false },
    },
  ];
}

export interface InboxInput {
  attention: readonly AttentionItem[];
  rebuilds: readonly RebuildRunSummary[];
  motion: readonly MotionRun[];
  operator: readonly OperatorRun[];
  jobs: readonly WorkerJob[];
  runningJobIds: ReadonlySet<string>;
}

/**
 * One list. Apply blockers replace the approval card for the same job; an
 * uncertain job is not raised when attention already has that job.
 */
export function aggregateInbox(input: InboxInput): AttentionItem[] {
  const apply = input.jobs.flatMap(applyBlockersInbox);
  const claimed = new Set(apply.map((item) => item.id));

  const extras: AttentionItem[] = [
    ...apply,
    ...input.rebuilds.flatMap(rebuildInbox),
    ...input.motion.flatMap(motionInbox),
    ...input.operator.flatMap(operatorInbox),
  ];

  for (const item of extras) claimed.add(item.id);

  const fromAttention = input.attention
    .filter((item) => !claimed.has(item.id))
    .map((item) => withSource(item, inferSource(item)));

  for (const item of fromAttention) claimed.add(item.id);

  const uncertain = input.jobs
    .map((job) => uncertainJobInbox(job, input.runningJobIds))
    .filter((item): item is AttentionItem => item !== undefined && !claimed.has(item.id));

  return sortAttentionItems([...extras, ...fromAttention, ...uncertain]);
}

/** How many rebuild stages are waiting on a person. */
export function rebuildsWaitingCount(runs: readonly RebuildRunSummary[]): number {
  return runs.reduce((sum, run) => sum + rebuildInbox(run).length, 0);
}
