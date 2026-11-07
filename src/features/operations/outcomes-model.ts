/**
 * How the scorecard writes its numbers. Absent is not zero: an unknown figure is
 * an em dash, never R0 or 0 hours.
 */

export const DASH = "—";

/** Rand from integer minor units: R12,345 (cents shown only when there are some). */
export function formatRandMinor(minor: number | null | undefined): string {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return DASH;
  const rand = minor / 100;
  const whole = Number.isInteger(rand);
  return `R${new Intl.NumberFormat("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(rand)}`;
}

/** US dollars, kept apart from rand: there is no exchange rate to convert with. */
export function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return DASH;
  return `$${value.toFixed(value < 10 ? 2 : 0)}`;
}

/** 45 → "45m", 60 → "1h", 90 → "1h 30m". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** 0.9795 → "98%". Null stays a dash. */
export function formatRate(rate: number | null): string {
  return rate === null ? DASH : `${Math.round(rate * 100)}%`;
}

/** "2026-11" → "November 2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
