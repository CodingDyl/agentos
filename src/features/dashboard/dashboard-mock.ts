import type { CalendarItem } from "./dashboard-model";

/**
 * The last mocked slice of the dashboard.
 *
 * Focus, projects, progress, watch, and inbox now come from the AgentOS vault
 * through the local data adapter. Calendar gets its own adapter later; until
 * then these placeholder events keep the Today section honest about being the
 * one section that is not yet real.
 */
export const mockCalendarItems: CalendarItem[] = [
  { id: "stand-up", time: "09:00", title: "Stand-up", state: "past" },
  { id: "project-meeting", time: "14:00", title: "Project meeting", state: "next" },
];
