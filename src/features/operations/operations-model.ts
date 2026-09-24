import type {
  BudgetState,
  UsageMeasurement,
  UsageTotal,
} from "@shared/usage-types";

/**
 * Operations' view model.
 *
 * Its whole job is the rule from 52.3, applied everywhere without exception:
 * **never turn missing provider data into fake precision.**
 *
 * ```text
 * 12,481 tokens   exact       the provider counted it
 * ~12,500 tokens  estimated   AgentOS derived it, and says so
 * —               unknown     nobody can say
 * ```
 *
 * The tilde is not decoration. It is the difference between a figure you can
 * take to a decision and one you cannot, and it is the single most important
 * thing this screen renders — a usage page that quietly rounds absences to
 * zero is worse than no usage page, because it is confidently wrong about
 * money.
 */

/** The em dash the whole screen uses for "nobody knows". */
export const UNKNOWN = "—";

/**
 * A figure, and how much to trust it.
 *
 * Returned as a pair rather than a pre-formatted string so the caller can
 * decide the tone — an estimate is written differently from an exact figure
 * *and* coloured differently, and a bare string could only carry one of those.
 */
export interface Measured {
  text: string;
  measurement: UsageMeasurement;
}

/**
 * Tokens, at the magnitude a person reads them in.
 *
 * `1.82M`, `184k`, `312`. Rounded on purpose: nobody makes a decision on the
 * difference between 184,230 and 184,000, and the exact figure at that width
 * is a wall of digits that hides the one column that matters.
 */
export function formatTokens(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN;

  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;

  return String(Math.round(value));
}

/**
 * Money, always with the cents.
 *
 * Never rounded to whole dollars. At this scale the difference between $0.31
 * and $0.82 is the entire economic argument between two workers, and a column
 * of `$0` and `$1` would answer a much coarser question than the one being
 * asked.
 */
export function formatCost(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN;

  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN;

  return `${Math.round(value * 100)}%`;
}

export function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return UNKNOWN;

  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Prefixes an estimate with a tilde. Exact figures are left alone. */
function mark(text: string, measurement: UsageMeasurement): Measured {
  if (text === UNKNOWN) return { text: UNKNOWN, measurement: "unknown" };

  return {
    text: measurement === "estimated" ? `~${text}` : text,
    measurement,
  };
}

export function measuredTokens(total: UsageTotal): Measured {
  return mark(formatTokens(total.tokens), total.status);
}

/**
 * A cost figure and how much of its bucket it covers.
 *
 * Cost carries its own measurement, separate from tokens, because the two
 * genuinely differ: a Grok run has exact tokens and no price at all, and one
 * combined status would have to round one of those into the other.
 */
export function measuredCost(total: UsageTotal): Measured {
  if (total.costUsd === undefined) {
    return { text: UNKNOWN, measurement: "unknown" };
  }

  // Priced by the provider, so exact — but possibly exact about only part of
  // the bucket. That gap is `coverageNote`'s job, not this one's.
  return { text: formatCost(total.costUsd), measurement: "exact" };
}

/**
 * What a total leaves out, in a sentence.
 *
 * Shown wherever coverage is partial, because a figure that silently omitted
 * every unpriced run is the most misleading thing this screen could render.
 * Absent when everything was measured — a complete figure explains nothing.
 */
export function coverageNote(total: UsageTotal): string | undefined {
  if (total.records === 0) return undefined;
  if (total.costed === total.records && total.measured === total.records) {
    return undefined;
  }

  if (total.costed === 0 && total.measured === 0) {
    return `${total.records} run${total.records === 1 ? "" : "s"}, none reported usage`;
  }

  const parts: string[] = [];

  if (total.measured < total.records) {
    parts.push(`${total.measured}/${total.records} reported tokens`);
  }

  if (total.costed < total.records) {
    parts.push(`${total.costed}/${total.records} reported cost`);
  }

  return parts.join(" · ");
}

/** How an estimate or an unknown is toned. Exact figures use the default. */
export function measurementTone(measurement: UsageMeasurement): string {
  return measurement === "unknown"
    ? "text-os-subtle"
    : measurement === "estimated"
      ? "text-os-muted"
      : "text-foreground";
}

const BUDGET_TONE: Record<BudgetState["state"], string> = {
  ok: "bg-os-success",
  warning: "bg-os-warning",
  exceeded: "bg-os-danger",
};

export function budgetTone(state: BudgetState["state"]): string {
  return BUDGET_TONE[state];
}

/** What a budget is measured against, in words. */
export function budgetLabel(budget: BudgetState["budget"]): string {
  if (budget.scope === "global") return "Monthly AI budget";

  return `${budget.scopeId ?? "Unnamed"} · monthly`;
}
