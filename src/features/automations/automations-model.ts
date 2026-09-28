import type { Automation, AutomationState } from "@shared/agentos-types";
import type { AgentStatus } from "@/components/os";

/**
 * The Automations screen's view model.
 *
 * Everything the screen renders is derived here. Hermes owns the schedule and
 * the adapter owns the reading of it; this module only decides how that state
 * reads to a person — what counts as attention, and how a timestamp is said.
 */

/** Maps a job's state onto the design system's status vocabulary. */
const STATUS_BY_STATE: Record<AutomationState, AgentStatus> = {
  active: "active",
  paused: "paused",
  disabled: "paused",
  completed: "completed",
};

const LABEL_BY_STATE: Record<AutomationState, string> = {
  active: "Active",
  paused: "Paused",
  disabled: "Disabled",
  completed: "Finished",
};

export function statusFor(automation: Automation): AgentStatus {
  // A failing schedule is still scheduled, but "active" is not what the
  // operator needs to read first.
  if (needsAttention(automation)) return "attention";
  return STATUS_BY_STATE[automation.state];
}

/**
 * The word beside the status dot.
 *
 * A dot never carries meaning on its own (DESIGN.md §3), so an automation
 * showing the attention colour has to say so in words — "Active" beside an
 * amber dot tells the operator nothing.
 */
export function labelFor(automation: Automation): string {
  if (needsAttention(automation)) {
    return automation.lastRun?.status === "failed" ? "Failing" : "Attention";
  }

  return LABEL_BY_STATE[automation.state];
}

/**
 * Hermes' schedule wording, set as a sentence.
 *
 * The words are Hermes' own — only the first letter is the console's, because
 * the screen reads as prose rather than as CLI output.
 */
export function formatSchedule(schedule: string): string {
  return schedule.charAt(0).toUpperCase() + schedule.slice(1);
}

/**
 * Whether this automation is asking for something.
 *
 * A job you turned off, or one that has finished its run count, is not a
 * problem — it is a decision. Only work that is meant to be happening and is
 * not can raise a flag.
 */
export function needsAttention(automation: Automation): boolean {
  if (automation.state === "disabled" || automation.state === "completed") {
    return false;
  }

  return automation.lastRun?.status === "failed" || automation.warnings.length > 0;
}

/** The automations worth interrupting the day for. Often none. */
export function selectAlerts(automations: Automation[]): Automation[] {
  return automations.filter(needsAttention);
}

export function countActive(automations: Automation[]): number {
  return automations.filter((automation) => automation.enabled).length;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days between two moments, in the reader's own timezone. */
function daysApart(target: Date, now: Date): number {
  return Math.round((startOfDay(target) - startOfDay(now)) / MILLISECONDS_PER_DAY);
}

function clockTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * When a run happened, or will.
 *
 * A schedule is read in relation to now — "tomorrow at half seven" is what the
 * operator actually wants to know, and an ISO timestamp is not. The near future
 * and the near past are named; anything further away gets a date.
 */
export function formatRunTime(
  isoTimestamp: string | undefined,
  now: Date = new Date(),
): string | undefined {
  if (!isoTimestamp) return undefined;

  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return undefined;

  const days = daysApart(date, now);

  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : // Inside the coming week a weekday is enough to place it.
            days > 1 && days < 7
            ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)
            : new Intl.DateTimeFormat(undefined, {
                day: "numeric",
                month: "short",
              }).format(date);

  return `${day} · ${clockTime(date)}`;
}

/**
 * A run history stamp, e.g. `7 Sep · 07:30`.
 *
 * History is a list of moments in the past, so every row carries its date —
 * "yesterday" stops being useful as soon as there are two of them.
 */
export function formatRunStamp(
  isoTimestamp: string,
  now: Date = new Date(),
): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;

  const sameYear = date.getFullYear() === now.getFullYear();

  const day = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);

  return `${day} · ${clockTime(date)}`;
}

/** The command that runs this automation's skill by hand, if it has one. */
export function commandFor(automation: Automation): string | undefined {
  return automation.skill ? `/${automation.skill}` : undefined;
}

/**
 * A failing automation, as Home states it.
 *
 * Home carries risks, not status: an automation reaches it only when something
 * that should have happened did not.
 */
export interface AutomationAlert {
  id: string;
  name: string;
  /** What happened, in a few words. */
  summary: string;
  /** Hermes' own words, when it gave any. */
  detail?: string;
  href: string;
}

export function describeAlert(
  automation: Automation,
  now: Date = new Date(),
): AutomationAlert {
  const lastRun = automation.lastRun;
  const when = formatRunTime(lastRun?.timestamp, now);

  return {
    id: automation.id,
    name: automation.name,
    summary:
      lastRun?.status === "failed"
        ? when
          ? `Last run failed · ${when}`
          : "Last run failed"
        : "Needs attention",
    detail: lastRun?.detail ?? automation.warnings[0],
    href: `/automations/${automation.id}`,
  };
}

export type AutomationTagTone = "green" | "marigold" | "flame" | "muted";

/**
 * The paper tag beside a job's name: the same words as `labelFor`, in the
 * paper world's tones. Failing is flame — the one state asking for action.
 */
export function stateTag(automation: Automation): { tone: AutomationTagTone; label: string } {
  const label = labelFor(automation);
  if (needsAttention(automation)) return { tone: "flame", label };
  if (automation.state === "active") return { tone: "green", label };
  if (automation.state === "paused") return { tone: "marigold", label };
  return { tone: "muted", label };
}
