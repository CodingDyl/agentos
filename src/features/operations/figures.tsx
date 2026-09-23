import type { UsageBreakdownRow, UsageTotal } from "@shared/usage-types";
import { SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";
import {
  coverageNote,
  formatPercent,
  measuredCost,
  measuredTokens,
  measurementTone,
  UNKNOWN,
  type Measured,
} from "./operations-model";

/**
 * The pieces every Operations view is built from.
 *
 * Collected here because the honesty of this screen depends on it being drawn
 * the same way everywhere. If one view rendered an unknown as `0` while the
 * rest showed an em dash, the whole page's credibility would be only as good
 * as its least careful section.
 */

/** One headline number. The figure leads; the label explains it. */
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
      <p
        className={cn(
          "tabular-nums",
          size === "large"
            ? "text-[clamp(1.5rem,3vw,2rem)] leading-[1.05] tracking-[-0.02em]"
            : "text-[22px] leading-[1.15]",
          measurementTone(value.measurement),
        )}
      >
        {value.text}
      </p>
      <p className="os-meta mt-2 text-os-subtle">{label}</p>
      {detail ? (
        <p className="mt-1.5 text-[13px] leading-5 text-os-subtle">{detail}</p>
      ) : null}
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
  const note = coverageNote(total);

  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6">
      <Figure value={measuredTokens(total)} label={tokenLabel} size="small" />
      <Figure
        value={measuredCost(total)}
        label={costLabel}
        size="small"
        detail={note}
      />
    </div>
  );
}

/**
 * A ranked breakdown.
 *
 * The bar is a share of the *measured* whole, and it simply does not draw when
 * the share is unknown — a full-width bar behind an em dash would read as
 * "all of it", which is the opposite of what an absence means.
 */
export function Breakdown({
  rows,
  label,
  by = "tokens",
  empty = "Nothing recorded yet.",
  onSelect,
}: {
  rows: readonly UsageBreakdownRow[];
  label: string;
  /** Which figure the bar and the ranking are about. */
  by?: "tokens" | "cost";
  empty?: string;
  onSelect?: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <section>
        <SectionLabel>{label}</SectionLabel>
        <p className="mt-4 text-[15px] leading-6 text-os-muted">{empty}</p>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel>{label}</SectionLabel>

      <ul className="mt-4">
        {rows.map((row) => {
          const share = by === "cost" ? row.costShare : row.tokenShare;
          const tokens = measuredTokens(row.total);
          const cost = measuredCost(row.total);

          const content = (
            <>
              <div className="flex min-w-0 items-baseline justify-between gap-4">
                <span className="min-w-0 truncate text-[15px] leading-6 text-foreground">
                  {row.label}
                </span>
                <span className="flex shrink-0 items-baseline gap-5">
                  <span
                    className={cn(
                      "tabular-nums text-[14px]",
                      measurementTone(tokens.measurement),
                    )}
                  >
                    {tokens.text}
                  </span>
                  <span
                    className={cn(
                      "w-16 text-right tabular-nums text-[14px]",
                      measurementTone(cost.measurement),
                    )}
                  >
                    {cost.text}
                  </span>
                  <span className="os-meta w-9 text-right text-os-subtle">
                    {share === undefined ? UNKNOWN : formatPercent(share)}
                  </span>
                </span>
              </div>

              {/* Only ever drawn over a share that is actually known. */}
              <div className="mt-2 h-px w-full bg-os-border">
                {share === undefined ? null : (
                  <div
                    className="h-px bg-os-amber/60"
                    style={{ width: `${Math.min(share * 100, 100)}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
            </>
          );

          return (
            <li key={row.key} className="border-b border-os-border/60 py-3.5">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(row.key)}
                  className="os-focus-ring block w-full cursor-pointer rounded-md text-left"
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
    </section>
  );
}
