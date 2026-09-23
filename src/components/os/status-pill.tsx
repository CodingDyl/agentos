import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type AgentStatus =
  | "active"
  | "running"
  | "healthy"
  | "completed"
  | "paused"
  | "incubating"
  | "blocked"
  | "attention";

/**
 * Only the dot carries colour, and it never carries meaning alone — the label
 * beside it always names the state. See DESIGN.md §3 for the signal mapping.
 */
const statusStyles: Record<AgentStatus, string> = {
  active: "bg-os-success",
  running: "bg-os-amber motion-safe:animate-pulse",
  healthy: "bg-os-success",
  completed: "bg-os-success",
  paused: "bg-os-subtle",
  incubating: "bg-os-subtle",
  blocked: "bg-os-danger",
  attention: "bg-os-warning",
};

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  status: AgentStatus;
  label?: string;
}

export function StatusPill({
  status,
  label,
  className,
  ...props
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "os-meta inline-flex min-h-7 items-center gap-2 rounded-sm border border-os-border px-2.5 text-os-muted",
        className,
      )}
      data-status={status}
      {...props}
    >
      <span
        className={cn("size-1.5 rounded-full", statusStyles[status])}
        aria-hidden="true"
      />
      {label ?? status}
    </span>
  );
}
