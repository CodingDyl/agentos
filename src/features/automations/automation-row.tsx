import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { Automation } from "@shared/agentos-types";
import { StatusPill } from "@/components/os";
import { cn } from "@/lib/utils";
import {
  commandFor,
  formatRunTime,
  formatSchedule,
  labelFor,
  statusFor,
} from "./automations-model";

/** One labelled fact in the row's footing. */
function Fact({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "danger" | "subtle";
}) {
  return (
    <div className="min-w-0">
      <p className="os-meta text-os-subtle">{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-[13px] leading-5",
          tone === "danger" && "text-os-danger",
          tone === "muted" && "text-os-muted",
          tone === "subtle" && "text-os-subtle",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export interface AutomationRowProps {
  automation: Automation;
  /** Fixed so a test, or a late-night reading, is not relative to the render. */
  now?: Date;
}

/**
 * One scheduled job, at browse density.
 *
 * The row answers three questions in reading order: what it is, when it runs,
 * and whether it worked. A failure is not softened into a status word — the
 * reason Hermes gave is shown on the row itself.
 */
export function AutomationRow({ automation, now }: AutomationRowProps) {
  const command = commandFor(automation);
  const lastRun = automation.lastRun;
  const nextRun = formatRunTime(automation.nextRun, now);

  return (
    <li className="min-w-0">
      <Link
        to={`/automations/${automation.id}`}
        // Inset ring: rows sit inside a clipping card, so an offset ring would
        // be cut off at the edges.
        className={cn(
          "group block cursor-pointer px-5 py-5 transition-colors duration-150 outline-none md:px-6",
          "hover:bg-os-surface-raised focus-visible:inset-ring-2 focus-visible:inset-ring-ring/70",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h3 className="truncate text-base leading-6 font-medium">
              {automation.name}
            </h3>
            {command ? (
              <p className="mt-1.5 truncate font-mono text-[13px] leading-5 text-os-subtle">
                {command}
              </p>
            ) : null}
          </div>
          <StatusPill
            status={statusFor(automation)}
            label={labelFor(automation)}
            className="shrink-0"
          />
        </div>

        <p className="mt-4 text-[15px] leading-6 text-os-muted">
          {formatSchedule(automation.schedule)}
        </p>

        <div className="mt-5 flex items-end justify-between gap-6 border-t border-os-border pt-4">
          {/* Stacked on a phone: a truncated "Success · Toda…" answers nothing,
              and these two facts are the reason to read the row at all. */}
          <div className="grid min-w-0 flex-1 gap-x-6 gap-y-4 sm:max-w-md sm:grid-cols-2">
            <Fact
              label="Last run"
              tone={lastRun?.status === "failed" ? "danger" : "muted"}
              value={
                lastRun
                  ? `${lastRun.status === "failed" ? "Failed" : lastRun.status === "running" ? "Running" : "Success"} · ${
                      formatRunTime(lastRun.timestamp, now) ?? lastRun.timestamp
                    }`
                  : "Never run"
              }
            />
            <Fact
              label="Next run"
              tone={nextRun ? "muted" : "subtle"}
              value={nextRun ?? "Not scheduled"}
            />
          </div>

          <ArrowUpRight
            className="mb-0.5 size-4 shrink-0 text-os-subtle transition-colors duration-150 group-hover:text-foreground"
            aria-hidden="true"
          />
        </div>

        {/* Whatever Hermes said, said the way Hermes said it. */}
        {lastRun?.detail ? (
          <p className="mt-4 max-w-[72ch] truncate font-mono text-[12px] leading-5 text-os-danger">
            {lastRun.detail}
          </p>
        ) : null}

        {automation.warnings.map((warning) => (
          <p
            key={warning}
            className="mt-2 max-w-[72ch] truncate text-[13px] leading-5 text-os-warning"
          >
            {warning}
          </p>
        ))}
      </Link>
    </li>
  );
}
