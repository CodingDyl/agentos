import type { DashboardData, ProjectSummary } from "../../shared/agentos-types";
import { listMarkdownFiles, readOptionalFile } from "./filesystem";
import {
  condenseToLine,
  getBullets,
  getFirstParagraph,
  getFirstSection,
  getSections,
} from "./markdown";
import { getProjects, isLiveState } from "./projects";

/**
 * Turns the AgentOS vault into the dashboard's view of the day.
 *
 * Every derivation below degrades on its own: a missing file, a missing
 * section, or an empty log directory drops one field rather than failing the
 * request. Only a genuinely unreadable vault produces an error.
 */

const CURRENT_FOCUS_PATH = "me/CURRENT_FOCUS.md";
const CAPTURE_PATH = "inbox/CAPTURE.md";
const WORK_SESSIONS_DIR = "logs/work-sessions";
const DAILY_LOGS_DIR = "logs/daily";

const FALLBACK_OUTCOME = "No current focus recorded in AgentOS.";

/** Headings that are guidance about the focus rather than a focus entry. */
const FOCUS_META_HEADINGS = new Set(["rule", "rules", "notes", "note"]);

export interface FocusEntry {
  name: string;
  outcome?: string;
}

/**
 * Focus entries from `CURRENT_FOCUS.md`, in stated priority order.
 *
 * The vault numbers them (`## 1. AgentOS`), so ordinals win when present and
 * document order is the fallback. Guidance sections are excluded.
 */
export function parseFocusEntries(markdown: string): FocusEntry[] {
  const sections = getSections(markdown, 2).filter(
    (section) =>
      section.title.length > 0 &&
      !FOCUS_META_HEADINGS.has(section.title.toLowerCase()),
  );

  const numbered = sections.filter((section) => section.ordinal !== undefined);
  const ordered = numbered.length > 0 ? [...numbered] : sections;

  if (numbered.length > 0) {
    ordered.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  }

  return ordered.map((section) => ({
    name: section.title,
    outcome: getFirstParagraph(section.body),
  }));
}

/** The risk or guardrail to carry into the day, if the focus file states one. */
export function parseWatch(markdown: string): string | undefined {
  const section = getFirstSection(markdown, [
    "Watch",
    "Risk",
    "Risks",
    "Warning",
    "Warnings",
    "Rule",
    "Rules",
  ]);
  if (!section) return undefined;

  const paragraph = getFirstParagraph(section) ?? getBullets(section)[0];
  return paragraph ? condenseToLine(paragraph, 200) : undefined;
}

/** Unprocessed items sitting in `CAPTURE.md`. */
export function parseInboxCount(markdown: string): number {
  const section = getFirstSection(markdown, ["Inbox"]);
  return section ? getBullets(section).length : 0;
}

/** Where a `/stop-work` session said to pick things up. */
export function parseResumeHere(markdown: string): string | undefined {
  const section = getFirstSection(markdown, ["Resume Here", "Resume"]);
  if (!section) return undefined;

  const text = getFirstParagraph(section) ?? getBullets(section)[0];
  return text ? condenseToLine(text) : undefined;
}

/** What moved: a work session's summary, or the newest daily log's first completion. */
export function parseProgress(markdown: string): string | undefined {
  const section = getFirstSection(markdown, [
    "Summary",
    "Progress",
    "Completed",
    "What Moved",
  ]);
  if (!section) return undefined;

  const text = getFirstParagraph(section) ?? getBullets(section)[0];
  return text ? condenseToLine(text) : undefined;
}

/** Newest markdown file in a log directory, or `undefined` when there are none. */
async function readNewestLog(directory: string): Promise<string | undefined> {
  const files = await listMarkdownFiles(directory);
  const newest = files.at(-1);
  return newest ? readOptionalFile(`${directory}/${newest}`) : undefined;
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The portfolio project the focus is actually about.
 *
 * Focus entries are scanned in order, so a focus led by infrastructure work
 * (AgentOS itself) still resolves to the product project underneath it. Falls
 * back to the highest-priority live project.
 */
export function resolveFocusProject(
  focusEntries: readonly FocusEntry[],
  projects: readonly ProjectSummary[],
): ProjectSummary | undefined {
  for (const entry of focusEntries) {
    const match = projects.find(
      (project) => normalise(project.name) === normalise(entry.name),
    );
    if (match) return match;
  }

  const priorityRank = { high: 0, medium: 1, low: 2 } as const;

  return [...projects]
    .filter((project) => isLiveState(project.state))
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
    .at(0);
}

export async function getDashboardData(): Promise<DashboardData> {
  const [focusMarkdown, captureMarkdown, projects, workSession, dailyLog] =
    await Promise.all([
      readOptionalFile(CURRENT_FOCUS_PATH),
      readOptionalFile(CAPTURE_PATH),
      getProjects("live"),
      readNewestLog(WORK_SESSIONS_DIR),
      readNewestLog(DAILY_LOGS_DIR),
    ]);

  const focusEntries = focusMarkdown ? parseFocusEntries(focusMarkdown) : [];
  const leadFocus = focusEntries.at(0);
  const focusProject = resolveFocusProject(focusEntries, projects);

  // A stopped session knows exactly where work paused, so it outranks the
  // project's own task list.
  const nextAction =
    (workSession ? parseResumeHere(workSession) : undefined) ??
    focusProject?.nextAction;

  const recentProgress =
    (workSession ? parseProgress(workSession) : undefined) ??
    (dailyLog ? parseProgress(dailyLog) : undefined);

  return {
    mainFocus: {
      project: leadFocus?.name,
      outcome: leadFocus?.outcome ?? FALLBACK_OUTCOME,
    },
    focusProjectSlug: focusProject?.slug,
    nextAction,
    projects,
    recentProgress,
    watch: focusMarkdown ? parseWatch(focusMarkdown) : undefined,
    inboxCount: captureMarkdown ? parseInboxCount(captureMarkdown) : 0,
  };
}
