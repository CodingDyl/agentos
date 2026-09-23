import type {
  MilestoneDetail,
  MilestoneProgress,
  MilestoneSummary,
  ProjectHealth,
  ProjectMilestone,
  ProjectRoadmap,
  RoadmapMilestone,
  RoadmapTask,
  TaskExecutionStatus,
} from "../../shared/agentos-types";
import type { TaskDelegationState } from "../../shared/delegation-types";
import type { WorkerJob } from "../../shared/worker-types";
import { readUsage } from "../usage/ledger";
import { total } from "../usage/metrics";
import { readJob } from "../workers/job-store";
import { readMilestones } from "./mutations/milestones";
import { readTasks } from "./mutations/tasks";
import { taskDelegations } from "./task-delegation";

/**
 * The roadmap, computed.
 *
 * Nothing here is stored. Progress, execution status, blockers and health are
 * all derived from three files and the worker-job links every time they are
 * asked for, so they can never disagree with the tasks they describe. And
 * none of it involves a model: whether a project is at risk is a matter of
 * dates and counts, and an LLM's opinion of it would be a number nobody could
 * audit. Hermes is welcome to *explain* a verdict; it does not get to make one.
 */

/** A task line as the mutation layer reads it. */
export interface TaskLine {
  id?: string;
  title: string;
  completed: boolean;
  section?: string;
  ready?: boolean;
  after?: string[];
}

const OPEN_SECTIONS = new Set(["now", "next", "later"]);

/** Job statuses that mean a worker is on it / a review is waiting. */
const IN_PROGRESS = new Set([
  "queued",
  "preparing",
  "running",
  "waiting",
  "validating",
  "visual_validating",
  "reviewing",
  "approved",
  "integrating",
]);
const IN_REVIEW = new Set(["awaiting_review", "changes_required"]);

/**
 * Where a task stands, from the facts about it.
 *
 * Precedence, most decisive first: done, blocked, review, in progress, ready,
 * backlog. Blocked outranks in-progress deliberately — a worker running on a
 * task whose dependency reopened is exactly the situation the board should
 * make loud.
 */
export function executionStatus(
  task: TaskLine,
  openIds: ReadonlySet<string>,
  delegation: TaskDelegationState | undefined,
): { status: TaskExecutionStatus; blockedBy: string[] } {
  if (task.completed || task.section === "done") return { status: "done", blockedBy: [] };

  const blockedBy = (task.after ?? []).filter((id) => openIds.has(id));
  if (blockedBy.length > 0) return { status: "blocked", blockedBy };

  if (delegation?.status && IN_REVIEW.has(delegation.status)) return { status: "review", blockedBy: [] };
  if (delegation?.active && delegation.status && IN_PROGRESS.has(delegation.status)) {
    return { status: "in_progress", blockedBy: [] };
  }

  return { status: task.ready ? "ready" : "backlog", blockedBy: [] };
}

export function daysUntil(targetDate: string | undefined, now: Date): number | undefined {
  if (!targetDate) return undefined;
  const target = new Date(`${targetDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return undefined;

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function progressOf(
  milestone: ProjectMilestone,
  tasks: readonly RoadmapTask[],
  now: Date,
): MilestoneProgress {
  const completed = tasks.filter((task) => task.status === "done").length;

  return {
    total: tasks.length,
    completed,
    percent: tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100),
    criteriaTotal: milestone.criteria.length,
    criteriaDone: milestone.criteria.filter((criterion) => criterion.done).length,
    daysToTarget: daysUntil(milestone.targetDate, now),
  };
}

/** Health thresholds. Named so the reason string and the rule cannot drift. */
const AT_RISK_WINDOW_DAYS = 14;
const AT_RISK_BELOW_PERCENT = 60;

export function healthOf(
  milestones: readonly RoadmapMilestone[],
  unplanned: readonly RoadmapTask[],
): { health: ProjectHealth; reason: string } {
  const active = milestones.find((milestone) => milestone.status === "active");

  // A blocked task the operator meant to do now is the loudest signal there is.
  const blockedNow = [
    ...(active?.tasks ?? []),
    ...unplanned,
  ].filter((task) => task.status === "blocked" && (task.section === "now" || task.ready));

  if (blockedNow.length > 0) {
    return {
      health: "blocked",
      reason: `${blockedNow.length} ${blockedNow.length === 1 ? "task" : "tasks"} meant for now ${blockedNow.length === 1 ? "is" : "are"} blocked (${blockedNow.map((task) => task.id).join(", ")}).`,
    };
  }

  if (!active) {
    return { health: "no_target", reason: "No active milestone." };
  }

  const days = active.progress.daysToTarget;

  if (days === undefined) {
    return { health: "no_target", reason: `${active.title} has no target date.` };
  }

  if (days < 0) {
    return {
      health: "at_risk",
      reason: `${active.title} was due ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago at ${active.progress.percent}%.`,
    };
  }

  if (days <= AT_RISK_WINDOW_DAYS && active.progress.percent < AT_RISK_BELOW_PERCENT) {
    return {
      health: "at_risk",
      reason: `${active.title} is ${active.progress.percent}% done with ${days} ${days === 1 ? "day" : "days"} to go.`,
    };
  }

  return {
    health: "on_track",
    reason: `${active.title} is ${active.progress.percent}% done with ${days} ${days === 1 ? "day" : "days"} to go.`,
  };
}

/** Pure assembly, exported for tests. */
export function assembleRoadmap(input: {
  project: string;
  revision: string;
  tasksRevision: string;
  tasks: readonly TaskLine[];
  milestones: readonly ProjectMilestone[];
  delegations: readonly TaskDelegationState[];
  now?: Date;
}): ProjectRoadmap {
  const now = input.now ?? new Date();

  const byId = new Map<string, TaskLine>();
  for (const task of input.tasks) if (task.id) byId.set(task.id, task);

  const openIds = new Set(
    input.tasks
      .filter((task) => task.id && !task.completed && task.section !== "done" && task.section !== "archived")
      .map((task) => task.id as string),
  );

  const delegationById = new Map(
    input.delegations.map((delegation) => [delegation.taskId.toUpperCase(), delegation]),
  );

  const membership = new Map<string, string>();
  for (const milestone of input.milestones) {
    for (const id of milestone.taskIds) {
      if (!membership.has(id)) membership.set(id, milestone.id);
    }
  }

  const toRoadmapTask = (task: TaskLine & { id: string }): RoadmapTask => {
    const { status, blockedBy } = executionStatus(task, openIds, delegationById.get(task.id));
    const section = OPEN_SECTIONS.has(task.section ?? "") ? task.section : "now";

    return {
      id: task.id,
      title: task.title,
      section: (task.section === "done" || task.section === "archived" ? "later" : section) as RoadmapTask["section"],
      completed: task.completed || task.section === "done",
      ready: task.ready,
      after: task.after,
      status,
      blockedBy,
      milestoneId: membership.get(task.id),
    };
  };

  const milestones: RoadmapMilestone[] = input.milestones.map((milestone) => {
    const tasks = milestone.taskIds
      .map((id) => byId.get(id))
      .filter((task): task is TaskLine & { id: string } => task !== undefined && task.id !== undefined)
      .filter((task) => task.section !== "archived")
      .map(toRoadmapTask);

    return { ...milestone, tasks, progress: progressOf(milestone, tasks, now) };
  });

  const unplanned = input.tasks
    .filter(
      (task): task is TaskLine & { id: string } =>
        task.id !== undefined &&
        !membership.has(task.id) &&
        !task.completed &&
        task.section !== "done" &&
        task.section !== "archived",
    )
    .map(toRoadmapTask);

  const { health, reason } = healthOf(milestones, unplanned);

  return {
    project: input.project,
    revision: input.revision,
    tasksRevision: input.tasksRevision,
    milestones,
    unplanned,
    health,
    healthReason: reason,
  };
}

export async function getRoadmap(slug: string): Promise<ProjectRoadmap> {
  const [tasks, milestones, delegations] = await Promise.all([
    readTasks(slug),
    readMilestones(slug),
    taskDelegations(slug).catch(() => [] as TaskDelegationState[]),
  ]);

  return assembleRoadmap({
    project: slug,
    revision: milestones.revision,
    tasksRevision: tasks.revision,
    tasks: tasks.tasks,
    milestones: milestones.milestones,
    delegations,
  });
}

/** The active milestone's headline, for portfolio rows and Mission Control. */
export async function getMilestoneSummary(
  slug: string,
): Promise<{ milestone?: MilestoneSummary; health: ProjectHealth; nextReady?: RoadmapTask } | undefined> {
  let roadmap: ProjectRoadmap;

  try {
    roadmap = await getRoadmap(slug);
  } catch {
    return undefined;
  }

  const active = roadmap.milestones.find((milestone) => milestone.status === "active");

  // The next thing to pick up: a ready task in the active milestone, Now first;
  // failing that, any ready unplanned task.
  const candidates = [...(active?.tasks ?? []), ...roadmap.unplanned]
    .filter((task) => task.status === "ready")
    .sort((a, b) => sectionRank(a.section) - sectionRank(b.section));

  return {
    milestone: active
      ? { id: active.id, title: active.title, progress: active.progress, targetDate: active.targetDate }
      : undefined,
    health: roadmap.health,
    nextReady: candidates[0],
  };
}

function sectionRank(section: string): number {
  return ["now", "next", "later"].indexOf(section);
}

export async function getMilestoneDetail(slug: string, id: string): Promise<MilestoneDetail | undefined> {
  const roadmap = await getRoadmap(slug);
  const milestone = roadmap.milestones.find((entry) => entry.id === id);
  if (!milestone) return undefined;

  const taskIds = new Set(milestone.taskIds);
  const delegations = await taskDelegations(slug).catch(() => [] as TaskDelegationState[]);
  const mine = delegations.filter((delegation) => taskIds.has(delegation.taskId.toUpperCase()));

  const jobs = (
    await Promise.all(mine.map((delegation) => readJob(delegation.jobId).catch(() => undefined)))
  ).filter((job): job is WorkerJob => job !== undefined);

  const byWorker = new Map<string, number>();
  for (const job of jobs) {
    const worker = job.resolvedWorker ?? job.worker;
    byWorker.set(worker, (byWorker.get(worker) ?? 0) + 1);
  }

  let usage = { jobs: jobs.length, tokens: undefined as number | undefined, costUsd: undefined as number | undefined };

  try {
    const records = [...taskIds].flatMap((taskId) => readUsage({ taskId }));
    const summed = total(records);
    usage = { jobs: jobs.length, tokens: summed.tokens, costUsd: summed.costUsd };
  } catch {
    // The ledger being unavailable is not a reason to hide the milestone.
  }

  return {
    ...milestone,
    agentWork: [...byWorker.entries()]
      .map(([worker, count]) => ({ worker, jobs: count }))
      .sort((a, b) => b.jobs - a.jobs),
    usage,
  };
}
