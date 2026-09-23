import type { ActivityEvent } from "../../shared/agentos-types";
import {
  agentOSRoot,
  fileModifiedAt,
  listDirectory,
  listMarkdownFiles,
  readOptionalFile,
} from "../agentos/filesystem";
import { readRecentCommits } from "../agentos/git";
import { getBullets, getFirstSection, condenseToLine } from "../agentos/markdown";
import { parseWorkSession } from "../agentos/sessions";

/**
 * What happened inside the vault.
 *
 * Nothing here is recorded for the timeline's benefit — these events are read
 * back out of work the vault already did: a session log `/stop-work` wrote, a
 * daily log `/end-day` wrote, a commit that checkpointed the lot. The file's
 * modification time is when it was written down, which is the honest answer to
 * "when did this happen".
 */

const DAILY_DIR = "logs/daily";
const WORK_SESSIONS_DIR = "logs/work-sessions";

/** Per-kind caps, so one busy source cannot crowd out the others. */
const DAILY_LIMIT = 10;
const SESSION_LIMIT = 15;
const COMMIT_LIMIT = 20;

function iso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

function count(items: string[] | undefined): number {
  return items?.length ?? 0;
}

/** `2026-09-05.md` in `pantry-pilot/` → one closed work session. */
async function readWorkSessionEvents(): Promise<ActivityEvent[]> {
  const slugs = await listDirectory(WORK_SESSIONS_DIR);

  const perProject = await Promise.all(
    slugs.map(async (slug) => {
      const directory = `${WORK_SESSIONS_DIR}/${slug}`;
      const files = (await listMarkdownFiles(directory)).slice(-SESSION_LIMIT);

      const events = await Promise.all(
        files.map(async (fileName): Promise<ActivityEvent | undefined> => {
          const relativePath = `${directory}/${fileName}`;
          const [markdown, modified] = await Promise.all([
            readOptionalFile(relativePath),
            fileModifiedAt(relativePath),
          ]);

          const timestamp = iso(modified);
          if (!markdown || !timestamp) return undefined;

          const session = parseWorkSession(markdown, fileName);
          const blockers = count(session.blockers);

          return {
            id: `agentos-session-${slug}-${fileName}`,
            timestamp,
            source: "agentos",
            // A session that ended blocked is not a clean close, and the
            // timeline should not read as though it were.
            level: blockers > 0 ? "warning" : "success",
            type: "session.closed",
            title: "Work session closed",
            description: session.resumeHere
              ? `Resume: ${session.resumeHere}`
              : undefined,
            project: slug,
            metadata: {
              completed: count(session.completed),
              stillOpen: count(session.stillOpen),
              blockers,
            },
          };
        }),
      );

      return events.filter((event): event is ActivityEvent => event !== undefined);
    }),
  );

  return perProject.flat();
}

/** `logs/daily/2026-09-05.md` → one day reviewed. */
async function readDailyLogEvents(): Promise<ActivityEvent[]> {
  const files = (await listMarkdownFiles(DAILY_DIR)).slice(-DAILY_LIMIT);

  const events = await Promise.all(
    files.map(async (fileName): Promise<ActivityEvent | undefined> => {
      const relativePath = `${DAILY_DIR}/${fileName}`;
      const [markdown, modified] = await Promise.all([
        readOptionalFile(relativePath),
        fileModifiedAt(relativePath),
      ]);

      const timestamp = iso(modified);
      if (!markdown || !timestamp) return undefined;

      const completed = getBullets(
        getFirstSection(markdown, ["Completed", "Done"]) ?? "",
      );
      const tomorrow = getFirstSection(markdown, ["Tomorrow", "Next"]);
      const firstAction = getBullets(tomorrow ?? "")[0];

      return {
        id: `agentos-daily-${fileName}`,
        timestamp,
        source: "agentos",
        level: "success",
        type: "daily.recorded",
        title: "Daily log recorded",
        description: firstAction
          ? condenseToLine(`Next: ${firstAction}`, 160)
          : undefined,
        metadata: {
          date: fileName.replace(/\.md$/i, ""),
          completed: completed.length,
        },
      };
    }),
  );

  return events.filter((event): event is ActivityEvent => event !== undefined);
}

/** The vault's own commits — the checkpoints AgentOS state passes through. */
async function readCommitEvents(): Promise<ActivityEvent[]> {
  const commits = await readRecentCommits(agentOSRoot(), COMMIT_LIMIT);

  return commits.map((commit) => ({
    id: `agentos-commit-${commit.hash}`,
    timestamp: commit.date,
    source: "agentos",
    level: "info",
    type: "vault.committed",
    title: "AgentOS checkpoint committed",
    description: commit.subject,
    metadata: { hash: commit.hash.slice(0, 8) },
  }));
}

/**
 * Everything the vault did, unsorted.
 *
 * Each reader degrades on its own: a missing log directory or a vault that is
 * not a git repository contributes nothing, and the rest still reaches the
 * timeline.
 */
export async function readAgentOSActivity(): Promise<ActivityEvent[]> {
  const [sessions, daily, commits] = await Promise.all([
    readWorkSessionEvents(),
    readDailyLogEvents(),
    readCommitEvents(),
  ]);

  return [...sessions, ...daily, ...commits];
}
