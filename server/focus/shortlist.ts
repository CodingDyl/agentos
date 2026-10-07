import { createHash } from "node:crypto";
import type { Compass } from "../../shared/compass-types";
import { SHORTLIST_SIZE, type Candidate } from "../../shared/focus-types";
import { listDirectory, readOptionalFile } from "../agentos/filesystem";
import { readTasks } from "../agentos/mutations/tasks";
import { getProjects } from "../agentos/projects";
import { readCompass } from "../compass/compass";
import { computeOutreachStats } from "../outreach/stats";
import { readState } from "../traction/store";
import { readDoneLedger } from "./done-ledger";

/**
 * The shortlist: up to eight things worth doing today, ranked by plain rules.
 * No model is involved, so it is the same every time for the same data, and
 * it is there even when Hermes is not.
 *
 * Sources, strongest first:
 * - This week's outcomes from the Compass
 * - Outreach follow-ups that are due
 * - Personal and life-area tasks (areas/<area>/TASKS.md)
 * - Workspace tasks in Now, from active projects
 *
 * Anything already ticked off on Today is left out (see done-ledger.ts), so
 * a finished item never comes back the next morning.
 *
 * Lifted by: serving a goal whose area is slipping or neglected, a
 * high-priority workspace. Projects the Compass marks paused or done are left
 * out. At most two tasks per workspace, so one busy project cannot fill it.
 */

export interface ShortlistInputs {
  compass?: Compass;
  workspaces: { slug: string; name: string; priority: string; tasks: { id?: string; title: string; scheduled?: boolean }[] }[];
  areaTasks: { area: string; title: string }[];
  followUps: { prospectId: string; company: string; touch: number }[];
}

/** A quick job starts with a quick verb: "Email Justin…", "Renew licence". "Unable to connect email" does not. */
const SMALL = /^(email|e-mail|call|phone|book|renew|pay|send|reply|message|ask|buy|order|cancel|sign|submit|schedule|check|confirm|follow up)\b/i;
const hash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 10);
const lower = (text: string) => text.trim().toLowerCase();

export function buildShortlist(inputs: ShortlistInputs, done: ReadonlySet<string> = new Set()): Candidate[] {
  const compass = inputs.compass;
  const struggling = new Set(
    (compass?.areas ?? []).filter((area) => area.status === "slipping" || area.status === "neglected").map((area) => lower(area.name)),
  );
  const goalArea = new Map((compass?.goals ?? []).map((goal) => [goal.id, lower(goal.area)]));
  const projectByName = new Map((compass?.projects ?? []).map((project) => [lower(project.name), project]));
  const candidates: Candidate[] = [];

  (compass?.thisWeek ?? []).forEach((outcome, index) => {
    candidates.push({
      id: `week:${hash(outcome)}`,
      title: outcome,
      kind: "week",
      source: "This week",
      reason: "One of this week's outcomes",
      small: false,
      href: "/compass",
      score: 100 - index,
    });
  });

  for (const due of inputs.followUps) {
    candidates.push({
      // Which email it is, so ticking the first follow-up leaves the last one to come.
      id: `follow_up:${due.prospectId}:${due.touch}`,
      title: `Follow up with ${due.company}`,
      kind: "follow_up",
      source: "Outreach",
      reason: due.touch === 2 ? "First follow-up is due" : "Last follow-up is due",
      small: true,
      href: `/traction?tab=outreach&prospect=${encodeURIComponent(due.prospectId)}`,
      score: 72,
    });
  }

  for (const task of inputs.areaTasks) {
    const behind = struggling.has(lower(task.area)) || (lower(task.area) === "finances" && struggling.has("money"));
    candidates.push({
      id: `area_task:${task.area}:${hash(task.title)}`,
      title: task.title,
      kind: "area_task",
      source: task.area.charAt(0).toUpperCase() + task.area.slice(1),
      reason: behind ? `${task.area} is slipping` : "Personal admin waiting",
      small: SMALL.test(task.title),
      score: 45 + (behind ? 25 : 0),
    });
  }

  for (const workspace of inputs.workspaces) {
    const linked = projectByName.get(lower(workspace.name));
    if (linked && (linked.status === "paused" || linked.status === "done")) continue;
    const goalId = linked?.serves[0];
    const behindGoal = linked?.serves.find((id) => struggling.has(goalArea.get(id) ?? ""));
    const lift = (behindGoal ? 25 : 0) + (workspace.priority === "high" ? 15 : workspace.priority === "medium" ? 5 : 0);

    workspace.tasks.slice(0, 2).forEach((task, index) => {
      candidates.push({
        id: `task:${workspace.slug}:${task.id ?? hash(task.title)}`,
        title: task.title,
        kind: "task",
        source: workspace.name,
        reason: task.scheduled ? "Scheduled for today" : behindGoal
          ? `Serves ${behindGoal}, in an area that is slipping`
          : goalId
            ? `Next in Now, serves ${goalId}`
            : workspace.priority === "high"
              ? "Next in Now, high-priority workspace"
              : "Next in Now",
        goalId: behindGoal ?? goalId,
        small: SMALL.test(task.title),
        href: `/workspaces/${encodeURIComponent(workspace.slug)}`,
        score: task.scheduled ? 95 - index : 40 + lift - index * 3,
      });
    });
  }

  return candidates
    .filter((candidate) => !done.has(candidate.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE);
}

/** Open tasks in areas/<area>/TASKS.md: every unchecked box. */
export function readAreaTasks(area: string, markdown: string | undefined): { area: string; title: string }[] {
  return (markdown ?? "")
    .split("\n")
    .map((line) => /^\s*[-*+]\s+\[ \]\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((title): title is string => Boolean(title))
    .map((title) => ({ area, title }));
}

export async function gatherInputs(): Promise<ShortlistInputs> {
  const [compassRead, projects, areaNames, traction] = await Promise.all([
    readCompass().catch(() => undefined),
    getProjects("live").catch(() => []),
    listDirectory("areas").catch(() => [] as string[]),
    readState().catch(() => undefined),
  ]);

  const workspaces = await Promise.all(
    projects
      .filter((project) => project.state === "active" || project.state === "blocked" || project.state === "incubating")
      .map(async (project) => {
        try {
          const { tasks } = await readTasks(project.slug);
          return {
            slug: project.slug,
            name: project.name,
            priority: String(project.priority ?? "").toLowerCase(),
            tasks: tasks.filter((task) => !task.completed && task.section !== "archived" && (task.schedule ? task.schedule.date === new Date().toLocaleDateString("en-CA") : task.section === "now"))
              .sort((a, b) => Number(Boolean(b.schedule)) - Number(Boolean(a.schedule)))
              .map((task) => ({ id: task.id, title: task.title, scheduled: Boolean(task.schedule) })),
          };
        } catch {
          return { slug: project.slug, name: project.name, priority: "", tasks: [] };
        }
      }),
  );

  const areaTasks = (
    await Promise.all(
      areaNames
        .filter((name) => /^[a-z0-9-]{1,40}$/.test(name))
        .map(async (area) => readAreaTasks(area, await readOptionalFile(`areas/${area}/TASKS.md`))),
    )
  ).flat();

  const followUps = traction ? computeOutreachStats(traction).followUpsDue : [];

  return { compass: compassRead?.exists ? compassRead.compass : undefined, workspaces, areaTasks, followUps };
}

export async function shortlist(): Promise<Candidate[]> {
  const [inputs, ledger] = await Promise.all([gatherInputs(), readDoneLedger()]);
  return buildShortlist(inputs, new Set(Object.keys(ledger)));
}
