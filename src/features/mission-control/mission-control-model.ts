import type {
  AttentionItem,
  AttentionSeverity,
  MissionSources,
  SystemStatus,
} from "@shared/mission-control-types";
import type { AgentStatus } from "@/components/os";

/**
 * Mission Control's view model.
 *
 * The screen's job is to be readable in ten seconds, and everything here serves
 * that: one vocabulary for status, one place that decides what counts as loud,
 * and formatting that says what a person would say.
 */

/**
 * The one place the health vocabulary meets the design system's.
 *
 * `SystemStatus` is what subsystems report; `AgentStatus` is what pills are
 * drawn with. Translating in a single function is the whole point — before
 * this, cron said `healthy`, workers said `available` and Hermes said
 * `configured` for what an operator reads as the same fact, and each screen
 * mapped it to a colour its own way.
 */
const PILL_BY_STATUS: Record<SystemStatus, AgentStatus> = {
  ready: "healthy",
  running: "running",
  waiting: "attention",
  attention: "attention",
  failed: "blocked",
  // Never green. A check that could not be run has not passed.
  unknown: "paused",
  offline: "blocked",
};

const LABEL_BY_STATUS: Record<SystemStatus, string> = {
  ready: "Ready",
  running: "Running",
  waiting: "Waiting",
  attention: "Attention",
  failed: "Failed",
  unknown: "Unknown",
  offline: "Offline",
};

export function statusPill(status: SystemStatus): AgentStatus {
  return PILL_BY_STATUS[status];
}

export function statusLabel(status: SystemStatus): string {
  return LABEL_BY_STATUS[status];
}

/**
 * Whether this status should draw the eye.
 *
 * Deliberately narrow. Amber is a budget: if `ready` and `running` both spent
 * it, the screen would be permanently lit and the one row that mattered would
 * be invisible. Only states asking for something get to be loud.
 */
export function isLoud(status: SystemStatus): boolean {
  return status === "attention" || status === "failed" || status === "offline";
}

/** Severity, in the tone it should read in. Word first; colour reinforces. */
const SEVERITY_TONE: Record<AttentionSeverity, string> = {
  critical: "text-os-danger",
  warning: "text-os-warning",
  info: "text-os-subtle",
};

const SEVERITY_RULE: Record<AttentionSeverity, string> = {
  critical: "bg-os-danger",
  warning: "bg-os-warning",
  info: "bg-os-border-strong",
};

export function severityTone(severity: AttentionSeverity): string {
  return SEVERITY_TONE[severity];
}

export function severityRule(severity: AttentionSeverity): string {
  return SEVERITY_RULE[severity];
}

/** What an attention item is called, in the operator's words. */
const ATTENTION_LABEL: Record<string, string> = {
  approval: "Approval",
  review: "Review",
  changes_required: "Changes required",
  blocked: "Blocked",
  failed: "Failed",
  automation: "Automation",
  system: "System",
};

export function attentionLabel(type: string): string {
  return ATTENTION_LABEL[type] ?? type.replace(/_/g, " ");
}

/**
 * How long something has been going.
 *
 * Counted from a start rather than stored, so it stays true between polls: a
 * screen that says "running 06m 32s" and means it has to keep counting, and
 * one that freezes is worse than one that never claimed to be live.
 */
export function elapsed(startedAt: string, now: Date = new Date()): string {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return "";

  const seconds = Math.max(0, Math.round((now.getTime() - start) / 1000));

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${String(minutes).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s`;
  }

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Time-of-day greeting. Local only — never a model request. */
export function greeting(operator: string, now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return `Good morning, ${operator}`;
  if (hour < 18) return `Good afternoon, ${operator}`;
  return `Good evening, ${operator}`;
}

/** The header's date line, e.g. `Thursday 10 September`. */
export function formatToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

/**
 * The sources that did not answer.
 *
 * Named so the screen can say which part of itself to distrust. A section that
 * is empty because its source is down looks exactly like a section that is
 * empty because there is nothing to show, and only one of those is good news.
 */
export function degradedSources(sources: MissionSources): string[] {
  const names: Record<keyof MissionSources, string> = {
    vault: "Projects",
    workers: "Workers",
    automations: "Automations",
    activity: "Activity",
    hermes: "Hermes",
  };

  return (Object.keys(names) as (keyof MissionSources)[])
    .filter((key) => sources[key] !== "ready" && sources[key] !== "running")
    .map((key) => names[key]);
}

export type AttentionTagTone = "flame" | "marigold" | "muted";

/**
 * The paper tag on a Needs you card. Severity picks the tone; the word is the
 * card's type, except that an interrupted run says so, because "Failed" would
 * blame a worker for the server going away under it.
 */
export function attentionTag(item: Pick<AttentionItem, "type" | "severity" | "description">): {
  tone: AttentionTagTone;
  label: string;
} {
  const tone: AttentionTagTone =
    item.severity === "critical" ? "flame" : item.severity === "warning" ? "marigold" : "muted";
  const interrupted = item.type === "failed" && /^interrupted\b/i.test(item.description ?? "");
  return { tone, label: interrupted ? "Interrupted" : attentionLabel(item.type) };
}

/** From 5pm (until 4am) Today leads with the wrap instead of the plan. */
export function isEvening(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour >= 17 || hour < 4;
}

function clock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** `09:00 to 09:30`, or `All day`. */
export function formatEventTime(event: { start: string; end?: string; allDay: boolean }): string {
  if (event.allDay) return "All day";
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return "";
  const end = event.end ? new Date(event.end) : undefined;
  return end && !Number.isNaN(end.getTime()) ? `${clock(start)} to ${clock(end)}` : clock(start);
}

export type EventTiming = "past" | "now" | "next" | "later";

/**
 * Where each event sits relative to now: done, happening, the next one, or
 * later. All-day events are never "past" or "next"; they frame the day.
 */
export function eventTimings(
  events: readonly { id: string; start: string; end?: string; allDay: boolean }[],
  now: Date = new Date(),
): Map<string, EventTiming> {
  const timings = new Map<string, EventTiming>();
  let nextAssigned = false;
  for (const event of events) {
    if (event.allDay) {
      timings.set(event.id, "later");
      continue;
    }
    const start = Date.parse(event.start);
    const end = event.end ? Date.parse(event.end) : start;
    if (end <= now.getTime()) timings.set(event.id, "past");
    else if (start <= now.getTime()) timings.set(event.id, "now");
    else if (!nextAssigned) {
      timings.set(event.id, "next");
      nextAssigned = true;
    } else timings.set(event.id, "later");
  }
  return timings;
}

/** When a brief was written: `07:30` today, `Thu 07:41` otherwise. */
export function formatBriefTime(runAt: string, now: Date = new Date()): string {
  const date = new Date(runAt);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? clock(date) : `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${clock(date)}`;
}
