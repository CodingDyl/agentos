import type { Priority } from "@/components/os";
import type { DashboardData, ProjectSummary } from "./dashboard-model";

/**
 * Pure derivations over `DashboardData`. Presentation components stay free of
 * filtering, ranking, and formatting logic.
 */

/** The dashboard ranks work, so it only lists projects that compete for today. */
const DASHBOARD_PRIORITIES: readonly Priority[] = ["high", "medium"];

const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Infrastructure is tracked but kept out of the portfolio, so tooling work
 * cannot quietly crowd out product work. Promote it explicitly to opt in.
 */
function competesForAttention(project: ProjectSummary): boolean {
  return project.kind !== "infrastructure" || project.promoted === true;
}

/**
 * The projects competing for today: high and medium priority product work,
 * most urgent first. See DESIGN.md §13.4.
 */
export function selectActiveProjects(
  projects: readonly ProjectSummary[],
): ProjectSummary[] {
  return projects
    .filter(
      (project) =>
        DASHBOARD_PRIORITIES.includes(project.priority) &&
        competesForAttention(project),
    )
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
}

/**
 * The command "Start session" will hand to Hermes: the focused project when it
 * resolves, otherwise the highest-priority project on the board.
 */
export function selectSessionCommand(data: DashboardData): string | undefined {
  const focused = data.projects.find(
    (project) => project.name === data.mainFocus.project,
  );
  const ranked = selectActiveProjects(data.projects);
  const target = focused ?? (ranked.length > 0 ? ranked[0] : undefined);

  return target ? `/work-on ${target.id}` : undefined;
}

/** Time-of-day greeting. Local only — never a model request. */
export function selectGreeting(operator: string, now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return `Good morning, ${operator}`;
  if (hour < 18) return `Good afternoon, ${operator}`;
  return `Good evening, ${operator}`;
}

/** Short calendar date for the header meta line, e.g. `Sat 06 Sep`. */
export function formatDashboardDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(now);
}
