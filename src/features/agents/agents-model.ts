import type { AgentSpend, AgentSummary } from "@shared/agent-types";

export type AgentStatusFilter = "all" | "busy" | "idle";

export function spendLabel(spend: Pick<AgentSpend, "usd" | "ceilingUsd">): string {
  const used = `$${spend.usd.toFixed(2)}`;
  if (spend.ceilingUsd <= 0) return `${used} this month`;
  return `${used} / $${spend.ceilingUsd.toFixed(0)}`;
}

export function spendRatio(spend: Pick<AgentSpend, "usd" | "ceilingUsd">): number | undefined {
  if (spend.ceilingUsd <= 0) return undefined;
  return spend.usd / spend.ceilingUsd;
}

export function spendTone(spend: Pick<AgentSpend, "usd" | "ceilingUsd">): "ink" | "amber" | "green" | "flame" {
  const ratio = spendRatio(spend);
  if (ratio === undefined) return "ink";
  if (ratio >= 1) return "flame";
  if (ratio >= 0.8) return "amber";
  return "green";
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
