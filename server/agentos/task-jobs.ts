import fs from "node:fs/promises";
import path from "node:path";
import type { TaskJobLink } from "../../shared/delegation-types";
import { uiStateDir } from "./session-store";

/**
 * Which worker job belongs to which project task.
 *
 * A deliberately thin file, and deliberately not in the vault. `TASKS.md` is
 * the project's own account of itself, written by a person and read by one;
 * an execution id is machinery, and putting one in there would mean every
 * delegation edited a hand-written file to record something the project does
 * not care about.
 *
 * So the mapping lives in AgentOS's own state, keyed `project:taskId`. Losing
 * this file loses the link between a task and its job — an inconvenience, not
 * a corruption: the jobs are still there and the tasks are still there.
 */

function linksFile(): string {
  return path.join(uiStateDir(), "task-jobs.json");
}

/** The key one task is filed under. Ids are case-insensitive in the vault. */
export function taskKey(project: string, taskId: string): string {
  return `${project.trim().toLowerCase()}:${taskId.trim().toUpperCase()}`;
}

type LinkFile = Record<string, TaskJobLink>;

/**
 * Reads the whole mapping.
 *
 * A file that cannot be read or parsed is treated as empty rather than thrown
 * on: a corrupted mapping must not take the projects screen down with it, and
 * the worst case is that a delegation looks un-delegated.
 */
export async function readTaskLinks(): Promise<LinkFile> {
  try {
    const contents = await fs.readFile(linksFile(), "utf8");
    const parsed: unknown = JSON.parse(contents);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as LinkFile)
      : {};
  } catch {
    return {};
  }
}

/** Every link recorded for one project. */
export async function projectTaskLinks(
  project: string,
): Promise<TaskJobLink[]> {
  const links = await readTaskLinks();
  const prefix = `${project.trim().toLowerCase()}:`;

  return Object.entries(links)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, link]) => link);
}

export async function readTaskLink(
  project: string,
  taskId: string,
): Promise<TaskJobLink | undefined> {
  return (await readTaskLinks())[taskKey(project, taskId)];
}

/**
 * Writes one link, atomically.
 *
 * The whole file is rewritten through a temporary because it is small and
 * because a half-written mapping would be worse than a stale one: a truncated
 * JSON file reads as no delegations at all, which would offer to delegate work
 * that is already running.
 */
export async function saveTaskLink(link: TaskJobLink): Promise<void> {
  const links = await readTaskLinks();

  links[taskKey(link.project, link.taskId)] = link;

  await fs.mkdir(uiStateDir(), { recursive: true });

  const target = linksFile();
  const temporary = `${target}.${process.pid}.tmp`;

  await fs.writeFile(temporary, `${JSON.stringify(links, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}
