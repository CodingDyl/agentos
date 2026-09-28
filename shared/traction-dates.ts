import type { WaitingOn } from "./traction-types";

/**
 * Traction's calendar rules, shared by the engine and the screen so the two
 * can never disagree about what "overdue" or "5 days" means.
 *
 * Dates are `YYYY-MM-DD` in the operator's local time. Timestamps are reduced
 * to their local date before any counting.
 */

/** Days a Waiting On item with no chase date sits before it is chased. */
export const WAITING_CHASE_AFTER_DAYS = 5;
/** After a chase, when to chase again if nothing lands. */
export const WAITING_RECHASE_DAYS = 3;

/** A local calendar date. The operator's "today", not UTC's. */
export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return isoDate(new Date(year, month - 1, day + days));
}

/** Whole calendar days from `from` to `to`. Timestamps are reduced to their local date first. */
export function daysBetween(from: string, to: string): number {
  const toDay = (value: string) => {
    const iso = value.length === 10 ? value : isoDate(new Date(value));
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };

  return Math.round((toDay(to) - toDay(from)) / 86_400_000);
}

/** Monday of the week containing `today`. */
export function weekStart(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  // getDay: Sunday is 0. A week here starts on Monday.
  return addDays(today, -((weekday + 6) % 7));
}

/** When a Waiting On item should next be chased. */
export function chaseDate(item: WaitingOn): string {
  return item.nextFollowUp ?? addDays(item.since, WAITING_CHASE_AFTER_DAYS);
}
