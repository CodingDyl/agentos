import type { WorkSessionSummary } from "../../shared/agentos-types";
import { listMarkdownFiles, readOptionalFile } from "./filesystem";
import { condenseToLine, getBullets, getFirstParagraph, getFirstSection } from "./markdown";

/**
 * Work sessions recorded by `/stop-work`, stored per project under
 * `logs/work-sessions/<slug>/`. Every section is optional — a session that only
 * records where to resume is still a valid session.
 */

const WORK_SESSIONS_DIR = "logs/work-sessions";

/** Sessions are a recent-history view, not an archive. */
const DEFAULT_SESSION_LIMIT = 5;

const DATE_STEM = /^(\d{4}-\d{2}-\d{2})/;

function bulletsOrUndefined(
  markdown: string,
  headings: readonly string[],
): string[] | undefined {
  const section = getFirstSection(markdown, headings);
  if (!section) return undefined;

  const bullets = getBullets(section);
  const items = bullets.length > 0 ? bullets : [getFirstParagraph(section) ?? ""];
  const cleaned = items.filter((item) => item.trim().length > 0);

  return cleaned.length > 0 ? cleaned : undefined;
}

/** Reads one work-session log. `fileName` supplies the date when the body omits it. */
export function parseWorkSession(
  markdown: string,
  fileName: string,
): WorkSessionSummary {
  const stem = fileName.replace(/\.md$/i, "");
  const headingDate = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();

  const resumeSection = getFirstSection(markdown, ["Resume Here", "Resume"]);
  const resumeText = resumeSection
    ? (getFirstParagraph(resumeSection) ?? getBullets(resumeSection)[0])
    : undefined;

  const blockers = bulletsOrUndefined(markdown, ["Blockers", "Blocked"]);

  return {
    date: DATE_STEM.exec(stem)?.[1] ?? headingDate ?? stem,
    completed: bulletsOrUndefined(markdown, ["Completed", "Done"]),
    stillOpen: bulletsOrUndefined(markdown, ["Still Open", "Open", "Outstanding"]),
    // "None" is a recorded absence of blockers, not a blocker.
    blockers: blockers?.filter((item) => !/^none\.?$/i.test(item.trim())),
    resumeHere: resumeText ? condenseToLine(resumeText, 200) : undefined,
  };
}

/**
 * The project's most recent work sessions, newest first.
 *
 * Session logs are date-stamped, so filename order is chronological. Only the
 * newest few are read — history stays on disk rather than in the response.
 */
export async function getProjectSessions(
  slug: string,
  limit = DEFAULT_SESSION_LIMIT,
): Promise<WorkSessionSummary[]> {
  const directory = `${WORK_SESSIONS_DIR}/${slug}`;
  const files = await listMarkdownFiles(directory);
  const newest = files.slice(-limit).reverse();

  const sessions = await Promise.all(
    newest.map(async (fileName) => {
      const markdown = await readOptionalFile(`${directory}/${fileName}`);
      return markdown ? parseWorkSession(markdown, fileName) : undefined;
    }),
  );

  return sessions.filter(
    (session): session is WorkSessionSummary => session !== undefined,
  );
}
