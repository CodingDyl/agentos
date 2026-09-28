import type { ActivityEvent, ActivitySource } from "@shared/agentos-types";

/**
 * The Activity screen's view model.
 *
 * The adapter decides what happened; this decides how it reads — how a moment
 * is named, which colour a source earns, and where an event lets you go next.
 * The timeline is navigation as much as history, so every event that can point
 * back into AgentOS does.
 */

/**
 * How loudly an event reads.
 *
 * Colour is carried by one small dot, so the palette stays deliberately short
 * (DESIGN.md §3): amber only for work still in flight, red and green only for
 * genuine failure and success, and everything else quiet.
 */
export type ActivityTone = "quiet" | "active" | "success" | "warning" | "danger";

export function toneFor(event: ActivityEvent): ActivityTone {
  // Something still running is the only thing that earns amber.
  if (event.type.endsWith(".running") || event.type.endsWith(".started")) {
    return "active";
  }

  switch (event.level) {
    case "error":
      return "danger";
    case "warning":
      return "warning";
    case "success":
      return "success";
    default:
      return "quiet";
  }
}

const SOURCE_LABELS: Record<ActivitySource, string> = {
  user: "User",
  hermes: "Hermes",
  automation: "Automation",
  agentos: "AgentOS",
  worker: "Worker",
  grok: "Grok",
};

export function sourceLabel(source: ActivitySource): string {
  return SOURCE_LABELS[source];
}

/** The filters the screen offers. `grok` appears once it has something to show. */
export const SOURCE_FILTERS: readonly ActivitySource[] = [
  "user",
  "hermes",
  "automation",
  "agentos",
  "worker",
];

/** One place an event can take you. */
export interface ActivityLink {
  label: string;
  to: string;
}

/**
 * Where this event leads.
 *
 * Only links that actually resolve are offered: there is no run screen, so a
 * run id opens the console it belongs to rather than a page that does not
 * exist.
 */
export function linksFor(event: ActivityEvent): ActivityLink[] {
  const links: ActivityLink[] = [];

  if (event.project) {
    links.push({ label: "Open workspace", to: `/workspaces/${event.project}` });
  }

  const automation = event.metadata?.automation;
  if (typeof automation === "string") {
    links.push({ label: "View automation", to: `/automations/${automation}` });
  }

  if (event.sessionId || event.runId) {
    links.push({
      label: "Open agent console",
      to: event.project
        ? `/agent?project=${encodeURIComponent(event.project)}`
        : "/agent",
    });
  }

  return links;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** `20:16`, in the reader's own timezone. */
export function formatTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** `Today`, `Yesterday`, or a date. The heading a day's events sit under. */
export function formatDay(isoTimestamp: string, now: Date = new Date()): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "Undated";

  const days = Math.round(
    (startOfDay(date) - startOfDay(now)) / MILLISECONDS_PER_DAY,
  );

  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

export interface ActivityDay {
  /** Stable key: the calendar date, not the label. */
  key: string;
  label: string;
  events: ActivityEvent[];
}

/**
 * Groups the timeline into days, preserving the order it arrived in.
 *
 * The adapter has already sorted newest-first; grouping must not re-sort, or a
 * disagreement between the two would silently reorder the audit trail.
 */
export function groupByDay(
  events: ActivityEvent[],
  now: Date = new Date(),
): ActivityDay[] {
  const days: ActivityDay[] = [];

  for (const event of events) {
    const date = new Date(event.timestamp);
    const key = Number.isNaN(date.getTime())
      ? "undated"
      : new Date(startOfDay(date)).toISOString().slice(0, 10);

    const current = days.at(-1);

    if (current?.key === key) current.events.push(event);
    else days.push({ key, label: formatDay(event.timestamp, now), events: [event] });
  }

  return days;
}

/** The detail rows the expanded event shows. Never raw JSON. */
export interface ActivityDetail {
  label: string;
  value: string;
}

export function detailsFor(
  event: ActivityEvent,
  now: Date = new Date(),
): ActivityDetail[] {
  const details: ActivityDetail[] = [
    { label: "Time", value: `${formatDay(event.timestamp, now)} · ${formatTime(event.timestamp)}` },
    { label: "Source", value: sourceLabel(event.source) },
  ];

  if (event.project) details.push({ label: "Project", value: event.project });
  if (event.runId) details.push({ label: "Run", value: event.runId });
  if (event.sessionId) details.push({ label: "Session", value: event.sessionId });

  // Metadata is named and formatted, never dumped: a reader should not have to
  // parse a payload to learn what an event meant.
  for (const [key, value] of Object.entries(event.metadata ?? {})) {
    if (typeof value === "string" || typeof value === "number") {
      details.push({ label: METADATA_LABELS[key] ?? key, value: String(value) });
    }
  }

  return details;
}

const METADATA_LABELS: Record<string, string> = {
  automation: "Automation",
  completed: "Completed",
  stillOpen: "Still open",
  blockers: "Blockers",
  messages: "Messages",
  hash: "Commit",
  date: "Log date",
};
