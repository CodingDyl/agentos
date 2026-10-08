import type { ChatAgent, ChatSummary } from "@shared/chat-types";

/**
 * The chat page's small decisions, kept apart from its components so they are
 * testable: how history is grouped, and which model a new chat starts on.
 */

export interface ChatGroup {
  label: string;
  chats: ChatSummary[];
}

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Today, Yesterday, Previous 7 days, Older: the grouping every chat app has taught people to read. */
export function groupChats(chats: readonly ChatSummary[], now: Date = new Date()): ChatGroup[] {
  const today = dayStart(now);
  const day = 24 * 60 * 60 * 1000;
  const groups: ChatGroup[] = [
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Previous 7 days", chats: [] },
    { label: "Older", chats: [] },
  ];

  for (const chat of chats) {
    const at = Date.parse(chat.updatedAt);
    const index = Number.isNaN(at) ? 3 : at >= today ? 0 : at >= today - day ? 1 : at >= today - 7 * day ? 2 : 3;
    groups[index].chats.push(chat);
  }

  return groups.filter((group) => group.chats.length > 0);
}

export interface ModelChoice {
  agent: ChatAgent["id"];
  model: string;
}

/**
 * What a new chat starts on: the last choice the operator made, if that agent
 * and model still exist and the agent can be used; otherwise the first usable
 * agent's default.
 */
export function initialModelChoice(agents: readonly ChatAgent[], remembered?: Partial<ModelChoice>): ModelChoice | undefined {
  const known = agents.find((agent) => agent.id === remembered?.agent && agent.available);
  if (known && known.models.some((model) => model.id === remembered?.model)) {
    return { agent: known.id, model: remembered?.model as string };
  }
  const first = agents.find((agent) => agent.available) ?? agents[0];
  return first ? { agent: first.id, model: first.defaultModel } : undefined;
}

export function modelLabel(agents: readonly ChatAgent[], agentId: string, modelId: string): string {
  const agent = agents.find((entry) => entry.id === agentId);
  const model = agent?.models.find((entry) => entry.id === modelId);
  return model ? `${agent?.name} ${model.label}` : modelId;
}
