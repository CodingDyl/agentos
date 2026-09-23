import { useMemo } from "react";
import type { DashboardData as DashboardWireData } from "@shared/agentos-types";
import { useDashboard } from "@/lib/agentos/queries";
import { mockCalendarItems } from "./dashboard-mock";
import type { DashboardData, ProjectSummary } from "./dashboard-model";
import { selectSessionCommand } from "./dashboard-selectors";

/**
 * The dashboard's single data seam.
 *
 * The adapter's wire model is mapped once, here, into the view model the screen
 * already speaks — so replacing the Node adapter with Tauri commands later
 * changes this file and nothing else. Calendar is still mocked (see
 * `dashboard-mock`); every other field is read from `~/AgentOS`.
 */

/** The workspace owner. Not part of the dashboard contract, so it stays local. */
const OPERATOR = "Dylan";

export interface DashboardDataResult {
  data?: DashboardData;
  isLoading: boolean;
  /** True while a read is in flight, including a retry over existing state. */
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

function toProjectSummary(
  project: DashboardWireData["projects"][number],
): ProjectSummary {
  return {
    id: project.slug,
    name: project.name,
    // The dashboard's own narrower state vocabulary; archived work never
    // reaches this screen, so it reads as parked rather than adding a state.
    state: project.state === "archived" ? "paused" : project.state,
    priority: project.priority,
    kind: project.kind,
    promoted: project.promoted,
    summary: project.status,
    href: `/projects/${project.slug}`,
  };
}

/** Maps the adapter's wire model onto the view model the screen renders. */
export function toDashboardView(wire: DashboardWireData): DashboardData {
  const base: DashboardData = {
    operator: OPERATOR,
    mainFocus: wire.mainFocus,
    projects: wire.projects.map(toProjectSummary),
    calendar: mockCalendarItems,
    recentProgress: wire.recentProgress,
    watch: wire.watch,
    inboxCount: wire.inboxCount,
  };

  const command = selectSessionCommand(base);

  return {
    ...base,
    nextAction:
      wire.nextAction && command
        ? { label: wire.nextAction, command }
        : undefined,
  };
}

export function useDashboardData(): DashboardDataResult {
  const query = useDashboard();

  const data = useMemo(
    () => (query.data ? toDashboardView(query.data) : undefined),
    [query.data],
  );

  return {
    data,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
