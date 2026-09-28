import type { ActivityEvent, ProjectSummary } from "../../shared/agentos-types";
import type { DayWrap, WrapCarryItem, WrapDoneItem } from "../../shared/today-types";
import { getActivity } from "../activity";
import { readTasks } from "../agentos/mutations/tasks";
import { getProjects } from "../agentos/projects";

/**
 * The end-of-day wrap: what got done today, and what tomorrow starts with.
 *
 * "Done" is read from the activity log (tasks marked complete, worker changes
 * approved or integrated, milestones finished), so it only counts what
 * AgentOS actually saw happen. "Carrying over" is every unfinished Now task,
 * which is the honest answer to "what's left" without a model guessing.
 */

const CARRY_LIMIT = 8;
const ACTIVITY_WINDOW = 300;

const DONE_KIND: Record<string, WrapDoneItem["kind"]> = {
  "task.completed": "task",
  "worker.approved": "worker",
  "worker.integrated": "worker",
  "milestone.completed": "milestone",
};

type TaskLookup = ReadonlyMap<string, ReadonlyMap<string, string>>;

function sameLocalDay(iso: string, now: Date): boolean {
  const date = new Date(iso);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function firstLine(text: string): string {
  const line = text.split("\n")[0].replace(/\s*\([0-9a-f]{6,}\)\s*$/, "").trim();
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

export interface WrapInput {
  events: readonly ActivityEvent[];
  projects: readonly Pick<ProjectSummary, "slug" | "name">[];
  /** Per project slug: task id → title, for naming completed tasks. */
  taskTitles: TaskLookup;
  /** Per project slug: its open Now tasks, in file order. */
  openNow: ReadonlyMap<string, readonly { id?: string; title: string }[]>;
  now: Date;
}

export function buildWrap({ events, projects, taskTitles, openNow, now }: WrapInput): DayWrap {
  const nameOf = new Map(projects.map((project) => [project.slug, project.name]));
  const done: WrapDoneItem[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const kind = DONE_KIND[event.type];
    if (!kind || !sameLocalDay(event.timestamp, now)) continue;

    let title = event.description ? firstLine(event.description) : event.title;
    if (kind === "task" && event.project && event.description) {
      title = taskTitles.get(event.project)?.get(event.description) ?? event.description;
    }

    // Approved then integrated is one piece of work, not two.
    const key = `${kind}:${event.project ?? ""}:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    done.push({
      id: event.id,
      title,
      kind,
      at: event.timestamp,
      project: event.project ? (nameOf.get(event.project) ?? event.project) : undefined,
    });
  }

  done.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const carry: WrapCarryItem[] = [];
  let total = 0;
  for (const project of projects) {
    for (const task of openNow.get(project.slug) ?? []) {
      total += 1;
      if (carry.length < CARRY_LIMIT) {
        carry.push({ projectSlug: project.slug, projectName: project.name, taskId: task.id, title: task.title });
      }
    }
  }

  return { done, carryOver: carry, carryOverTotal: total };
}

export async function getDayWrap(now: Date = new Date()): Promise<DayWrap> {
  const [activity, projects] = await Promise.all([
    getActivity({ limit: ACTIVITY_WINDOW }).catch(() => ({ events: [] as ActivityEvent[] })),
    getProjects("live").catch(() => [] as ProjectSummary[]),
  ]);

  const taskTitles = new Map<string, Map<string, string>>();
  const openNow = new Map<string, { id?: string; title: string }[]>();

  await Promise.all(
    projects.map(async (project) => {
      try {
        const { tasks } = await readTasks(project.slug);
        taskTitles.set(
          project.slug,
          new Map(tasks.flatMap((task) => (task.id ? [[task.id, task.title] as const] : []))),
        );
        openNow.set(
          project.slug,
          tasks.filter((task) => task.section === "now" && !task.completed).map((task) => ({ id: task.id, title: task.title })),
        );
      } catch {
        // One unreadable workspace costs only its own lines.
      }
    }),
  );

  return buildWrap({ events: activity.events, projects, taskTitles, openNow, now });
}
