import { dueTaskIds, groupWorkLogByWeek, nextOccurrence, routineStatus } from "../../shared/career-logic";
import { CAREER_SLUG, type CareerData, type CareerResource, type CareerTodayItem } from "../../shared/career-types";
import { isoDate } from "../../shared/traction-dates";
import { readTasks } from "../agentos/mutations/tasks";
import { decide } from "../connectors/policy";
import { LINKEDIN_MESSAGES_URL, LINKEDIN_PROFILE_URL, linkedInReadiness } from "./linkedin";
import { readCareer, type CareerState } from "./store";
import { timesheetReadiness } from "./timesheet";

/**
 * Career, assembled for the page and for Today. Everything here is derived
 * from the store, the career workspace's TASKS.md and the connector policy.
 */

/**
 * The links Career shows. Each is a capability, so it appears in that
 * connector's history and can be switched off there like any other.
 */
export const CAREER_RESOURCES: readonly Omit<CareerResource, "available">[] = [
  { id: "entelect-timesheet", label: "Entelect Timesheet", url: "https://employee.entelect.co.za/Timesheet", capabilityId: "entelect.timesheet.open" },
  { id: "toggl", label: "Toggl Track", url: "https://track.toggl.com/timer", capabilityId: "toggl.open" },
  { id: "entelect-events", label: "Entelect Events", url: "https://events.entelect.co.za/", capabilityId: "entelect.events.open" },
  {
    id: "timesheet-script",
    label: "Timesheet script (Colab, legacy)",
    url: "https://colab.research.google.com/drive/1PpKLTZi1-QBTWQoW_tQoUUY2Ow5MIwIG",
    capabilityId: "career.timesheet.transform",
  },
];

export function findResource(id: string) {
  return CAREER_RESOURCES.find((resource) => resource.id === id);
}

async function openCareerTasks(): Promise<{ id: string; title: string }[]> {
  try {
    const { tasks } = await readTasks(CAREER_SLUG);
    return tasks.flatMap((task) => (task.id && !task.completed && task.section !== "archived" ? [{ id: task.id, title: task.title }] : []));
  } catch {
    return [];
  }
}

export function todayItems(state: CareerState, openTasks: readonly { id: string; title: string }[], today: string): CareerTodayItem[] {
  const routines: CareerTodayItem[] = state.routines
    .map((routine) => routineStatus(routine, today))
    .filter((routine) => routine.due)
    .map((routine) => ({
      id: `routine:${routine.id}`,
      kind: "routine",
      title: routine.id === "timesheet" ? "Submit timesheet" : routine.id === "soccer" ? "Create this week's soccer event" : routine.name,
      detail: routine.dueOn < today ? `overdue since ${routine.dueOn}` : "today",
      href: `/career?tab=routines#${routine.id}`,
    }));

  const titles = new Map(openTasks.map((task) => [task.id, task.title]));
  const tasks: CareerTodayItem[] = dueTaskIds(state.taskMeta, new Set(titles.keys()), today).map((taskId) => {
    const meta = state.taskMeta.find((item) => item.taskId === taskId);
    return {
      id: `task:${taskId}`,
      kind: "task",
      title: titles.get(taskId) ?? taskId,
      detail: [meta?.client, meta?.dueDate && meta.dueDate < today ? `due ${meta.dueDate}` : "due today"].filter(Boolean).join(" · "),
      href: "/career?tab=tasks",
    };
  });

  return [...routines, ...tasks];
}

export async function getCareer(now: Date = new Date()): Promise<CareerData> {
  const state = await readCareer();
  const today = isoDate(now);
  const openTasks = await openCareerTasks();
  const readiness = timesheetReadiness();
  const linkedin = linkedInReadiness();
  const submitted = state.timesheetRuns.filter((run) => run.status === "submitted");

  return {
    today,
    currentWork: state.currentWork,
    taskMeta: state.taskMeta,
    workLog: [...state.workLog].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    weeks: groupWorkLogByWeek(state.workLog).slice(0, 12),
    growth: state.growth,
    routines: state.routines.map((routine) => routineStatus(routine, today)),
    timesheet: {
      latest: state.timesheetRuns[0],
      lastSubmittedAt: submitted.map((run) => run.submittedAt ?? "").sort().at(-1) || undefined,
      ready: readiness.ready,
      readyDetail: readiness.detail,
    },
    soccer: {
      defaults: state.soccer.defaults,
      events: state.soccer.events,
      nextDate: nextOccurrence(state.soccer.defaults.weekday, today),
    },
    linkedin: {
      posts: [...state.linkedinPosts].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)),
      canPublish: linkedin.canPublish,
      publishDetail: linkedin.detail,
      profileUrl: LINKEDIN_PROFILE_URL,
      messagesUrl: LINKEDIN_MESSAGES_URL,
    },
    resources: CAREER_RESOURCES.map((resource) => ({ ...resource, available: decide(resource.capabilityId, "person").allowed })),
    todayItems: todayItems(state, openTasks, today),
  };
}

/** Career's part of the morning brief, as plain text Hermes can place in its prompt. */
export async function careerAgenda(now: Date = new Date()): Promise<string> {
  const data = await getCareer(now);
  const lines = [`Career for ${data.today} (from AgentOS)`];
  if (data.todayItems.length === 0) lines.push("No career admin due today.");
  else lines.push(...data.todayItems.map((item) => `- ${item.title}${item.detail ? ` (${item.detail})` : ""}`));
  if (data.currentWork.project) lines.push(`Currently working on: ${data.currentWork.project}${data.currentWork.objective ? ` — ${data.currentWork.objective}` : ""}`);
  return lines.join("\n");
}
