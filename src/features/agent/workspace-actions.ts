import type { ProjectSummary, SearchHitKind } from "@shared/agentos-types";

/**
 * What ⌘K can do besides run a Hermes skill.
 *
 * Three groups, in the order they are reached for: **Create** something,
 * start **Work**, **Navigate** somewhere. The objects are everyday ones — a
 * task, a note, a document, a decision, a workspace — and none of them
 * involve Hermes in the palette itself: a creation opens a form, a navigation
 * changes the route, work opens the console with the command ready. All of
 * it is instant and works with Hermes down.
 *
 * Kept as data rather than JSX so the ranking can be tested without a DOM,
 * and so the same list can be filtered, grouped and searched the way the
 * skill commands already are.
 */

export type ActionGroup = "Create" | "Work" | "Navigate";

export const ACTION_GROUP_ORDER: readonly ActionGroup[] = ["Create", "Work", "Navigate"];

export interface PaletteAction {
  id: string;
  group: ActionGroup;
  label: string;
  /** Right-hand text: what it does, or where it goes. */
  hint?: string;
  /** Extra words a search should match, e.g. a workspace's slug. */
  keywords?: string[];
  run: () => void;
}

export type QuickCreateTarget = "task" | "project" | "decision" | "capture" | "document";

export interface ActionContext {
  projects: ProjectSummary[];
  /** Workspace in context, from the route. */
  project?: string;
  /** Recently opened workspace slugs, most recent first. Ranked first under Navigate. */
  recent?: readonly string[];
  navigate: (to: string) => void;
  quickCreate: (kind: QuickCreateTarget, project?: string) => void;
  /** Opens the friction report for the screen on show. Absent, the action is not offered. */
  reportFriction?: () => void;
}

const SCREENS: readonly { label: string; href: string; hint: string; keywords: string[] }[] = [
  { label: "Today", href: "/", hint: "What matters today", keywords: ["home", "mission control", "dashboard", "attention"] },
  { label: "Inbox", href: "/inbox", hint: "Mail", keywords: ["email", "gmail", "mail"] },
  { label: "Workspaces", href: "/workspaces", hint: "All areas of work", keywords: ["projects", "portfolio"] },
  { label: "Knowledge", href: "/knowledge", hint: "Documents and decisions", keywords: ["docs", "notes", "research", "specs"] },
  { label: "Creative", href: "/designs", hint: "Visuals and generations", keywords: ["designs", "boards", "assets", "images", "higgsfield"] },
  { label: "Operations", href: "/operations", hint: "Agents, usage and cost", keywords: ["usage", "tokens", "spend", "models", "budget"] },
  { label: "Automations", href: "/automations", hint: "Scheduled runs", keywords: ["cron", "schedule"] },
  { label: "Connectors", href: "/connectors", hint: "Services and capabilities", keywords: ["integrations", "github", "vercel", "permissions", "capabilities"] },
  { label: "Activity", href: "/activity", hint: "Timeline", keywords: ["history", "log"] },
  { label: "Friction", href: "/operations?tab=friction", hint: "What to fix first", keywords: ["feedback", "annoyances", "papercuts", "review"] },
  { label: "Agents", href: "/workers", hint: "Workers and their jobs", keywords: ["jobs", "grok", "claude", "workers", "cancel"] },
  { label: "Hermes console", href: "/agent", hint: "Operations · agents", keywords: ["agent", "chat", "console"] },
];

export function buildActions(context: ActionContext): PaletteAction[] {
  const { projects, project, navigate, quickCreate } = context;
  const inContext = projects.find((entry) => entry.slug === project);
  const scope = inContext ? ` in ${inContext.name}` : "";
  const projectQuery = project ? `?project=${encodeURIComponent(project)}` : "";

  const create: PaletteAction[] = [
    { id: "create:task", group: "Create", label: "New task", hint: inContext ? `Tasks${scope}` : "Choose a workspace", keywords: ["add", "todo"], run: () => quickCreate("task", project) },
    { id: "create:capture", group: "Create", label: "Capture note", hint: "Straight to the inbox", keywords: ["inbox", "idea", "remember", "quick"], run: () => quickCreate("capture", project) },
    { id: "create:document", group: "Create", label: "New document", hint: inContext ? `Documents${scope}` : "Choose a workspace", keywords: ["doc", "note", "write", "spec", "plan"], run: () => quickCreate("document", project) },
    { id: "create:project", group: "Create", label: "New workspace", hint: "Four files and a portfolio entry", keywords: ["add", "project"], run: () => quickCreate("project") },
    { id: "create:decision", group: "Create", label: "Add decision", hint: inContext ? `Decisions${scope}` : "Choose a workspace", keywords: ["new", "record"], run: () => quickCreate("decision", project) },
    {
      id: "create:milestone",
      group: "Create",
      label: "New milestone",
      hint: inContext ? `Roadmap${scope}` : "Choose a workspace's roadmap",
      keywords: ["roadmap", "release", "goal"],
      run: () => navigate(project ? `/workspaces/${project}?tab=roadmap&new=1` : "/workspaces"),
    },
    { id: "create:design", group: "Create", label: "Upload creative asset", hint: `Creative${scope}`, keywords: ["image", "asset", "reference", "design", "upload"], run: () => navigate(`/designs${projectQuery}`) },
  ];

  const work: PaletteAction[] = [
    {
      id: "work:focus",
      group: "Work",
      label: "Start focus",
      hint: inContext ? `/work-on ${inContext.slug}` : "/start-day",
      keywords: ["session", "work on", "begin"],
      run: () =>
        navigate(
          project
            ? `/agent?project=${encodeURIComponent(project)}&run=${encodeURIComponent(`/work-on ${project}`)}`
            : `/agent?run=${encodeURIComponent("/start-day")}`,
        ),
    },
    {
      id: "work:delegate",
      group: "Work",
      label: "Delegate task",
      hint: inContext ? `Pick a task${scope}` : "Choose a workspace first",
      keywords: ["worker", "grok", "claude", "assign", "hand off"],
      run: () => navigate(project ? `/workspaces/${project}?tab=tasks&delegate=1` : "/workspaces"),
    },
    { id: "work:ask", group: "Work", label: "Ask Hermes", hint: inContext ? `Console${scope}` : "Console", keywords: ["chat", "console", "message", "agent"], run: () => navigate(`/agent${projectQuery}`) },
    ...(context.reportFriction
      ? [
          {
            id: "work:friction",
            group: "Work" as const,
            label: "Report friction",
            hint: "Something in AgentOS annoyed you",
            keywords: ["feedback", "annoying", "annoyed", "bug", "papercut", "complain", "friction"],
            run: context.reportFriction,
          },
        ]
      : []),
  ];

  const screens: PaletteAction[] = SCREENS.map((screen) => ({
    id: `go:${screen.href}`,
    group: "Navigate",
    label: screen.label,
    hint: screen.hint,
    keywords: screen.keywords,
    run: () => navigate(screen.href),
  }));

  // Every workspace is one keystroke away: recently opened first, then active
  // before parked, archived last — the order the Workspaces screen reads in.
  const recent = context.recent ?? [];
  const rankRecent = (slug: string) => {
    const index = recent.indexOf(slug);
    return index === -1 ? recent.length : index;
  };
  const rankState = (state: ProjectSummary["state"]) =>
    ["active", "blocked", "paused", "incubating", "completed", "archived"].indexOf(state);

  const workspaceRows: PaletteAction[] = [...projects]
    .sort((a, b) => rankRecent(a.slug) - rankRecent(b.slug) || rankState(a.state) - rankState(b.state) || a.name.localeCompare(b.name))
    .map((entry) => ({
      id: `go:/workspaces/${entry.slug}`,
      group: "Navigate",
      label: entry.name,
      hint: recent.includes(entry.slug) ? "Recent" : entry.state,
      keywords: [entry.slug, entry.type ?? "", entry.workspaceType ?? "", "workspace"],
      run: () => navigate(`/workspaces/${entry.slug}`),
    }));

  return [...create, ...work, ...screens, ...workspaceRows];
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
 * `limitNavigate` keeps the Navigate group from being a list of every
 * workspace when nothing has been typed — the screens plus the first few
 * (most recent) workspaces. All of them are still reachable by typing.
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
  project: "Workspaces",
  milestone: "Milestones",
  task: "Tasks",
  decision: "Decisions",
  document: "Documents",
  design: "Creative",
  job: "Worker jobs",
  session: "Sessions",
};
