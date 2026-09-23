import { SystemIndicator } from "@/components/os";
import { RUN_INDICATOR, type AgentRunState } from "./run-status-display";

export interface AgentStatusProps {
  state: AgentRunState;
}

export function AgentStatus({ state }: AgentStatusProps) {
  const { state: indicatorState, label } = RUN_INDICATOR[state];
  return <SystemIndicator state={indicatorState} label={label} />;
}
