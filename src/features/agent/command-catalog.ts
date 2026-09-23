import type { AgentSkill } from "@shared/agentos-types";

/**
 * Turns the skills Hermes reports into the commands the console offers.
 *
 * Nothing here knows what a skill *does* — Hermes owns that. This decides only
 * how a discovered skill is named, grouped, and ranked, so a skill added to
 * Hermes reaches the palette without a frontend change.
 */

export interface Command {
  /** Bare skill name, e.g. `start-day`. */
  name: string;
  /** Display label, e.g. `Start day`. */
  label: string;
  /** The command as it will be sent, e.g. `/work-on pantry-pilot`. */
  command: string;
  description?: string;
  category: string;
  /** Project-scoped with no project in context: the palette must ask first. */
  needsProject: boolean;
}

/**
 * The commands the console guarantees when Hermes cannot be asked.
 *
 * This is a fallback, not the catalogue: it exists so an unconfigured or
 * unreachable Hermes still leaves a usable console, and it is replaced wholesale
 * the moment discovery succeeds. Nothing is invented here — these are the
 * workflows the console has always shipped.
 */
export const FALLBACK_SKILLS: AgentSkill[] = [
  { name: "dashboard", command: "/dashboard", category: "Daily", scope: "workspace" },
  { name: "start-day", command: "/start-day", category: "Daily", scope: "workspace" },
  { name: "capture", command: "/capture", category: "Daily", scope: "workspace" },
  { name: "work-on", command: "/work-on", category: "Project", scope: "project" },
  { name: "stop-work", command: "/stop-work", category: "Project", scope: "project" },
  {
    name: "project-sync",
    command: "/project-sync",
    category: "Project",
    scope: "project",
  },
];

/**
 * The skills that earn a permanent button.
 *
 * Hermes may have many more; the design system is explicit that not every skill
 * becomes a button. Everything else lives one keystroke away in the palette.
 * A name listed here that Hermes does not have is simply not shown.
 */
const QUICK_ACTION_ORDER = [
  "dashboard",
  "start-day",
  "capture",
  "work-on",
  "stop-work",
  "project-sync",
];

/** Category display order. Anything unlisted follows, alphabetically. */
const CATEGORY_ORDER = ["Daily", "Project", "Review", "System"];

/** Ranked first when a project is in context. */
const PROJECT_SUGGESTIONS = ["work-on", "project-sync", "stop-work"];

/** Ranked first when no project is in context. */
const WORKSPACE_SUGGESTIONS = ["start-day", "dashboard", "capture"];

const MAX_SUGGESTIONS = 3;

/** `start-day` → `Start day`. Hermes' name, made readable. */
export function labelFor(name: string): string {
  const words = name.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The skills to build commands from: Hermes', or the baseline if it has none. */
export function skillsOrFallback(skills: AgentSkill[] | undefined): AgentSkill[] {
  return skills && skills.length > 0 ? skills : FALLBACK_SKILLS;
}

/** One skill as a runnable command, scoped to the project when it takes one. */
export function toCommand(skill: AgentSkill, project?: string): Command {
  const scoped = skill.scope === "project";

  return {
    name: skill.name,
    label: labelFor(skill.name),
    command: scoped && project ? `${skill.command} ${project}` : skill.command,
    description: skill.description,
    category: skill.category ?? "Skills",
    needsProject: scoped && !project,
  };
}

export function buildCommands(
  skills: AgentSkill[] | undefined,
  project?: string,
): Command[] {
  return skillsOrFallback(skills).map((skill) => toCommand(skill, project));
}

export interface QuickCommand {
  label: string;
  command: string;
  description?: string;
  /** True when the command needs a project and none is selected. */
  disabled?: boolean;
}

/**
 * The prominent buttons on the console.
 *
 * Built from what Hermes actually has, in a fixed order so the row does not
 * reshuffle when Hermes reorders its own list.
 */
export function buildQuickCommands(
  skills: AgentSkill[] | undefined,
  project?: string,
): QuickCommand[] {
  const commands = new Map(
    buildCommands(skills, project).map((command) => [command.name, command]),
  );

  return QUICK_ACTION_ORDER.flatMap((name) => {
    const command = commands.get(name);
    if (!command) return [];

    return [
      {
        label: command.label,
        command: command.command,
        description: command.description,
        disabled: command.needsProject,
      },
    ];
  });
}

/** How many commands the palette holds that the quick-action row does not. */
export function overflowCount(skills: AgentSkill[] | undefined): number {
  const all = skillsOrFallback(skills);
  const shown = all.filter((skill) => QUICK_ACTION_ORDER.includes(skill.name));

  return all.length - shown.length;
}

/** Whether every character of `query` appears in `value`, in order. */
function isSubsequence(value: string, query: string): boolean {
  let index = 0;

  for (const character of value) {
    if (character === query[index]) index += 1;
    if (index === query.length) return true;
  }

  return query.length === 0;
}

/**
 * How well a command matches what has been typed, or `undefined` for no match.
 *
 * Lower scores rank higher. A leading slash is ignored, so `/work` and `work`
 * search the same way.
 */
export function scoreCommand(command: Command, query: string): number | undefined {
  const needle = query.trim().replace(/^\/+/, "").toLowerCase();
  if (!needle) return 0;

  const name = command.name.toLowerCase();
  const label = command.label.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  const category = command.category.toLowerCase();

  if (name.startsWith(needle)) return 0;
  if (label.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if (description.includes(needle)) return 3;
  if (category.includes(needle)) return 4;
  // Last resort, so `pjs` still finds `project-sync`.
  if (isSubsequence(name, needle)) return 5;

  return undefined;
}

export interface CommandContext {
  /** Project in context, from the route or the console's own selection. */
  project?: string;
}

/** The commands this context makes most likely, most relevant first. */
function suggestionOrder({ project }: CommandContext): string[] {
  return project ? PROJECT_SUGGESTIONS : WORKSPACE_SUGGESTIONS;
}

/** Commands matching what has been typed, best match first. */
export function searchCommands(
  commands: Command[],
  query: string,
  context: CommandContext,
): Command[] {
  const preferred = suggestionOrder(context);

  return commands
    .flatMap((command) => {
      const score = scoreCommand(command, query);
      return score === undefined ? [] : [{ command, score }];
    })
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;

      // Equally good matches fall back to what this context suggests.
      const rankA = preferred.indexOf(a.command.name);
      const rankB = preferred.indexOf(b.command.name);
      if (rankA !== rankB) return (rankA === -1 ? 99 : rankA) - (rankB === -1 ? 99 : rankB);

      return a.command.name.localeCompare(b.command.name);
    })
    .map((entry) => entry.command);
}

export interface CommandGroup {
  label: string;
  commands: Command[];
}

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/**
 * The palette's default view: what this context suggests, then everything else
 * by category.
 *
 * A suggested command is lifted out of its category rather than shown twice, so
 * every command has exactly one place in the list and arrow keys move through it
 * predictably.
 */
export function groupCommands(
  commands: Command[],
  context: CommandContext,
): CommandGroup[] {
  const preferred = suggestionOrder(context);
  const suggested = preferred
    .flatMap((name) => commands.filter((command) => command.name === name))
    .slice(0, MAX_SUGGESTIONS);

  const suggestedNames = new Set(suggested.map((command) => command.name));
  const byCategory = new Map<string, Command[]>();

  for (const command of commands) {
    if (suggestedNames.has(command.name)) continue;

    const group = byCategory.get(command.category) ?? [];
    group.push(command);
    byCategory.set(command.category, group);
  }

  const categories = [...byCategory.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
    .map(([label, group]) => ({
      label,
      commands: [...group].sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return suggested.length > 0
    ? [{ label: "Suggested", commands: suggested }, ...categories]
    : categories;
}

/** Every command in a grouped list, in the order they are rendered. */
export function flattenGroups(groups: CommandGroup[]): Command[] {
  return groups.flatMap((group) => group.commands);
}

/**
 * The project the operator is already looking at, read from the route.
 *
 * This is what makes the palette context-aware, and it costs nothing: where
 * they are says enough about what they are likely to run next. No agent call
 * is involved.
 */
export function projectInContext(
  pathname: string,
  search: string,
): string | undefined {
  const onProject = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  if (onProject) return decodeURIComponent(onProject[1]);

  if (pathname === "/agent") {
    return new URLSearchParams(search).get("project") ?? undefined;
  }

  return undefined;
}
