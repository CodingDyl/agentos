import { Check, CircleDot, X } from "lucide-react";
import type { AutomationExecution } from "@shared/agentos-types";
import { cn } from "@/lib/utils";
import { formatRunStamp } from "./automations-model";

const STATUS_ICON = { success: Check, failed: X, running: CircleDot } as const;

const STATUS_TONE = {
  success: "text-paper-moss",
  failed: "text-paper-flame-deep",
  running: "text-paper-amber-deep",
} as const;

const STATUS_WORD = { success: "Worked", failed: "Failed", running: "Running" } as const;

export interface RunHistoryProps {
  runs: AutomationExecution[];
  now?: Date;
  className?: string;
}

/**
 * Every attempt Hermes recorded, newest first. The verdict is stated plainly
 * with the failure reason beside it — a history that only says "failed"
 * sends the operator back to the terminal.
 */
export function RunHistory({ runs, now, className }: RunHistoryProps) {
  if (runs.length === 0) {
    return <p className={cn("text-[14px] text-paper-sage", className)}>Hermes has recorded no runs for this job yet.</p>;
  }

  return (
    <ul className={cn("divide-y divide-paper-stone rounded-none border border-paper-mist", className)}>
      {runs.map((run) => {
        const Icon = STATUS_ICON[run.status];
        return (
          <li key={run.id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-6">
              <span className="text-[13.5px] text-paper-char tabular-nums">{formatRunStamp(run.timestamp, now)}</span>
              <span className={cn("flex min-w-0 items-center gap-1.5 text-[13px] font-medium", STATUS_TONE[run.status])}>
                <Icon
                  className={cn("size-3.5 shrink-0", run.status === "running" && "motion-safe:animate-pulse")}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {/* Hermes' own word when it isn't simply success or failure. */}
                <span className="truncate">{run.rawStatus ?? STATUS_WORD[run.status]}</span>
              </span>
            </div>
            {run.error ? (
              <p className="mt-2 font-mono text-[12px] leading-5 break-words text-paper-flame-deep">{run.error}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
