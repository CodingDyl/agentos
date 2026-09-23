import { ArrowUpRight } from "lucide-react";
import type { LiHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PriorityTag, type Priority } from "./priority-tag";
import { StatusPill, type AgentStatus } from "./status-pill";

export interface ProjectRowProps extends LiHTMLAttributes<HTMLLIElement> {
  name: string;
  status: AgentStatus;
  statusLabel?: string;
  priority?: Priority;
  summary?: string;
  to?: string;
}

/**
 * Compact project entry for edge-to-edge lists. The denser sibling of
 * `ProjectCard`, for screens that rank several projects at once.
 */
export function ProjectRow({
  name,
  status,
  statusLabel,
  priority,
  summary,
  to,
  className,
  ...props
}: ProjectRowProps) {
  const content = (
    <>
      <div className="min-w-0">
        <h3 className="truncate text-[15px] leading-6 font-medium">{name}</h3>
        {summary ? (
          <p className="mt-0.5 truncate text-[13px] leading-5 text-os-muted">
            {summary}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <StatusPill status={status} label={statusLabel} />
        {priority ? (
          <PriorityTag priority={priority} className="w-14 text-right" />
        ) : null}
        {to ? (
          <ArrowUpRight
            className="size-4 text-os-subtle transition-colors duration-150 group-hover:text-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </>
  );

  const layout =
    "flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 sm:flex-nowrap md:px-6";

  return (
    <li className={cn("min-w-0", className)} {...props}>
      {to ? (
        <Link
          to={to}
          className={cn(
            // Inset ring: rows sit inside a clipping card, so an offset ring would be cut off.
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
