import type { ActiveWorkItem } from "@shared/mission-control-types";
import type { LiveAgent } from "@shared/usage-types";

/**
 * What each node on the agent network is doing.
 *
 * Kept apart from the diagram so the rule is testable on its own: a worker is
 * working if Operations says it is running *or* a live task names it. A task
 * recorded as running that nothing is executing (usually after a restart) is
 * "uncertain": shown and linked, never animated.
 */

export type NodeState = "running" | "uncertain" | "ready" | "offline";

export interface WorkerNodeModel {
  agent: LiveAgent;
  state: NodeState;
  /** The task this worker is on, when it is on one. */
  task?: ActiveWorkItem;
}

/** A live task wins over one recorded as running that nothing is executing. */
export function pickTask(items: readonly ActiveWorkItem[]): ActiveWorkItem | undefined {
  return items.find((item) => !item.uncertain) ?? items[0];
}

export function toNode(agent: LiveAgent, activeWork: readonly ActiveWorkItem[]): WorkerNodeModel {
  const task = pickTask(activeWork.filter((item) => item.agent === agent.agent));

  if (agent.state === "running" || (task && !task.uncertain)) return { agent, state: "running", task };
  if (task) return { agent, state: "uncertain", task };
  return { agent, state: agent.state };
}
