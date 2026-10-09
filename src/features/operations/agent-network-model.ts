import type { ActiveWorkItem } from "@shared/mission-control-types";
import type { LiveAgent } from "@shared/usage-types";

/**
 * What each node on the agent network is doing.
 *
 * Kept apart from the diagram so the rule is testable on its own, and so the
 * graph header and the Working On list cannot invent two answers. Activity
 * comes from jobs (`activeWork`). Operations' `live` list is who exists and
 * whether they are reachable — not a second clock for "is it working".
 *
 * A task recorded as running that nothing is executing (usually after a
 * restart, or a Claude Motion pid that was never claimed) is "uncertain":
 * shown, linked, never animated.
 */

export type NodeState = "running" | "uncertain" | "ready" | "offline";

export interface WorkerNodeModel {
  agent: LiveAgent;
  state: NodeState;
  /** Every current job this worker is on. Clicking the node lists these. */
  tasks: ActiveWorkItem[];
  /** The task this worker is on, when it is on one — the live one if any. */
  task?: ActiveWorkItem;
}

export interface NetworkCounts {
  running: number;
  unconfirmed: number;
  ready: number;
  offline: number;
}

/** Fold labels, actor stamps and ids onto the same key: `Claude Code` = `claude-code`. */
export function agentKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return key.length > 0 ? key : undefined;
}

export function sameAgent(left: string | undefined, right: string | undefined): boolean {
  const a = agentKey(left);
  const b = agentKey(right);
  return a !== undefined && a === b;
}

function itemKeys(item: ActiveWorkItem): string[] {
  return [item.agent, item.actor].map(agentKey).filter((key): key is string => key !== undefined);
}

export function tasksForAgent(agent: LiveAgent, activeWork: readonly ActiveWorkItem[]): ActiveWorkItem[] {
  const id = agentKey(agent.agent);
  const label = agentKey(agent.label);
  return activeWork.filter((item) => itemKeys(item).some((key) => key === id || key === label));
}

/** A live task wins over one recorded as running that nothing is executing. */
export function pickTask(items: readonly ActiveWorkItem[]): ActiveWorkItem | undefined {
  return items.find((item) => !item.uncertain) ?? items[0];
}

export function toNode(agent: LiveAgent, activeWork: readonly ActiveWorkItem[]): WorkerNodeModel {
  const tasks = tasksForAgent(agent, activeWork);
  const task = pickTask(tasks);

  if (task && !task.uncertain) return { agent, state: "running", task, tasks };
  if (task) return { agent, state: "uncertain", task, tasks };
  return { agent, state: agent.state === "offline" ? "offline" : "ready", tasks };
}

export function networkCounts(nodes: readonly WorkerNodeModel[]): NetworkCounts {
  return {
    running: nodes.filter((node) => node.state === "running").length,
    unconfirmed: nodes.filter((node) => node.state === "uncertain").length,
    ready: nodes.filter((node) => node.state === "ready").length,
    offline: nodes.filter((node) => node.state === "offline").length,
  };
}

/** The graph header. Unconfirmed is named only when there is something to hedge. */
export function formatNetworkCounts(counts: NetworkCounts): string {
  const parts = [`${counts.running} running`];
  if (counts.unconfirmed > 0) parts.push(`${counts.unconfirmed} unconfirmed`);
  parts.push(`${counts.ready} ready`, `${counts.offline} offline`);
  return parts.join(" · ");
}

export function lastSeenAt(item: ActiveWorkItem): string {
  return item.lastSeenAt ?? item.startedAt;
}
