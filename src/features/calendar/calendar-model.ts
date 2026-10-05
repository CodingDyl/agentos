import type { CalendarEvent } from "@shared/today-types";
import type { CalendarTask } from "@shared/calendar-types";

export function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(date: Date, days: number): Date { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
export function dateFromKey(date: string): Date { return new Date(`${date}T00:00:00`); }
export function calendarDays(anchor: Date, view: "day" | "week" | "month"): Date[] {
  if (view === "day") return [new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())];
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), view === "month" ? 1 : anchor.getDate());
  const monday = addDays(first, -(first.getDay() + 6) % 7);
  return Array.from({ length: view === "week" ? 7 : 42 }, (_, i) => addDays(monday, i));
}
export function eventOnDate(event: CalendarEvent, date: string): boolean {
  if (event.allDay) return event.start <= date && (event.end ? event.end > date : event.start === date);
  const start = dateFromKey(date).getTime();
  const end = addDays(dateFromKey(date), 1).getTime();
  return Date.parse(event.start) < end && Date.parse(event.end ?? event.start) >= start && (Date.parse(event.end ?? event.start) !== start || Date.parse(event.start) === start);
}
export function eventTime(event: CalendarEvent): string {
  return event.allDay ? "All day" : new Date(event.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
export function localDateTime(value: string): string {
  const date = new Date(value);
  return `${calendarDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
export type CalendarEntry = { key: string; title: string; time: string; event?: CalendarEvent; task?: CalendarTask };
export function entriesForDay(events: CalendarEvent[], tasks: CalendarTask[], date: string): CalendarEntry[] {
  return [
    ...events.filter((event) => eventOnDate(event, date)).map((event) => ({ key: `event:${event.id}`, title: event.title, time: eventTime(event), event })),
    ...tasks.filter((task) => task.schedule?.date === date).map((task) => ({ key: `task:${task.projectSlug}:${task.taskId}`, title: task.title, time: task.schedule?.time ?? "Any time", task })),
  ].sort((a, b) => a.time.localeCompare(b.time));
}
export function entryMinutes(entry: CalendarEntry, date: string): { start: number; end: number } {
  if (entry.task?.schedule?.time) {
    const [h, m] = entry.task.schedule.time.split(":").map(Number);
    const start = h * 60 + m;
    return { start, end: Math.min(1440, start + entry.task.schedule.durationMinutes) };
  }
  const event = entry.event!;
  const startDate = new Date(event.start);
  const endDate = new Date(event.end ?? new Date(startDate.getTime() + 3600000).toISOString());
  const start = calendarDate(startDate) < date ? 0 : startDate.getHours() * 60 + startDate.getMinutes();
  const end = calendarDate(endDate) > date ? 1440 : endDate.getHours() * 60 + endDate.getMinutes();
  return { start, end: Math.max(start + 15, end) };
}
/** Overlapping appointments get separate lanes within each connected group. */
export function layoutEntries(entries: CalendarEntry[], date: string) {
  const timed = entries.filter((entry) => entry.event ? !entry.event.allDay : Boolean(entry.task?.schedule?.time)).map((entry) => ({ entry, ...entryMinutes(entry, date), lane: 0, lanes: 1 })).sort((a, b) => a.start - b.start);
  let group: typeof timed = [];
  let ends: number[] = [];
  const finish = () => { group.forEach((item) => { item.lanes = ends.length; }); group = []; ends = []; };
  for (const item of timed) {
    if (ends.length && ends.every((end) => end <= item.start)) finish();
    let lane = ends.findIndex((end) => end <= item.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.end;
    item.lane = lane;
    group.push(item);
  }
  finish();
  return timed;
}
