import type { UsageBreakdownRow, UsageTotal } from "@shared/usage-types";
import { cn } from "@/lib/utils";
import {
  coverageNote,
  formatPercent,
  formatTokens,
  formatCost,
  measuredCost,
  measuredTokens,
  paperTone,
  UNKNOWN,
  type Measured,
} from "./operations-model";
import { Meter, PAPER_FOCUS, PaperSection, StackedMeter } from "./paper";

/**
 * The pieces every Operations view is built from.
 *
 * Collected here because the honesty of this screen depends on it being drawn
 * the same way everywhere. If one view rendered an unknown as `0` while the
 * rest showed an em dash, the whole page's credibility would be only as good
 * as its least careful section.
 */

/** One number. The figure leads; the label explains it. */
export function Figure({
  value,
  label,
  detail,
  size = "large",
}: {
  value: Measured;
  label: string;
  detail?: string;
  size?: "large" | "small";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] font-medium text-paper-char">{label}</p>
      <p
        className={cn(
          "mt-1 font-paper-display font-extrabold tracking-[-0.02em] tabular-nums",
          size === "large" ? "text-[28px] leading-[1.1]" : "text-[20px] leading-7",
          paperTone(value.measurement),
        )}
      >
        {value.text}
      </p>
      {detail ? <p className="mt-1 text-[12.5px] leading-5 text-paper-sage">{detail}</p> : null}
    </div>
  );
}

/**
 * A total as tokens and cost together, with what it leaves out.
 *
 * The two always appear as a pair. Tokens without cost invites the assumption
 * that a busy agent is an expensive one, and cost without tokens hides the
 * cheap model doing all the work.
 */
export function TotalFigures({
  total,
  tokenLabel = "Tokens",
  costLabel = "Cost",
}: {
  total: UsageTotal;
  tokenLabel?: string;
  costLabel?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6">
      <Figure value={measuredTokens(total)} label={tokenLabel} size="small" />
      <Figure value={measuredCost(total)} label={costLabel} size="small" detail={coverageNote(total)} />
    </div>
  );
}

/** How many rows get their own ink before the rest fold into "Everything else". */
const STACK_LIMIT = 5;

/**
 * A ranked breakdown: one stacked bar for the shape of the whole, then each row
 * with its own meter.
 *
 * Each bar is a share of the *measured* whole, and simply does not draw when
 * the share is unknown.
 */
export function Breakdown({
  rows,
  label,
  by = "tokens",
  empty = "Nothing recorded yet.",
  onSelect,
  overview = true,
}: {
  rows: readonly UsageBreakdownRow[];
  label: string;
  /** Which figure the bars and the ranking are about. */
  by?: "tokens" | "cost";
  empty?: string;
  onSelect?: (key: string) => void;
  /** The stacked bar above the rows. Off where one row would make it pointless. */
  overview?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <PaperSection label={label}>
        <p className="text-[14px] leading-6 text-paper-sage">{empty}</p>
      </PaperSection>
    );
  }

  const valueOf = (row: UsageBreakdownRow) => (by === "cost" ? row.total.costUsd : row.total.tokens) ?? 0;
  const head = rows.slice(0, STACK_LIMIT).map((row) => ({ key: row.key, label: row.label, value: valueOf(row) }));
  const rest = rows.slice(STACK_LIMIT).reduce((sum, row) => sum + valueOf(row), 0);
  const segments = rest > 0 ? [...head, { key: "rest", label: "Everything else", value: rest }] : head;
  const format = by === "cost" ? (value: number) => formatCost(value) : (value: number) => formatTokens(value);

  return (
    <PaperSection label={label} count={rows.length}>
      {overview && rows.length > 1 ? (
        <div className="mb-5">
          <StackedMeter segments={segments.filter((segment) => segment.value > 0)} format={format} label={label} />
        </div>
      ) : null}

      <ul className="divide-y divide-paper-stone border-y border-paper-stone">
        {rows.map((row) => {
          const share = by === "cost" ? row.costShare : row.tokenShare;
          const tokens = measuredTokens(row.total);
          const cost = measuredCost(row.total);

          const content = (
            <>
              <div className="flex min-w-0 items-baseline justify-between gap-4">
                <span className="min-w-0 truncate text-[14.5px] leading-6 text-paper-moss">{row.label}</span>
                <span className="flex shrink-0 items-baseline gap-5 text-[13.5px] tabular-nums">
                  <span className={paperTone(tokens.measurement)}>{tokens.text}</span>
                  <span className={cn("w-16 text-right", paperTone(cost.measurement))}>{cost.text}</span>
                  <span className="w-10 text-right text-paper-sage">{share === undefined ? UNKNOWN : formatPercent(share)}</span>
                </span>
              </div>
              <div className="mt-2">
                <Meter value={share} label={`${row.label}, share of ${by}`} tone={by === "cost" ? "amber" : "ink"} />
              </div>
            </>
          );

          return (
            <li key={row.key} className="py-3">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(row.key)}
                  className={cn("block w-full cursor-pointer rounded-[4px] text-left transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
                >
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </PaperSection>
  );
}
