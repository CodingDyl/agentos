import type {
  MilestoneStatus,
  ProjectHealth,
  RoadmapMilestone,
  TaskExecutionStatus,
} from "@shared/agentos-types";
import type { AgentStatus } from "@/components/os";

/**
 * Vocabulary for the roadmap: how a derived status reads, and which pill it
 * is drawn with. One place, so the board, the roadmap and Mission Control
 * cannot drift in how they describe the same task.
 */

export const EXECUTION_LABELS: Record<TaskExecutionStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};

export function executionPill(status: TaskExecutionStatus): AgentStatus {
  switch (status) {
    case "ready":
      return "active";
    case "in_progress":
      return "running";
    case "review":
      return "attention";
    case "blocked":
      return "blocked";
    case "done":
      return "completed";
    default:
      return "incubating";
  }
}

export const MILESTONE_LABELS: Record<MilestoneStatus, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
  paused: "Paused",
  archived: "Archived",
};

export function milestonePill(status: MilestoneStatus): AgentStatus {
  switch (status) {
    case "active":
      return "active";
    case "completed":
      return "completed";
    case "paused":
      return "paused";
    default:
      return "incubating";
  }
}

export const HEALTH_LABELS: Record<ProjectHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
  no_target: "No target",
};

export function healthPill(health: ProjectHealth): AgentStatus {
  switch (health) {
    case "on_track":
      return "healthy";
    case "at_risk":
      return "attention";
    case "blocked":
      return "blocked";
    default:
      return "incubating";
  }
}

export function healthTone(health: ProjectHealth): "success" | "warning" | "danger" | "subtle" | "amber" {
  switch (health) {
    case "on_track":
      return "amber";
    case "at_risk":
      return "warning";
    case "blocked":
      return "danger";
    default:
      return "subtle";
  }
}

/** `2026-09-25` → `25 Sep`. */
export function shortDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** `13 days`, `due today`, `3 days over`. */
export function describeDays(days: number | undefined): string | undefined {
  if (days === undefined) return undefined;
  if (days === 0) return "due today";
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} over`;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export interface RoadmapGroups {
  now: RoadmapMilestone[];
  next: RoadmapMilestone[];
  done: RoadmapMilestone[];
  archived: RoadmapMilestone[];
}

/** Now = active or paused; Next = planned, in file order; the rest folded. */
export function groupMilestones(milestones: readonly RoadmapMilestone[]): RoadmapGroups {
  return {
    now: milestones.filter((milestone) => milestone.status === "active" || milestone.status === "paused"),
    next: milestones.filter((milestone) => milestone.status === "planned"),
    done: milestones.filter((milestone) => milestone.status === "completed"),
    archived: milestones.filter((milestone) => milestone.status === "archived"),
  };
}
