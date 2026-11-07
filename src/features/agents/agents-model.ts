import type { AgentSummary } from "@shared/agent-types";

export type AgentStatusFilter = "all" | "busy" | "idle";

export function jobsLabel(jobs: number): string {
  return `${jobs} ${jobs === 1 ? "job" : "jobs"} this month`;
}

export function filterAgents(
  agents: readonly AgentSummary[],
  filters: { status: AgentStatusFilter; workspace: string; query: string },
): AgentSummary[] {
  const needle = filters.query.trim().toLowerCase();
  return agents.filter((agent) => {
    if (filters.status === "busy" && agent.openJobs === 0) return false;
    if (filters.status === "idle" && agent.openJobs > 0) return false;
    if (filters.workspace !== "all" && !agent.linkedWorkspaces.includes(filters.workspace)) return false;
    if (!needle) return true;
    return [agent.name, agent.role, agent.mission, agent.id, ...agent.keywords, ...agent.linkedWorkspaces]
      .some((value) => value.toLowerCase().includes(needle));
  });
}

export function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function csv(values: readonly string[]): string {
  return values.join(", ");
}
