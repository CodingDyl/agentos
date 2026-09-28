import type {
  ProjectDecision,
  ProjectDetail,
  ProjectKind,
  ProjectPriority,
  ProjectState,
  ProjectSummary,
  ProjectTask,
  ProjectTaskGroup,
  ProjectTaskSection,
} from "../../shared/agentos-types";
import { listDirectory, readOptionalFile, statNewest } from "./filesystem";
import { readGitStatus } from "./git";
import { parseConfiguration } from "./mutations/configuration";
import { resolveWorkspaceType } from "../../shared/workspace";
import { getMilestoneSummary } from "./roadmap";
import { readSection } from "./mutations/prose-document";
import {
  condenseToLine,
  getBullets,
  getDocumentBody,
  getField,
  getFirstParagraph,
  getFirstSection,
  getSections,
  getTasks,
  parseTable,
} from "./markdown";
import { getProjectSessions } from "./sessions";

const PORTFOLIO_PATH = "projects/PORTFOLIO.md";
const PROJECTS_DIR = "projects";

/** Files that count as evidence a project was worked on. */
const ACTIVITY_FILES = ["STATUS.md", "TASKS.md", "DECISIONS.md", "PROJECT.md"];

/** Portfolio facts, before the filesystem is consulted for a slug or detail. */
export interface PortfolioEntry {
  name: string;
  type?: string;
  state: ProjectState;
  priority: ProjectPriority;
  kind: ProjectKind;
  promoted?: boolean;
}

/**
 * How much of the vault to read.
 *
 * `live` keeps the dashboard cheap — parked work costs nothing beyond its
 * portfolio entry. `all` is for the projects screen, which exists to browse
 * everything including incubating and completed work.
 */
export type ProjectDetailScope = "live" | "all";

const STATE_BY_LABEL: Record<string, ProjectState> = {
  active: "active",
  running: "active",
  "in progress": "active",
  blocked: "blocked",
  incubating: "incubating",
  exploring: "incubating",
  paused: "paused",
  "on hold": "paused",
  completed: "completed",
  complete: "completed",
  done: "completed",
  shipped: "completed",
  archived: "archived",
  "on ice": "archived",
};

const PRIORITY_BY_LABEL: Record<string, ProjectPriority> = {
  high: "high",
  medium: "medium",
  low: "low",
};

/** Type labels that mark a project as supporting infrastructure. */
const INFRASTRUCTURE_HINTS = ["infrastructure", "internal", "tooling", "platform"];

/** A project currently in play, as opposed to parked or finished. */
export function isLiveState(state: ProjectState): boolean {
  return state === "active" || state === "blocked";
}

/**
 * Unrecognised values fall to the parked end of each scale on purpose: an
 * unclassified project should never quietly claim a slot on the dashboard.
 */
function toState(label: string | undefined): ProjectState {
  return STATE_BY_LABEL[label?.trim().toLowerCase() ?? ""] ?? "incubating";
}

function toPriority(label: string | undefined): ProjectPriority {
  return PRIORITY_BY_LABEL[label?.trim().toLowerCase() ?? ""] ?? "low";
}

function toKind(typeLabel: string | undefined): ProjectKind {
  const label = typeLabel?.toLowerCase() ?? "";
  return INFRASTRUCTURE_HINTS.some((hint) => label.includes(hint))
    ? "infrastructure"
    : "product";
}

/**
 * Reads the portfolio in either shape AgentOS uses: `### Name` blocks with
 * `Key: value` lines (the current vault), or a pipe table of
 * `| Name | Type | State | Priority |`.
 */
export function parsePortfolio(markdown: string): PortfolioEntry[] {
  const projectsSection = getFirstSection(markdown, ["Projects"]) ?? markdown;

  const headingEntries = getSections(projectsSection, 3)
    .filter((section) => section.title.length > 0)
    .map((section) => {
      const type = getField(section.body, "Type");
      return {
        name: section.title,
        type,
        state: toState(getField(section.body, "State")),
        priority: toPriority(getField(section.body, "Priority")),
        kind: toKind(type),
        promoted: parsePromoted(getField(section.body, "Promoted")),
      };
    });

  if (headingEntries.length > 0) return headingEntries;

  return parseTable(projectsSection)
    .filter((row) => row.cells.length >= 4 && row.cells[0].length > 0)
    .map(({ cells: [name, type, state, priority] }) => ({
      name,
      type: type.length > 0 ? type : undefined,
      state: toState(state),
      priority: toPriority(priority),
      kind: toKind(type),
    }));
}

function parsePromoted(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return /^(true|yes)$/i.test(value.trim());
}

/** Maps a normalised project name onto the directory that actually exists. */
async function buildSlugResolver(): Promise<(name: string) => string> {
  const entries = await listDirectory(PROJECTS_DIR);
  const byNormalised = new Map(
    entries.map((entry) => [normalise(entry), entry] as const),
  );

  return (name: string) =>
    byNormalised.get(normalise(name)) ?? toKebabCase(name);
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** One-line status for a project, from `STATUS.md`. */
export function parseProjectStatus(markdown: string): string | undefined {
  const section =
    getFirstSection(markdown, ["Current Stage", "Status", "Summary"]) ??
    getDocumentBody(markdown);

  const paragraph = getFirstParagraph(section);
  return paragraph ? condenseToLine(paragraph) : undefined;
}

/**
 * The next thing to do on a project, from `TASKS.md`.
 *
 * Reads the title without its id, for the same reason the task list shows the
 * id as its own chip: an id identifies a task, it is not part of what the task
 * says. A one-line summary that opened with `[PP-001]` would be reading the
 * file's bookkeeping aloud.
 */
export function parseProjectNextAction(markdown: string): string | undefined {
  for (const heading of ["Now", "Next"]) {
    const section = getFirstSection(markdown, [heading]);
    if (!section) continue;

    const [task] = getTasks(section).filter((entry) => !entry.completed);
    if (task) return condenseToLine(task.title);
  }

  return undefined;
}

async function readProjectDetail(
  slug: string,
): Promise<Pick<ProjectSummary, "status" | "nextAction" | "lastActivity" | "nowCount">> {
  const [status, tasks, lastActivity] = await Promise.all([
    readOptionalFile(`${PROJECTS_DIR}/${slug}/STATUS.md`),
    readOptionalFile(`${PROJECTS_DIR}/${slug}/TASKS.md`),
    statNewest(ACTIVITY_FILES.map((file) => `${PROJECTS_DIR}/${slug}/${file}`)),
  ]);

  return {
    status: status ? parseProjectStatus(status) : undefined,
    nextAction: tasks ? parseProjectNextAction(tasks) : undefined,
    lastActivity: lastActivity?.toISOString(),
    nowCount: tasks ? parseProjectTasks(tasks).now.filter((task) => !task.completed).length : undefined,
  };
}

/**
 * The project landscape, in portfolio order.
 *
 * With the default `live` scope, detail files are read only for projects in
 * play. Pass `all` when the caller genuinely browses the whole portfolio.
 */
export async function getProjects(
  scope: ProjectDetailScope = "live",
): Promise<ProjectSummary[]> {
  const portfolio = await readOptionalFile(PORTFOLIO_PATH);
  if (!portfolio) return [];

  const entries = parsePortfolio(portfolio);
  const resolveSlug = await buildSlugResolver();

  return Promise.all(
    entries.map(async (entry): Promise<ProjectSummary> => {
      const slug = resolveSlug(entry.name);
      // Every row needs its workspace type, parked ones included — the
      // Workspaces screen groups and labels by it. One small file per project.
      const configuration = parseConfiguration(
        await readOptionalFile(`${PROJECTS_DIR}/${slug}/PROJECT.md`),
      );
      const summary: ProjectSummary = {
        slug,
        ...entry,
        workspaceType: resolveWorkspaceType(configuration.workspaceType, entry.type),
      };

      const wantsDetail =
        scope === "all" ||
        (isLiveState(entry.state) &&
          (entry.priority === "high" || entry.priority === "medium"));

      if (!wantsDetail) return summary;

      const [detail, roadmap] = await Promise.all([
        readProjectDetail(slug),
        // Where the project is going, for the portfolio row. Deterministic and
        // cheap: two small files and the job links.
        getMilestoneSummary(slug),
      ]);

      return {
        ...summary,
        ...detail,
        milestone: roadmap?.milestone,
        health: roadmap?.health,
      };
    }),
  );
}


/**
 * Task lists from `TASKS.md`, keyed by horizon.
 *
 * Completed tasks are included now that a task can be delegated: a task keeps
 * its identity after it is done, and the console has to be able to show that
 * the thing it delegated was finished rather than lose track of it the moment
 * the box was ticked.
 */
export function parseProjectTasks(markdown: string): ProjectTaskGroup {
  const read = (
    headings: readonly string[],
    section: ProjectTaskSection,
  ): ProjectTask[] => {
    const body = getFirstSection(markdown, headings);
    if (!body) return [];

    return getTasks(body).map((task) => ({ ...task, section }));
  };

  return {
    now: read(["Now"], "now"),
    next: read(["Next", "Up Next"], "next"),
    later: read(["Later", "Someday"], "later"),
  };
}

/** Every task in a project, across horizons. */
export function allTasks(tasks: ProjectTaskGroup): ProjectTask[] {
  return [...tasks.now, ...tasks.next, ...tasks.later];
}

/**
 * Durable decisions from `DECISIONS.md`, one per `##` heading.
 *
 * A lead-in that ends in a colon is completed with the list it introduces, so
 * an entry never reads as a dangling sentence.
 */
export function parseProjectDecisions(markdown: string): ProjectDecision[] {
  return getSections(markdown, 2)
    .filter((section) => section.title.length > 0)
    .map((section) => {
      const paragraph = getFirstParagraph(section.body);
      const bullets = getBullets(section.body);

      const detail = !paragraph
        ? bullets.join(", ") || undefined
        : paragraph.endsWith(":") && bullets.length > 0
          ? `${paragraph} ${bullets.join(", ")}`
          : paragraph;

      return {
        title: section.title,
        detail: detail ? condenseToLine(detail, 240) : undefined,
      };
    });
}

/** Local repository path linked from `PROJECT.md`'s Connected Systems. */
export function parseRepositoryPath(markdown: string): string | undefined {
  const section = getFirstSection(markdown, ["Connected Systems"]) ?? markdown;
  return (
    getField(section, "Local repository") ?? getField(section, "Local repo")
  );
}

/**
 * Resolves a URL slug to a real project.
 *
 * The URL never reaches the filesystem directly: a slug is only used after it
 * matches a project the portfolio actually lists.
 */
export async function findProject(
  slug: string,
): Promise<ProjectSummary | undefined> {
  const projects = await getProjects("all");
  return projects.find((project) => project.slug === slug);
}

/**
 * Everything one project screen needs, in a single read.
 *
 * Each source degrades on its own: a project with no `DECISIONS.md` simply has
 * no decisions, and an unreadable repository reports itself through `git`.
 */
export async function getProjectDetail(
  slug: string,
): Promise<ProjectDetail | undefined> {
  const summary = await findProject(slug);
  if (!summary) return undefined;

  const directory = `${PROJECTS_DIR}/${summary.slug}`;

  const [tasksMarkdown, decisionsMarkdown, projectMarkdown, sessions] =
    await Promise.all([
      readOptionalFile(`${directory}/TASKS.md`),
      readOptionalFile(`${directory}/DECISIONS.md`),
      readOptionalFile(`${directory}/PROJECT.md`),
      getProjectSessions(summary.slug),
    ]);

  const git = await readGitStatus(
    projectMarkdown ? parseRepositoryPath(projectMarkdown) : undefined,
  );

  return {
    ...summary,
    tasks: tasksMarkdown
      ? parseProjectTasks(tasksMarkdown)
      : { now: [], next: [], later: [] },
    decisions: decisionsMarkdown ? parseProjectDecisions(decisionsMarkdown) : [],
    sessions,
    git,
    purpose: projectMarkdown ? readSection(projectMarkdown, "Purpose") : undefined,
    configuration: parseConfiguration(projectMarkdown),
    archivedTaskCount: tasksMarkdown ? countArchivedTasks(tasksMarkdown) : 0,
  };
}

/** How many tasks sit in `## Archived`. Shown as a count, not as rows. */
export function countArchivedTasks(markdown: string): number {
  const body = getFirstSection(markdown, ["Archived"]);

  return body ? getTasks(body).length : 0;
}
