import type { AgentRunStatus } from "@shared/agentos-types";
import type { SystemState } from "@/components/os";

/** How a run's status is presented, in the console header and the shell bar. */
export type AgentRunState =
  | "ready"
  | "thinking"
  | "running"
  | "waiting"
  | "stopping"
  | "error"
  | "unconfigured";

/**
 * Amber is reserved for work actually in flight, per DESIGN.md §3 — a ready
 * agent must not compete with one that is running.
 */
export const RUN_INDICATOR: Record<
  AgentRunState,
  { state: SystemState; label: string }
> = {
  ready: { state: "online", label: "Hermes / ready" },
  thinking: { state: "running", label: "Hermes / thinking" },
  running: { state: "running", label: "Hermes / running" },
  waiting: { state: "waiting", label: "Hermes / waiting" },
  stopping: { state: "stopping", label: "Hermes / stopping" },
  error: { state: "offline", label: "Hermes / error" },
  unconfigured: { state: "degraded", label: "Hermes / not configured" },
};

/** Maps a run's status onto the console's display state. */
export function runStateFor(status: AgentRunStatus): AgentRunState {
  switch (status) {
    case "starting":
    case "running":
      return "running";
    case "waiting_for_approval":
      return "waiting";
    case "stopping":
      return "stopping";
    case "failed":
      return "error";
    default:
      return "ready";
  }
}

/** The shell's bottom-bar state for a run status. */
export function shellStateFor(status: AgentRunStatus): SystemState {
  return RUN_INDICATOR[runStateFor(status)].state;
}
