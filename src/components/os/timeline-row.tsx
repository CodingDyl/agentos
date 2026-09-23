import type { LiHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type TimelineRowState = "past" | "next" | "upcoming";

export interface TimelineRowProps extends LiHTMLAttributes<HTMLLIElement> {
  /** Machine-formatted time, e.g. `09:00`. Rendered in mono. */
  time: string;
  title: string;
  detail?: string;
  state?: TimelineRowState;
}

/**
 * One time-anchored entry in a schedule. The upcoming entry is named "next" in
 * text so the state never rests on colour alone.
 */
export function TimelineRow({
  time,
  title,
  detail,
  state = "upcoming",
  className,
  ...props
}: TimelineRowProps) {
  const isNext = state === "next";
  const isPast = state === "past";

  return (
    <li
      className={cn(
        "grid min-h-11 grid-cols-[auto_3.25rem_minmax(0,1fr)] items-baseline gap-x-3 py-2",
        className,
      )}
      data-state={state}
      {...props}
    >
      <span
        className={cn(
          "mb-0.5 size-1.5 rounded-full",
          isNext ? "bg-os-amber" : "bg-os-border-strong",
        )}
        aria-hidden="true"
      />
      <time
        className={cn(
          "os-meta tabular-nums",
          isPast ? "text-os-subtle" : "text-os-muted",
        )}
      >
        {time}
      </time>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cn(
              "truncate text-[15px] leading-6",
              isPast ? "text-os-subtle" : "text-foreground",
            )}
          >
            {title}
          </p>
          {isNext ? (
            <span className="os-meta shrink-0 text-os-amber">Next</span>
          ) : null}
        </div>
        {detail ? (
          <p className="os-meta mt-0.5 text-os-subtle">{detail}</p>
        ) : null}
      </div>
    </li>
  );
}
