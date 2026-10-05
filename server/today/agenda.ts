import type { CalendarTask } from "../../shared/calendar-types";
import type { CalendarEvent, TodayCalendar } from "../../shared/today-types";

/**
 * Today's calendar as plain text, for Hermes' morning brief.
 *
 * Hermes' own Google access has been unreliable, so its brief job reads the
 * calendar from AgentOS instead: a pre-run script fetches this and Hermes
 * places it in the prompt. Always non-empty (Hermes skips the whole brief on
 * empty script output), and when the calendar can't be read it says so, so
 * the brief plans without it instead of failing.
 */

function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function eventLine(event: CalendarEvent): string {
  const when = event.allDay ? "All day" : event.end ? `${clock(event.start)} to ${clock(event.end)}` : clock(event.start);
  const extras = [event.location, event.meetingUrl ? "video call" : undefined].filter(Boolean).join(", ");
  return `- ${when}: ${event.title}${extras ? ` (${extras})` : ""}`;
}

export function formatAgenda(calendar: TodayCalendar, now: Date = new Date(), tasks: CalendarTask[] = []): string {
  const day = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const header = `Calendar for ${day} (from AgentOS, Google Calendar, read-only)`;

  const today = now.toLocaleDateString("en-CA");
  const scheduled = tasks.filter((task) => !task.completed && task.schedule?.date === today);
  const taskLines = scheduled.length ? ["", "Tasks scheduled for today (existing AgentOS tasks, do not recreate):", ...scheduled.map((task) => `- ${task.schedule?.time ?? "Any time"}: [${task.taskId}] ${task.title} (${task.projectName})`)] : [];
  if (calendar.status !== "ready") {
    return `${header}\nThe calendar is unavailable today: ${calendar.detail ?? calendar.status}. Plan the day without calendar context and say so briefly.${taskLines.join("\n")}`;
  }

  const lines = [header];
  if (calendar.today.length === 0) {
    lines.push("No events today. Use the scheduled tasks to plan focused work.");
  } else {
    lines.push(...calendar.today.map(eventLine));
    const timed = calendar.today.filter((event) => !event.allDay).length;
    lines.push(`${timed} timed ${timed === 1 ? "event" : "events"} today.`);
  }
  if (calendar.tomorrowFirst) lines.push(`Tomorrow starts with: ${eventLine(calendar.tomorrowFirst).slice(2)}`);
  return [...lines, ...taskLines].join("\n");
}
