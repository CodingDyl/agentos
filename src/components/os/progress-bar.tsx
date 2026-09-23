import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0–100. */
  percent: number;
  /** Accessible name, e.g. `Chef Experience progress`. */
  label: string;
  tone?: "amber" | "success" | "warning" | "danger" | "subtle";
  /** Thinner, for rows; the default suits a detail view. */
  size?: "row" | "block";
}

const TONE: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  amber: "bg-os-amber",
  success: "bg-os-success",
  warning: "bg-os-warning",
  danger: "bg-os-danger",
  subtle: "bg-os-subtle",
};

/**
 * A hairline progress bar. The track is a border, the fill is one colour,
 * and the number lives beside it in the caller's own type — the bar never
 * carries a label of its own. Deliberately not animated: progress here is a
 * fact about a file, not a live gauge.
 */
export function ProgressBar({ percent, label, tone = "amber", size = "block", className, ...props }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn(
        "relative w-full overflow-hidden rounded-sm bg-os-border/60",
        size === "row" ? "h-[3px]" : "h-1.5",
        className,
      )}
      {...props}
    >
      <div className={cn("h-full rounded-sm", TONE[tone])} style={{ width: `${clamped}%` }} />
    </div>
  );
}
