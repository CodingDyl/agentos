import { ArrowUpRight } from "lucide-react";
import type { LiHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PriorityTag, type Priority } from "./priority-tag";
import { ProgressBar, type ProgressBarProps } from "./progress-bar";
import { StatusPill, type AgentStatus } from "./status-pill";

export interface ProjectListItemProps extends LiHTMLAttributes<HTMLLIElement> {
  name: string;
  status: AgentStatus;
  statusLabel?: string;
  priority?: Priority;
  /** Portfolio label, e.g. `Product`. */
  type?: string;
  /** One line of current status. */
  summary?: string;
  nextAction?: string;
  /** Pre-formatted, e.g. `2 days ago`. */
  lastActivity?: string;
  to?: string;
  /** Where the project is going: its active milestone and how far along. */
  milestone?: {
    title: string;
    percent: number;
    /** e.g. `12 / 18 · Target 25 Sep`. */
    detail?: string;
    tone?: ProgressBarProps["tone"];
  };
}

/**
 * The browse-density project entry, for screens that survey the whole
 * portfolio. `ProjectRow` is its compact sibling, for ranked dashboard lists.
 */
export function ProjectListItem({
  name,
  status,
  statusLabel,
  priority,
  type,
  summary,
  nextAction,
  lastActivity,
  to,
  milestone,
  className,
  ...props
}: ProjectListItemProps) {
  const content = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="truncate text-base leading-6 font-medium">{name}</h3>
          {type ? (
            <p className="os-meta mt-1.5 text-os-subtle">{type}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <StatusPill status={status} label={statusLabel} />
          {priority ? (
            <PriorityTag priority={priority} className="w-14 text-right" />
          ) : null}
        </div>
      </div>

      {summary ? (
        <p className="mt-4 max-w-[68ch] text-[15px] leading-6 text-os-muted">
          {summary}
        </p>
      ) : null}

      {milestone ? (
        <div className="mt-4 max-w-[28rem]">
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate text-[13px] leading-5 text-foreground">{milestone.title}</span>
            <span className="os-meta shrink-0 text-os-subtle tabular-nums">
              {milestone.detail ? `${milestone.detail} · ` : ""}
              {Math.round(milestone.percent)}%
            </span>
          </div>
          <ProgressBar
            percent={milestone.percent}
            label={`${milestone.title} progress`}
            size="row"
            tone={milestone.tone}
            className="mt-2"
          />
        </div>
      ) : null}

      <div className="mt-5 flex min-h-6 items-center justify-between gap-4 border-t border-os-border pt-4">
        {nextAction ? (
          <p className="min-w-0 truncate text-[13px] leading-5 text-os-muted">
            <span className="os-meta mr-2 text-os-subtle">Next</span>
            {nextAction}
          </p>
        ) : (
          <span className="os-meta text-os-subtle">No queued task</span>
        )}
        <div className="flex shrink-0 items-center gap-3">
          {lastActivity ? (
            <span className="os-meta text-os-subtle">{lastActivity}</span>
          ) : null}
          {to ? (
            <ArrowUpRight
              className="size-4 text-os-subtle transition-colors duration-150 group-hover:text-foreground"
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
    </>
  );

  const layout = "block px-5 py-5 md:px-6";

  return (
    <li className={cn("min-w-0", className)} {...props}>
      {to ? (
        <Link
          to={to}
          // Inset ring: entries sit inside a clipping card, so an offset ring
          // would be cut off at the edges.
          className={cn(
            "group cursor-pointer transition-colors duration-150 outline-none hover:bg-os-surface-raised",
            "focus-visible:inset-ring-2 focus-visible:inset-ring-ring/70",
            layout,
          )}
        >
          {content}
        </Link>
      ) : (
        <div className={layout}>{content}</div>
      )}
    </li>
  );
}
