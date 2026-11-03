import { STAGE_ORDER, currentStage, type RebuildRun, type RebuildRunSummary } from "../../shared/website-rebuild-types";
import type { DeliveryDecision, DeliveryOverview, DeliveryState, DeliveryWorkspace } from "../../shared/delivery-types";
import type { ProjectSummary } from "../../shared/agentos-types";

/**
 * Every workspace beside the rebuild it already has, and everything waiting on
 * the person across all of them. Pure: the routes pass in what they read.
 */

function stateOf(run: RebuildRunSummary | undefined): DeliveryState {
  if (!run) return "not_started";
  const next = currentStage(run.stages);
  if (!next) return "done";
  if (next.status === "awaiting_approval") return "needs_you";
  if (next.status === "blocked") return "blocked";
  return "running";
}

export function deliveryWorkspaces(projects: readonly ProjectSummary[], runs: readonly RebuildRunSummary[]): DeliveryWorkspace[] {
  // listRuns is newest first, so the first run per workspace is the one that counts.
  const byWorkspace = new Map<string, RebuildRunSummary>();
  for (const run of runs) if (run.workspaceSlug && !byWorkspace.has(run.workspaceSlug)) byWorkspace.set(run.workspaceSlug, run);
  const rows = projects.map((project): DeliveryWorkspace => {
    const run = byWorkspace.get(project.slug);
    const next = run ? currentStage(run.stages) : undefined;
    return {
      slug: project.slug,
      name: project.name,
      workspaceType: project.workspaceType,
      state: stateOf(run),
      runId: run?.id,
      stage: next?.id,
      stageStatus: next?.status,
      done: run ? run.stages.filter((stage) => stage.status === "complete").length : 0,
      total: STAGE_ORDER.length,
      previewUrl: run?.previewUrl,
      updatedAt: run?.updatedAt,
    };
  });
  // Work in flight first, then by most recent change, then the rest by name.
  const rank: Record<DeliveryState, number> = { needs_you: 0, blocked: 1, running: 2, done: 3, not_started: 4 };
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.name.localeCompare(b.name));
}

/** Revisions waiting for review and stages that stopped, oldest first: the longest wait is the first to clear. */
export function deliveryDecisions(runs: readonly RebuildRun[]): DeliveryDecision[] {
  const decisions: DeliveryDecision[] = [];
  for (const run of runs) {
    for (const stage of run.stages) {
      if (stage.status === "awaiting_approval") {
        const revision = run.revisions.find((entry) => entry.stage === stage.id && entry.revision === stage.revision);
        decisions.push({ runId: run.id, workspaceSlug: run.workspaceSlug, company: run.company, stage: stage.id, kind: "review", revision: stage.revision, detail: revision?.summary ?? "", review: revision?.review, since: revision?.createdAt ?? stage.finishedAt ?? run.updatedAt });
      } else if (stage.status === "blocked") {
        decisions.push({ runId: run.id, workspaceSlug: run.workspaceSlug, company: run.company, stage: stage.id, kind: "blocked", revision: stage.revision, detail: stage.blocker ?? "This stage stopped.", since: stage.finishedAt ?? stage.startedAt ?? run.updatedAt });
      }
    }
  }
  return decisions.sort((a, b) => a.since.localeCompare(b.since));
}

export function deliveryOverview(projects: readonly ProjectSummary[], summaries: readonly RebuildRunSummary[], readRun: (id: string) => RebuildRun): DeliveryOverview {
  const waiting = summaries.filter((run) => run.stages.some((stage) => stage.status === "awaiting_approval" || stage.status === "blocked"));
  return { workspaces: deliveryWorkspaces(projects, summaries), decisions: deliveryDecisions(waiting.map((run) => readRun(run.id))) };
}
