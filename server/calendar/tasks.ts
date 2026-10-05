import type { CalendarTaskInput, CalendarTasksResponse } from "../../shared/calendar-types";
import { findProject, getProjects } from "../agentos/projects";
import { createTask, readTasks, updateTask, NotFoundError } from "../agentos/mutations/tasks";
import { recordActivity } from "../activity/ui-events";
import { CalendarError, readGoogleEvent } from "./google-calendar";

export async function readCalendarTasks(): Promise<CalendarTasksResponse> {
  const projects = (await getProjects("all")).filter((project) => project.state !== "archived" && project.state !== "completed");
  const groups = await Promise.all(projects.map(async (project) => {
    const document = await readTasks(project.slug);
    return document.tasks.filter((task) => task.id && task.section !== "archived").map((task) => ({
      projectSlug: project.slug, projectName: project.name, taskId: task.id!, title: task.title,
      completed: task.completed, revision: document.revision, schedule: task.schedule, calendarEventId: task.calendarEventId,
    }));
  }));
  return { projects: projects.map(({ slug, name }) => ({ slug, name })), tasks: groups.flat() };
}

export async function saveCalendarTask(input: CalendarTaskInput) {
  if (!(await findProject(input.projectSlug))) throw new NotFoundError("Choose an existing workspace.");
  const current = input.taskId ? (await readTasks(input.projectSlug)).tasks.find((task) => task.id === input.taskId) : undefined;
  if (input.taskId && !current) throw new NotFoundError("This task no longer exists.");
  // The opt-in is enforced on the server, not just hidden in the form. Existing
  // linked tasks remain editable if the event is later removed or untagged.
  if (input.calendarEventId && input.calendarEventId !== current?.calendarEventId) {
    const event = await readGoogleEvent(input.calendarEventId);
    if (!event.allowTasks) throw new CalendarError("Enable Allow tasks on this event before linking a task.", 409);
  }
  const result = input.taskId
    ? await updateTask({ slug: input.projectSlug, taskId: input.taskId, title: input.title, completed: input.completed, schedule: input.schedule, calendarEventId: input.calendarEventId, expectedRevision: input.expectedRevision })
    : await createTask({ slug: input.projectSlug, title: input.title, section: "next", schedule: input.schedule ?? undefined, calendarEventId: input.calendarEventId ?? undefined });
  await recordActivity({ type: input.taskId ? input.completed ? "task.completed" : "task.updated" : "task.created", description: `${result.taskId}: ${input.title}`, project: input.projectSlug, metadata: { taskId: result.taskId } });
  return result;
}

/** Suggestions are only the operator's own preparation lines, never invented work. */
export function preparationSuggestions(preparation: string): string[] {
  return [...new Set(preparation.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean))].slice(0, 20);
}
