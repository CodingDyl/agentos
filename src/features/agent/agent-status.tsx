import type { SystemState } from "@/components/os";
import { PaperIndicator, type IndicatorTone } from "@/components/paper";
import { RUN_INDICATOR, type AgentRunState } from "./run-status-display";

export interface AgentStatusProps {
  state: AgentRunState;
}

/** Amber is work in flight; green is ready; the rest are a warning or a fault. */
const TONE: Record<SystemState, IndicatorTone> = {
  online: "green",
  offline: "flame",
  syncing: "amber",
  degraded: "marigold",
  idle: "muted",
  running: "amber",
  waiting: "marigold",
  stopping: "flame",
};

export function AgentStatus({ state }: AgentStatusProps) {
  const { state: indicatorState, label } = RUN_INDICATOR[state];
  return <PaperIndicator tone={TONE[indicatorState]} label={label} />;
}
