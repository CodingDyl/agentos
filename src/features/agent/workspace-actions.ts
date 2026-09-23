import type { ProjectSummary, SearchHitKind } from "@shared/agentos-types";

/**
 * What ⌘K can do besides run a Hermes skill.
 *
 * Three groups, in the order they are reached for: **Create** something,
 * **Navigate** somewhere, ask an **Agent**. None of these involve Hermes in
 * the palette itself — a creation opens a form, a navigation changes the
 * route, an agent action opens the console — so all of them are instant and
 * work with Hermes down.
 *
 * Kept as data rather than JSX so the ranking can be tested without a DOM,
 * and so the same list can be filtered, grouped and searched the way the
 * skill commands already are.
 */

export type ActionGroup = "Create" | "Navigate" | "Agents";

export const ACTION_GROUP_ORDER: readonly ActionGroup[] = ["Create", "Navigate", "Agents"];

export interface PaletteAction {
  id: string;
  group: ActionGroup;
  label: string;
  /** Right-hand text: what it does, or where it goes. */
  hint?: string;
  /** Extra words a search should match, e.g. a project's slug. */
  keywords?: string[];
  run: () => void;
}

export interface ActionContext {
  projects: ProjectSummary[];
  /** Project in context, from the route. */
  project?: string;
  navigate: (to: string) => void;
  quickCreate: (kind: "task" | "project" | "decision" | "capture", project?: string) => void;
}

const SCREENS: readonly { label: string; href: string; hint: string; keywords: string[] }[] = [
  { label: "Mission control", href: "/", hint: "What matters now", keywords: ["home", "dashboard", "today"] },
  { label: "Projects", href: "/projects", hint: "Portfolio", keywords: [] },
  { label: "Designs", href: "/designs", hint: "Design workspace", keywords: ["boards", "assets", "images"] },
  { label: "Operations", href: "/operations", hint: "Costs and budgets", keywords: ["usage", "tokens", "spend"] },
  { label: "Workers", href: "/workers", hint: "Worker jobs", keywords: ["jobs", "grok", "claude"] },
  { label: "Activity", href: "/activity", hint: "Timeline", keywords: ["history", "log"] },
  { label: "Automations", href: "/automations", hint: "Scheduled runs", keywords: ["cron", "schedule"] },
];

export function buildActions(context: ActionContext): PaletteAction[] {
  const { projects, project, navigate, quickCreate } = context;
  const inContext = projects.find((entry) => entry.slug === project);
  const scope = inContext ? ` in ${inContext.name}` : "";
  const projectQuery = project ? `?project=${encodeURIComponent(project)}` : "";

  const create: PaletteAction[] = [
    { id: "create:task", group: "Create", label: "New task", hint: `TASKS.md${scope}`, keywords: ["add", "todo"], run: () => quickCreate("task", project) },
    { id: "create:project", group: "Create", label: "New project", hint: "Four files and a portfolio entry", keywords: ["add"], run: () => quickCreate("project") },
    { id: "create:decision", group: "Create", label: "New decision", hint: `DECISIONS.md${scope}`, keywords: ["add", "record"], run: () => quickCreate("decision", project) },
    {
      id: "create:milestone",
      group: "Create",
      label: "New milestone",
      hint: inContext ? `Roadmap${scope}` : "Choose a project's roadmap",
      keywords: ["roadmap", "release", "goal"],
      run: () => navigate(project ? `/projects/${project}?tab=roadmap&new=1` : "/projects"),
    },
    { id: "create:capture", group: "Create", label: "Capture note", hint: "Prepares /capture", keywords: ["inbox", "idea", "remember"], run: () => quickCreate("capture", project) },
    { id: "create:design", group: "Create", label: "Upload design", hint: `Design workspace${scope}`, keywords: ["image", "asset", "reference"], run: () => navigate(`/designs${projectQuery}`) },
    {
      id: "create:delegate",
      group: "Create",
      label: "Delegate work",
      hint: inContext ? `Pick a task${scope}` : "Choose a project, then a task",
      keywords: ["worker", "assign", "hand off"],
      run: () => navigate(project ? `/projects/${project}?tab=tasks&delegate=1` : "/projects"),
    },
  ];

  const screens: PaletteAction[] = SCREENS.map((screen) => ({
    id: `go:${screen.href}`,
    group: "Navigate",
    label: screen.label,
    hint: screen.hint,
    keywords: screen.keywords,
    run: () => navigate(screen.href),
  }));

  // Every project is one keystroke away. Active first, archived last — the
  // same order the Projects screen reads in.
  const rankState = (state: ProjectSummary["state"]) =>
    ["active", "blocked", "paused", "incubating", "completed", "archived"].indexOf(state);

  const projectRows: PaletteAction[] = [...projects]
    .sort((a, b) => rankState(a.state) - rankState(b.state) || a.name.localeCompare(b.name))
    .map((entry) => ({
      id: `go:/projects/${entry.slug}`,
      group: "Navigate",
      label: entry.name,
      hint: entry.state,
      keywords: [entry.slug, entry.type ?? ""],
      run: () => navigate(`/projects/${entry.slug}`),
    }));

  const agents: PaletteAction[] = [
    { id: "agent:ask", group: "Agents", label: "Ask Hermes", hint: inContext ? `Console${scope}` : "Console", keywords: ["chat", "console", "message"], run: () => navigate(`/agent${projectQuery}`) },
    {
      id: "agent:delegate",
      group: "Agents",
      label: "Delegate task",
      hint: inContext ? `Pick a task${scope}` : "Choose a project first",
      keywords: ["worker", "grok", "claude"],
      run: () => navigate(project ? `/projects/${project}?tab=tasks&delegate=1` : "/projects"),
    },
    { id: "agent:workers", group: "Agents", label: "View active workers", hint: "Running jobs", keywords: ["jobs", "running"], run: () => navigate("/workers") },
  ];

  return [...create, ...screens, ...projectRows, ...agents];
}

/** 0 for a label prefix, 1 for a label substring, 2 for a keyword or hint match; undefined for none. */
export function scoreAction(action: PaletteAction, query: string): number | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  const label = action.label.toLowerCase();
  if (label.startsWith(needle)) return 0;
  if (label.includes(needle)) return 1;
  if ((action.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle))) return 2;
  if (action.hint?.toLowerCase().includes(needle)) return 2;

  return undefined;
}

/** Actions matching what has been typed, best first, source order on ties. */
export function searchActions(actions: PaletteAction[], query: string): PaletteAction[] {
  return actions
    .flatMap((action, index) => {
      const score = scoreAction(action, query);
      return score === undefined ? [] : [{ action, score, index }];
    })
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.action);
}

export interface ActionGroupRows {
  label: ActionGroup;
  actions: PaletteAction[];
}

/**
 * The palette's default view of actions: grouped, in fixed order.
 *
 * `limitNavigate` keeps the Navigate group from being a list of every project
 * when nothing has been typed — the screens plus the first few projects. All
 * of them are still reachable by typing.
 */
export function groupActions(actions: PaletteAction[], limitNavigate = SCREENS.length + 4): ActionGroupRows[] {
  return ACTION_GROUP_ORDER.flatMap((label) => {
    const members = actions.filter((action) => action.group === label);
    const shown = label === "Navigate" ? members.slice(0, limitNavigate) : members;
    return shown.length > 0 ? [{ label, actions: shown }] : [];
  });
}

/** Display names for search result groups. */
export const SEARCH_GROUP_LABELS: Record<SearchHitKind, string> = {
  project: "Projects",
  milestone: "Milestones",
  task: "Tasks",
  decision: "Decisions",
  document: "Documents",
  design: "Designs",
  job: "Worker jobs",
  session: "Sessions",
};
