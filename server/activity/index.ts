import type { ActivityEvent, ActivitySource } from "../../shared/agentos-types";
import { readAgentOSActivity } from "./agentos";
import { readAutomationActivity } from "./automations";
import { readHermesActivity } from "./hermes";
import { readUiEvents } from "./ui-events";

/**
 * The unified activity timeline.
 *
 * This aggregates; it does not record. Every event already exists somewhere —
 * in a vault file, in Hermes' sessions, in Hermes' cron history, in the UI
 * event store — and the job here is to normalise those into one model, order
 * them, and hand back a bounded slice. No model call is involved: the timeline
 * is assembled from state, never from reasoning about it.
 *
 * Each source fails independently. A Hermes that is not configured leaves the
 * rest of the timeline intact, and says so, rather than emptying the screen.
 */

export const DEFAULT_ACTIVITY_LIMIT = 50;
export const MAX_ACTIVITY_LIMIT = 100;

export interface ActivityQuery {
  project?: string;
  source?: ActivitySource;
  limit?: number;
}

export interface ActivityResult {
  events: ActivityEvent[];
  unavailable: ActivitySource[];
}

/** Clamps a requested limit into the range the timeline will serve. */
export function readLimit(value: unknown): number {
  const requested =
    typeof value === "string" ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_ACTIVITY_LIMIT;
  }

  return Math.min(Math.trunc(requested), MAX_ACTIVITY_LIMIT);
}

const SOURCES = new Set<ActivitySource>([
  "user",
  "hermes",
  "automation",
  "agentos",
  "worker",
  "grok",
]);

export function readSource(value: unknown): ActivitySource | undefined {
  return typeof value === "string" && SOURCES.has(value as ActivitySource)
    ? (value as ActivitySource)
    : undefined;
}

/**
 * Newest first, dropping anything that cannot be placed.
 *
 * An event without a readable timestamp has no position on a timeline, and
 * putting it at an arbitrary one would misreport when it happened.
 */
export function sortNewestFirst(events: ActivityEvent[]): ActivityEvent[] {
  return events
    .filter((event) => !Number.isNaN(Date.parse(event.timestamp)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

/**
 * Collapses events that describe the same happening.
 *
 * Ids are deterministic per source, so a repeated read cannot duplicate a row.
 * The second key catches the cross-source case: two readers describing one
 * event at the same instant in the same words are one event, not two.
 */
export function deduplicate(events: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<string>();

  return events.filter((event) => {
    const keys = [
      event.id,
      `${event.source}|${event.type}|${event.timestamp}|${event.title}`,
    ];

    if (keys.some((key) => seen.has(key))) return false;

    for (const key of keys) seen.add(key);
    return true;
  });
}

/** Applies the screen's two filters. Both are exact matches, by design. */
export function applyFilters(
  events: ActivityEvent[],
  query: ActivityQuery,
): ActivityEvent[] {
  return events.filter((event) => {
    if (query.source && event.source !== query.source) return false;
    if (query.project && event.project !== query.project) return false;
    return true;
  });
}

/** One source's contribution, and whether it could be read at all. */
async function collect(
  source: ActivitySource,
  read: () => Promise<ActivityEvent[]>,
): Promise<{ events: ActivityEvent[]; unavailable?: ActivitySource }> {
  try {
    return { events: await read() };
  } catch (error) {
    console.error(`[agentos] activity source "${source}" failed:`, error);
    return { events: [], unavailable: source };
  }
}

/**
 * The timeline.
 *
 * Every source is asked for at least as many events as the caller wants, so
 * the merge cannot lose a recent event to another source's backlog.
 */
export async function getActivity(
  query: ActivityQuery = {},
): Promise<ActivityResult> {
  const limit = query.limit ?? DEFAULT_ACTIVITY_LIMIT;

  const results = await Promise.all([
    collect("agentos", () => readAgentOSActivity()),
    collect("hermes", () => readHermesActivity(limit)),
    collect("automation", () => readAutomationActivity(limit)),
    // The UI store holds both `user` and `hermes` events; it is one file, and
    // a failure to read it is reported against the decisions it records.
    collect("user", () => readUiEvents(limit)),
  ]);

  const merged = deduplicate(
    sortNewestFirst(results.flatMap((result) => result.events)),
  );

  return {
    events: applyFilters(merged, query).slice(0, limit),
    unavailable: results
      .map((result) => result.unavailable)
      .filter((source): source is ActivitySource => source !== undefined),
  };
}
