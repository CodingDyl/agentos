import type { ProjectPriority, ProjectState, ProjectSummary } from "@shared/agentos-types";
import type { AgentStatus } from "@/components/os";

/**
 * Ordering, grouping, and counting for the projects screen. Pure functions over
 * the wire model — presentation components stay free of ranking logic.
 */

/** Portfolio reading order: what is in play, then what is parked, then what is done. */
export const STATE_ORDER: readonly ProjectState[] = [
  "active",
  "blocked",
  "incubating",
  "paused",
  "completed",
  // Last, and only shown when asked for: archiving something is a request to
  // stop seeing it.
  "archived",
];

const STATE_LABELS: Record<ProjectState, string> = {
  active: "Active",
  blocked: "Blocked",
  incubating: "Incubating",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};

const PRIORITY_ORDER: readonly ProjectPriority[] = ["high", "medium", "low"];

export function stateLabel(state: ProjectState): string {
  return STATE_LABELS[state];
}

/**
 * The one place the portfolio's vocabulary meets the design system's.
 *
 * `ProjectState` is what the vault says; `AgentStatus` is what pills are drawn
 * with, and they are not the same list — the vault knows about archiving and
 * the design system does not. Translating in a single function is the point:
 * before this, three components each cast one enum to the other and adding a
 * state broke all three.
 *
 * Archived reads as `paused`, grey and quiet. It is deliberately not
 * `completed`: a green dot would congratulate the operator for shelving
 * something.
 */
const PILL_BY_STATE: Record<ProjectState, AgentStatus> = {
  active: "active",
  blocked: "blocked",
  incubating: "incubating",
  paused: "paused",
  completed: "completed",
  archived: "paused",
};

export function statePill(state: ProjectState): AgentStatus {
  return PILL_BY_STATE[state];
}

export type ProjectFilter = ProjectState | "all";

export interface ProjectGroup {
  state: ProjectState;
  label: string;
  projects: ProjectSummary[];
}

export interface ProjectCounts {
  total: number;
  byState: Record<ProjectState, number>;
}

function rank<T>(order: readonly T[], value: T): number {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

/** State first, then priority, then name — a stable, predictable reading order. */
export function sortProjects(
  projects: readonly ProjectSummary[],
): ProjectSummary[] {
  return [...projects].sort(
    (a, b) =>
      rank(STATE_ORDER, a.state) - rank(STATE_ORDER, b.state) ||
      rank(PRIORITY_ORDER, a.priority) - rank(PRIORITY_ORDER, b.priority) ||
      a.name.localeCompare(b.name),
  );
}

export function filterProjects(
  projects: readonly ProjectSummary[],
  filter: ProjectFilter,
): ProjectSummary[] {
  return filter === "all"
    ? [...projects]
    : projects.filter((project) => project.state === filter);
}

/** Sorted projects, split into state groups. Empty groups are dropped. */
export function groupProjectsByState(
  projects: readonly ProjectSummary[],
): ProjectGroup[] {
  const sorted = sortProjects(projects);

  return STATE_ORDER.map((state) => ({
    state,
    label: STATE_LABELS[state],
    projects: sorted.filter((project) => project.state === state),
  })).filter((group) => group.projects.length > 0);
}

export function countProjects(
  projects: readonly ProjectSummary[],
): ProjectCounts {
  const byState = Object.fromEntries(
    STATE_ORDER.map((state) => [
      state,
      projects.filter((project) => project.state === state).length,
    ]),
  ) as Record<ProjectState, number>;

  return { total: projects.length, byState };
}

/**
 * Filter options for the states actually present, so the bar never offers a
 * filter that would empty the screen. `Blocked` is always offered once anything
 * is blocked, since that is the state worth noticing.
 */
export function buildFilterOptions(
  projects: readonly ProjectSummary[],
): { value: ProjectFilter; label: string; count: number }[] {
  const counts = countProjects(projects);

  return [
    { value: "all" as const, label: "All", count: counts.total },
    ...STATE_ORDER.filter((state) => counts.byState[state] > 0).map(
      (state) => ({
        value: state as ProjectFilter,
        label: STATE_LABELS[state],
        count: counts.byState[state],
      }),
    ),
  ];
}
