import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Connectivity states, plus the agent's own run state for the status bar. */
export type SystemState =
  | "online"
  | "offline"
  | "syncing"
  | "degraded"
  | "idle"
  | "running"
  | "waiting"
  | "stopping";

const indicatorStyles: Record<SystemState, string> = {
  online: "bg-os-success",
  offline: "bg-os-danger",
  syncing: "bg-os-amber motion-safe:animate-pulse",
  degraded: "bg-os-warning",
  idle: "bg-os-subtle",
  running: "bg-os-amber motion-safe:animate-pulse",
  waiting: "bg-os-warning motion-safe:animate-pulse",
  stopping: "bg-os-danger motion-safe:animate-pulse",
};

export interface SystemIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  state: SystemState;
  label: string;
  detail?: string;
}

export function SystemIndicator({
  state,
  label,
  detail,
  className,
  ...props
}: SystemIndicatorProps) {
  return (
    <div
      className={cn("inline-flex items-center gap-2.5", className)}
      role="status"
      aria-label={`${label}: ${detail ?? state}`}
      {...props}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", indicatorStyles[state])}
        aria-hidden="true"
      />
      <span className="os-meta text-os-muted">{label}</span>
      {detail ? (
        <span className="os-meta text-os-subtle">{detail}</span>
      ) : null}
    </div>
  );
}
