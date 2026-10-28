import fs from "node:fs";
import path from "node:path";
import { uiStateDir } from "../agentos/session-store";
import { PlacesError } from "./client";

/**
 * The month's Google Places requests, and the ceiling on them.
 *
 * Places bills per request, so the ceiling is a hard stop rather than a
 * warning: with no cap set, searches are refused. Requests are counted
 * before the call, and a call that fails still counts, because Google may have
 * billed it. The file is disposable (delete it and the count restarts), and
 * the read-modify-write is synchronous, so two searches in one server cannot
 * both read the same count.
 *
 * The month is the UTC calendar month. Google's billing month may differ by a
 * few hours at the edges; the cap is a guard, not an invoice.
 */

const CAP_ENV = "AGENTOS_PLACES_MONTHLY_REQUEST_CAP";
const MAX_CAP = 5000;

export interface PlacesBudget {
  /** 0 means no cap is set, and searches are refused. */
  cap: number;
  used: number;
  remaining: number;
  month: string;
}

function usageFile(): string {
  return path.join(uiStateDir(), "places-usage.json");
}

function monthOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** The cap from `.env`: a whole number from 1 to 5000, otherwise 0 (unset). */
export function monthlyCap(): number {
  const parsed = Number.parseInt(process.env[CAP_ENV]?.trim() ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_CAP) : 0;
}

function readUsed(month: string): number {
  try {
    const stored = JSON.parse(fs.readFileSync(usageFile(), "utf8")) as { month?: unknown; used?: unknown };
    return stored.month === month && typeof stored.used === "number" && stored.used >= 0 ? Math.floor(stored.used) : 0;
  } catch {
    return 0;
  }
}

function writeUsed(month: string, used: number): void {
  const file = usageFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ month, used }), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function placesBudget(now: Date = new Date()): PlacesBudget {
  const month = monthOf(now);
  const cap = monthlyCap();
  const used = readUsed(month);
  return { cap, used, remaining: Math.max(0, cap - used), month };
}

/** Counts `requests` against this month, or throws and counts nothing. */
export function reserveRequests(requests: number, now: Date = new Date()): PlacesBudget {
  const budget = placesBudget(now);
  if (budget.cap === 0) {
    throw new PlacesError(`Set ${CAP_ENV} to the most Places requests you will pay for in a month. Searches are refused until it is set.`, "no-cap");
  }
  if (requests > budget.remaining) {
    throw new PlacesError(
      `This needs ${requests} Places requests and ${budget.remaining} of this month's ${budget.cap} are left. Raise ${CAP_ENV} if you want more.`,
      "quota",
    );
  }
  writeUsed(budget.month, budget.used + requests);
  return { ...budget, used: budget.used + requests, remaining: budget.remaining - requests };
}
