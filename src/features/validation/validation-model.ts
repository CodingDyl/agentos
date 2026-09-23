import type {
  FrictionCategory,
  InterventionKind,
  ValidationOutcome,
  ValidationScorecard,
  ValidationVerdict,
} from "@shared/validation-sprint-types";

/**
 * The sprint's view model.
 *
 * Two jobs. It holds the wording — a closed vocabulary written once, so the
 * same category never reads as "Missing context" on one screen and "Context
 * missing" on another — and it decides how an unknown is drawn.
 *
 * That second job is the important one. Every figure on the scorecard can be
 * genuinely unmeasured, and a screen that rendered those as `0` or `0%` would
 * quietly turn a gap in the evidence into a claim about the system. Unknowns
 * are shown as `—`, and they are supposed to look like nothing rather than
 * like a bad result.
 */

/** The em dash the whole screen uses for "nobody knows". */
export const UNKNOWN = "—";

export const FRICTION_LABELS: Record<FrictionCategory, string> = {
  too_many_clicks: "Too many clicks",
  bad_task_scope: "Bad task scope",
  wrong_worker_selected: "Wrong worker selected",
  worker_got_confused: "Worker got confused",
  missing_context: "Missing context",
  review_was_poor: "Review was poor",
  validation_problem: "Validation problem",
  visual_verification_problem: "Visual verification problem",
  too_slow: "Too slow",
  too_expensive: "Too expensive",
  approval_flow_annoying: "Approval flow annoying",
  integration_problem: "Integration problem",
  other: "Other",
};

/**
 * The order the categories are offered in.
 *
 * Roughly the order of the pipeline — scoping, routing, running, reviewing,
 * approving, integrating — with the two that can happen anywhere at the end.
 * A person filing a report mid-task is scanning, not reading, and a list that
 * follows the workflow is faster to scan than an alphabetical one.
 */
export const FRICTION_ORDER: readonly FrictionCategory[] = [
  "bad_task_scope",
  "missing_context",
  "wrong_worker_selected",
  "worker_got_confused",
  "validation_problem",
  "visual_verification_problem",
  "review_was_poor",
  "approval_flow_annoying",
  "integration_problem",
  "too_many_clicks",
  "too_slow",
  "too_expensive",
  "other",
];

export const INTERVENTION_LABELS: Record<InterventionKind, string> = {
  scope_edited: "Scope needed editing",
  worker_overridden: "Worker overridden",
  worker_redirected: "Worker redirected",
  review_incorrect: "Review was incorrect",
  validation_fixed: "Validation fixed by hand",
  integration_manual: "Integrated by hand",
  taken_over: "Took the task over",
};

/** The same order as 51.4, which is the order they happen in. */
export const INTERVENTION_ORDER: readonly InterventionKind[] = [
  "scope_edited",
  "worker_overridden",
  "worker_redirected",
  "review_incorrect",
  "validation_fixed",
  "integration_manual",
  "taken_over",
];

export const OUTCOME_LABELS: Record<ValidationOutcome, string> = {
  in_progress: "In progress",
  completed: "Completed",
  abandoned: "Abandoned",
  manual_takeover: "Manual takeover",
};

/** The question, asked in the operator's own words rather than a score. */
export const VERDICT_LABELS: Record<ValidationVerdict, string> = {
  definitely: "Definitely",
  slightly: "Slightly",
  no_difference: "No difference",
  worse: "Worse",
};

export const VERDICT_ORDER: readonly ValidationVerdict[] = [
  "definitely",
  "slightly",
  "no_difference",
  "worse",
];

/** A span, in the units a person would say it in. */
export function formatSpan(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return UNKNOWN;

  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A proportion as a percentage, or nothing when there was nothing to measure. */
export function formatRate(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN;

  return `${Math.round(value * 100)}%`;
}

/** One decimal, because 1.6 revisions is the finding and 2 is not. */
export function formatAverage(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN;

  return value.toFixed(1);
}

export function formatCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN;

  return String(value);
}

/**
 * Money, with the cents.
 *
 * Never rounded to whole dollars: at this scale the difference between $0.62
 * and $4.12 is the entire question, and a scorecard that said `$1` and `$4`
 * would be answering a coarser one.
 */
export function formatCost(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN;

  return `$${value.toFixed(2)}`;
}

/**
 * What the cost figure actually covers.
 *
 * Said out loud whenever it is not every task. A total that silently omitted
 * three of five runs is the kind of number that ends up in a decision.
 */
export function costCoverage(scorecard: ValidationScorecard): string | undefined {
  const { tasksWithCost, tasksAttempted } = scorecard;

  if (tasksAttempted === 0 || tasksWithCost === tasksAttempted) return undefined;

  return tasksWithCost === 0
    ? "No run reported a cost"
    : `${tasksWithCost} of ${tasksAttempted} tasks reported a cost`;
}
