/**
 * Dashboard grid: columns arrive as the viewport grows, cards span 1–2 of
 * them by importance, and `grid-auto-flow: dense` packs the rest. The pixel
 * values here are the same ones `agentos.css` uses, so a test of the layout
 * is a test of the stylesheet.
 */

export const DASHBOARD_COLUMN_BREAKPOINTS = [
  { minWidth: 0, columns: 1 },
  { minWidth: 1280, columns: 2 },
  { minWidth: 1600, columns: 3 },
  { minWidth: 1920, columns: 4 },
  { minWidth: 2560, columns: 5 },
  { minWidth: 3440, columns: 6 },
] as const;

export function dashboardColumnCount(viewportWidth: number): number {
  let columns = 1;
  for (const point of DASHBOARD_COLUMN_BREAKPOINTS) {
    if (viewportWidth >= point.minWidth) columns = point.columns;
  }
  return columns;
}

/**
 * Every Dashboard card, with how many columns it should take when there is
 * room. `full` is the revenue strip: one row across the viewport. `2` is for
 * things that need a decision or are live. Everything else is one column.
 */
export const DASHBOARD_CARDS = {
  revenue: { span: "full" },
  inbox: { span: 2 },
  yourThree: { span: 2 },
  todos: { span: 1 },
  scheduled: { span: 1 },
  dayPlan: { span: 1 },
  focus: { span: 2 },
  compass: { span: 1 },
  activeWork: { span: 2 },
  overviewCalendar: { span: "full" },
  workspaces: { span: 1 },
  traction: { span: 1 },
  career: { span: 1 },
  finance: { span: 1 },
  captured: { span: 1 },
  activity: { span: 1 },
  usage: { span: 1 },
  documents: { span: 1 },
  news: { span: 1 },
  trending: { span: 1 },
  scorecard: { span: "full" },
} as const;

export type DashboardCardId = keyof typeof DASHBOARD_CARDS;

export function dashboardCardSpan(card: DashboardCardId, columns: number): number {
  const room = Math.max(1, columns);
  const spec = DASHBOARD_CARDS[card];
  if (spec.span === "full") return room;
  return Math.min(spec.span, room);
}

export function dashboardCardClass(card: DashboardCardId): string {
  const spec = DASHBOARD_CARDS[card];
  if (spec.span === "full") return "dashboard-span-full";
  if (spec.span === 2) return "dashboard-span-2";
  return "dashboard-span-1";
}
