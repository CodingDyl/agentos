import type {
  CareerRoutine,
  CareerTaskMeta,
  RoutineStatus,
  TimesheetRow,
  TimesheetTotals,
  WorkLogEntry,
  WorkLogWeek,
} from "./career-types";
import { addDays, weekStart } from "./traction-dates";

/**
 * Career's calendar and arithmetic, shared by the server and the screen so
 * the two never disagree about what "due" or "unmapped" means. No model, no
 * I/O: the same inputs always give the same answer.
 *
 * Dates are `YYYY-MM-DD` in the operator's local time.
 */

/** A routine done up to this many days before its day still counts for that week. */
export const ROUTINE_EARLY_DAYS = 3;

/**
 * How long a missed routine stays due after its day. A timesheet is owed
 * until it is done; last Tuesday's soccer event is pointless by Wednesday.
 */
export const ROUTINE_GRACE_DAYS: Record<CareerRoutine["id"], number> = { timesheet: 6, soccer: 0 };

export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

/** The most recent `weekday` on or before `today`. */
export function lastOccurrence(weekday: number, today: string): string {
  return addDays(today, -((weekdayOf(today) - weekday + 7) % 7));
}

/** The next `weekday` on or after `today`. */
export function nextOccurrence(weekday: number, today: string): string {
  return addDays(today, (weekday - weekdayOf(today) + 7) % 7);
}

/**
 * Whether a weekly routine is due.
 *
 * Its cycle starts on its weekday. Done in the window just before that day
 * (a timesheet filled in on Thursday for Friday) counts; once its day has
 * passed undone it stays due — overdue — for its grace window.
 */
export function routineStatus(routine: CareerRoutine, today: string): RoutineStatus {
  const occurrence = lastOccurrence(routine.weekday, today);
  const doneThisCycle =
    routine.lastCompletedOn !== undefined && routine.lastCompletedOn >= addDays(occurrence, -ROUTINE_EARLY_DAYS);
  const upcoming = nextOccurrence(routine.weekday, addDays(today, 1));
  // Done early for the coming occurrence: the next one is already covered.
  const doneEarly = routine.lastCompletedOn !== undefined && routine.lastCompletedOn >= addDays(upcoming, -ROUTINE_EARLY_DAYS);

  if (doneEarly) return { ...routine, dueOn: nextOccurrence(routine.weekday, addDays(upcoming, 1)), due: false, doneThisCycle: true };
  if (!doneThisCycle && today > addDays(occurrence, ROUTINE_GRACE_DAYS[routine.id])) {
    return { ...routine, dueOn: upcoming, due: false, doneThisCycle: false };
  }
  return {
    ...routine,
    dueOn: doneThisCycle ? upcoming : occurrence,
    due: routine.enabled && !doneThisCycle,
    doneThisCycle,
  };
}

/** ISO-8601 week number. */
export function isoWeek(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** The work log, a week at a time, newest first: the raw material for summaries and reviews. */
export function groupWorkLogByWeek(entries: readonly WorkLogEntry[]): WorkLogWeek[] {
  const weeks = new Map<string, WorkLogEntry[]>();
  for (const entry of entries) {
    const start = weekStart(entry.date);
    weeks.set(start, [...(weeks.get(start) ?? []), entry]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([start, list]) => {
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      return {
        weekStart: start,
        days: new Set(sorted.map((entry) => entry.date)).size,
        clients: [...new Set(sorted.flatMap((entry) => (entry.client ? [entry.client] : [])))],
        workedOn: sorted.flatMap((entry) => entry.workedOn),
        learned: sorted.flatMap((entry) => entry.learned),
        blockedBy: sorted.flatMap((entry) => entry.blockedBy),
      };
    });
}

export function rowMinutes(row: Pick<TimesheetRow, "hours" | "minutes">): number {
  return row.hours * 60 + row.minutes;
}

/**
 * Recorded is what Toggl measured; mapped and unmapped split it by whether a
 * row can go on the timesheet as it is; submitted is the rounded total of the
 * mapped rows — what Entelect will actually see.
 */
export function timesheetTotals(rows: readonly TimesheetRow[]): TimesheetTotals {
  let recorded = 0;
  let mapped = 0;
  let submitted = 0;
  for (const row of rows) {
    recorded += row.recordedSeconds;
    if (row.mapped) {
      mapped += row.recordedSeconds;
      submitted += rowMinutes(row);
    }
  }
  const recordedMinutes = Math.round(recorded / 60);
  const mappedMinutes = Math.round(mapped / 60);
  return { recordedMinutes, mappedMinutes, unmappedMinutes: recordedMinutes - mappedMinutes, submittedMinutes: submitted };
}

/** Weekdays in the range, up to today, with nothing recorded at all. */
export function missingWorkdays(rows: readonly Pick<TimesheetRow, "date">[], from: string, to: string, today: string): string[] {
  const recorded = new Set(rows.map((row) => row.date));
  const missing: string[] = [];
  for (let day = from; day <= to && day <= today; day = addDays(day, 1)) {
    const weekday = weekdayOf(day);
    if (weekday !== 0 && weekday !== 6 && !recorded.has(day)) missing.push(day);
  }
  return missing;
}

/** `39h 30m`. */
export function formatMinutes(total: number): string {
  const sign = total < 0 ? "-" : "";
  const value = Math.abs(total);
  return `${sign}${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

/** The week to extract by default: last week until Friday, then this one. */
export function defaultTimesheetWeek(today: string): string {
  const weekday = weekdayOf(today);
  const thisWeek = weekStart(today);
  return weekday >= 5 || weekday === 0 ? thisWeek : addDays(thisWeek, -7);
}

/** Open career tasks due today or earlier. */
export function dueTaskIds(meta: readonly CareerTaskMeta[], openTaskIds: ReadonlySet<string>, today: string): string[] {
  return meta
    .filter((item) => item.dueDate !== undefined && item.dueDate <= today && openTaskIds.has(item.taskId))
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .map((item) => item.taskId);
}
