import type {
  AgentStatus,
  Priority,
  TimelineRowState,
} from "@/components/os";

/**
 * The dashboard's view model.
 *
 * Everything the Home screen renders comes from here. Nothing downstream of
 * this module reads the filesystem, parses AgentOS markdown, or calls Hermes —
 * presentation consumes the model and only the model.
 */

/** Lifecycle states a project can report. A subset of the design system's status vocabulary. */
export type ProjectState = Extract<
  AgentStatus,
  "active" | "blocked" | "incubating" | "paused" | "completed"
>;


/**
 * Product work competes for attention in the portfolio. Infrastructure supports
 * that work and is tracked without competing with it — AgentOS itself is the
 * standing example.
 */
export type ProjectKind = "product" | "infrastructure";

export interface ProjectSummary {
  /** Stable slug. Also the argument Hermes will receive, e.g. `/work-on pantry-pilot`. */
  id: string;
  name: string;
  state: ProjectState;
  priority: Priority;
  /** Defaults to `product`. */
  kind?: ProjectKind;
  /** Deliberately surface an infrastructure project alongside product work. */
  promoted?: boolean;
  /** One line of current status. Never a paragraph. */
  summary?: string;
  href?: string;
}

export interface CalendarItem {
  id: string;
  /** Pre-formatted for display, e.g. `09:00`. The model owns time formatting, not the UI. */
  time: string;
  title: string;
  detail?: string;
  state?: TimelineRowState;
}

/** The single outcome that matters right now, and the project it belongs to. */
export interface FocusSummary {
  /** Absent when the stated focus does not name a project. */
  project?: string;
  outcome: string;
}

/** One concrete thing to do next. */
export interface NextAction {
  label: string;
  /** Hermes command this dispatches once the agent workflow lands. */
  command: string;
}

export interface DashboardData {
  /** Who the workspace belongs to, used for the greeting. */
  operator: string;
  mainFocus: FocusSummary;
  /** Absent when no project surfaces a concrete next task. */
  nextAction?: NextAction;
  projects: ProjectSummary[];
  calendar: CalendarItem[];
  recentProgress?: string;
  watch?: string;
  /** Unprocessed items waiting in the AgentOS capture inbox. */
  inboxCount: number;
}
