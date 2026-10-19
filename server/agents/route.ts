import {
  type AgentRecord,
  type AgentRouteDecision,
} from "../../shared/agent-types";
import type { ModelRouteEffort, ModelRoutingTable } from "../../shared/model-routing-types";
import type { WorkerJobRequest } from "../../shared/worker-types";
import { answerAs, isJevConfigured, sendToJev, type JevAnswer, type JevRequestBody } from "../mail/jev-client";
import { isAiEnabled } from "../ai-stack/settings";
import { AgentIdSchema } from "../../shared/agent-types";
import { getAgentRecord, listAgentRecords } from "./store";
import { agentIdForFlow, DEFAULT_AGENT_ID } from "./seeds";

/**
 * Which specialist owns a job, and what of theirs applies at launch.
 *
 * Tagged flows win. Free-form text goes through Jev when it is on, then a
 * keyword heuristic. The job always leaves with an agentId — Chief of Staff
 * is the fallback, never an unowned job.
 */

const ROUTING_JEV_MS = 2_000;

export interface ResolveAgentInput {
  objective: string;
  project?: string;
  agentId?: string;
  flow?: string;
  send?: typeof sendToJev;
}

export async function resolveAgentAssignment(input: ResolveAgentInput): Promise<{
  decision: AgentRouteDecision;
  agent: AgentRecord;
  error?: undefined;
} | { decision?: undefined; agent?: undefined; error: string }> {
  const tagged = input.agentId?.trim() || agentIdForFlow(input.flow);
  if (tagged) {
    const agent = getAgentRecord(tagged);
    if (!agent) return { error: `There is no agent called ${tagged}.` };
    return {
      agent,
      decision: {
        agentId: agent.id,
        source: "tagged",
        reason: input.agentId?.trim()
          ? `Tagged as ${agent.name} by the flow that created the job.`
          : `The ${input.flow} flow is owned by ${agent.name}.`,
      },
    };
  }

  const agents = listAgentRecords();
  if (agents.length === 0) return { error: "The agent registry is empty." };

  const send = input.send;
  if (shouldRouteWithJev(send)) {
    try {
      const fromJev = send
        ? await classifyAgentWithJev(input.objective, agents, send)
        : await withTimeout(classifyAgentWithJev(input.objective, agents, sendToJev), ROUTING_JEV_MS);
      if (fromJev) {
        const agent = getAgentRecord(fromJev.agentId) ?? agents.find((entry) => entry.id === fromJev.agentId);
        if (agent) return { agent, decision: fromJev };
      }
    } catch {
      // Jev is a convenience. A failed call must not block a job.
    }
  }

  const agent = heuristicAgent(input.objective, input.project, agents);
  return {
    agent,
    decision: {
      agentId: agent.id,
      source: "heuristic",
      reason: `Read as ${agent.name}'s work from the brief.`,
    },
  };
}

export function shouldRouteWithJev(send?: typeof sendToJev): boolean {
  if (send) return true;
  return isJevConfigured() && isAiEnabled("jev");
}

export function heuristicAgent(
  objective: string,
  project: string | undefined,
  agents: readonly AgentRecord[],
): AgentRecord {
  const fallback = agents.find((agent) => agent.id === DEFAULT_AGENT_ID) ?? agents[0];
  let best = fallback;
  let bestScore = scoreAgent(fallback, objective, project);

  for (const agent of agents) {
    if (agent.id === fallback.id) continue;
    const score = scoreAgent(agent, objective, project);
    if (score > bestScore) {
      best = agent;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : fallback;
}

function scoreAgent(agent: AgentRecord, objective: string, project: string | undefined): number {
  const haystack = `${objective}\n${project ?? ""}`.toLowerCase();
  let score = 0;
  if (project && agent.linkedWorkspaces.includes(project)) score += 8;
  if (haystack.includes(agent.name.toLowerCase())) score += 5;
  if (haystack.includes(agent.id.replace(/-/g, " "))) score += 4;
  for (const word of agent.keywords) {
    if (word && haystack.includes(word.toLowerCase())) score += 3;
  }
  for (const word of agent.role.toLowerCase().split(/\W+/).filter((part) => part.length > 3)) {
    if (haystack.includes(word)) score += 1;
  }
  return score;
}

async function classifyAgentWithJev(
  objective: string,
  agents: readonly AgentRecord[],
  send: typeof sendToJev,
): Promise<AgentRouteDecision | undefined> {
  const criteria: Record<string, string> = {};
  for (const agent of agents) {
    criteria[agent.id] = `${agent.name} — ${agent.role}. ${agent.mission}`;
  }

  const body: JevRequestBody = {
    model: "jev-latest",
    state: { brief: objective.slice(0, 2_000) },
    questions: {
      agentId: {
        type: "choice",
        instructions:
          "Which AgentOS specialist should own this brief? Pick the single best fit. Prefer Chief of Staff when the work is routing, follow-up, or does not clearly belong to one specialist.",
        criteria,
      },
    },
  };

  const response = await send(body);
  const answer = answerAs(response.answers as Record<string, JevAnswer>, "agentId", "choice");
  const parsed = AgentIdSchema.safeParse(answer.choice);
  if (!parsed.success) return undefined;
  if (!agents.some((agent) => agent.id === parsed.data)) return undefined;

  return {
    agentId: parsed.data,
    source: "jev",
    reason: `Jev assigned this to ${parsed.data}.`,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ApplyAgentLaunchInput {
  agent: AgentRecord;
  request: WorkerJobRequest;
  /** False on retry: the original brief is frozen. */
  brief?: boolean;
}

/**
 * Overlay the specialist's model, effort, tools, skill allowlist and brief.
 *
 * Approvals are not decided here. A disallowed skill is refused; a disallowed
 * model override is dropped in favour of the agent's default.
 */
export function applyAgentLaunchPolicy(input: ApplyAgentLaunchInput): {
  request: WorkerJobRequest;
  table: Partial<ModelRoutingTable>;
  error?: string;
} {
  const { agent, request } = input;
  const brief = input.brief !== false;

  if (request.skillId && agent.allowedSkills.length > 0 && !agent.allowedSkills.includes(request.skillId)) {
    return {
      request,
      table: agent.modelRoutes,
      error: `${agent.name} is not allowed to use the ${request.skillId} skill.`,
    };
  }

  const override = request.modelOverride?.trim();
  const allowed = agent.allowedModelOverrides;
  const modelOverride =
    override && (allowed.length === 0 || allowed.includes(override)) ? override : undefined;

  const extraAllowedTools = unique([...(request.extraAllowedTools ?? []), ...agent.allowedTools]);
  const constraints = brief
    ? [
        `Owned by ${agent.name} (${agent.id}). ${agent.role}`,
        ...(agent.standingInstructions ? [agent.standingInstructions] : []),
        ...(agent.memoryNotes ? [`Memory notes: ${agent.memoryNotes}`] : []),
        ...(request.constraints ?? []),
      ]
    : request.constraints;

  return {
    table: agent.modelRoutes,
    request: {
      ...request,
      agentId: agent.id,
      modelOverride,
      effort: request.effort ?? agent.effort,
      extraAllowedTools: extraAllowedTools.length > 0 ? extraAllowedTools : undefined,
      constraints,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export type { ModelRouteEffort };
