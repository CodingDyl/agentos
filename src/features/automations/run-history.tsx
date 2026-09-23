import { Check, CircleDot, X } from "lucide-react";
import type { AutomationExecution } from "@shared/agentos-types";
import { EmptyState, HairlineCard } from "@/components/os";
import { cn } from "@/lib/utils";
import { formatRunStamp } from "./automations-model";

const STATUS_ICON = {
  success: Check,
  failed: X,
  running: CircleDot,
} as const;

const STATUS_TONE = {
  success: "text-os-success",
  failed: "text-os-danger",
  running: "text-os-amber",
} as const;

export interface RunHistoryProps {
  runs: AutomationExecution[];
  now?: Date;
  className?: string;
}

/**
 * Every attempt Hermes recorded, newest first.
 *
 * The verdict is stated plainly and the failure reason is shown with it — a
 * history that only says "failed" sends the operator back to the terminal,
 * which is the thing this screen exists to avoid.
 */
export function RunHistory({ runs, now, className }: RunHistoryProps) {
  if (runs.length === 0) {
    return (
      <EmptyState
        variant="inline"
        description="Hermes has recorded no runs for this automation yet."
        className={className}
      />
    );
  }

  return (
    <HairlineCard className={cn("overflow-hidden", className)}>
      <ul className="divide-y divide-os-border">
        {runs.map((run) => {
          const Icon = STATUS_ICON[run.status];

          return (
            <li key={run.id} className="px-5 py-4 md:px-6">
              <div className="flex items-baseline justify-between gap-6">
                <span className="os-meta shrink-0 text-os-muted">
                  {formatRunStamp(run.timestamp, now)}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      STATUS_TONE[run.status],
                      run.status === "running" && "motion-safe:animate-pulse",
                    )}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  {/* Hermes' own word, when it is not simply success or
                      failure — an attempt whose outcome it never established
                      should not be reported as one it did. */}
                  <span className="os-meta truncate text-os-muted">
                    {run.rawStatus ?? run.status}
                  </span>
                </span>
              </div>

              {run.error ? (
                <p className="mt-3 font-mono text-[12px] leading-5 break-words text-os-danger">
                  {run.error}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </HairlineCard>
  );
}
