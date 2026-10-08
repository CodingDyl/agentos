import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Chat, ChatAgent, ChatApprovalPart, ChatMessage, ChatStreamEvent, CreateChat, SendChatMessage } from "../../shared/chat-types";
import type { ActiveWorkItem } from "../../shared/mission-control-types";
import { createChatId, deleteChat, listChats, readChat, saveChat, titleFrom } from "./chat-store";
import { describeClaudeAgent, runClaudeTurn, startTurn, type ApprovalRequest } from "./claude-chat-adapter";

/**
 * Chats: one conversation each, one turn running at a time per chat.
 *
 * The file on disk is the record; the in-memory entry exists only while a
 * turn runs, holding what a file can't: the abort controller, the screens
 * listening for changes, and approvals waiting on the operator.
 */

/** The AgentOS repository: a chat's working directory and the edge of "inside the project". */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export class ChatStateError extends Error {}
export class ChatNotFoundError extends Error {}

type Listener = (event: ChatStreamEvent) => void;

interface PendingApproval {
  part: ChatApprovalPart;
  resolve: (allowed: boolean) => void;
}

interface ActiveTurn {
  chat: Chat;
  controller: AbortController;
  approvals: Map<string, PendingApproval>;
  /** Coalesces a burst of stream deltas into one screen update. */
  flush?: NodeJS.Timeout;
  settled?: Promise<void>;
}

const active = new Map<string, ActiveTurn>();

/** The agent behind every turn. Swapped only by tests, which can't call a real model. */
let runTurn: typeof runClaudeTurn = runClaudeTurn;

export function setTurnRunnerForTests(runner: typeof runClaudeTurn | undefined): void {
  runTurn = runner ?? runClaudeTurn;
}

/** Resolves when a chat's turn has fully settled and been saved. For tests and shutdown. */
export function turnSettled(id: string): Promise<void> {
  return active.get(id)?.settled ?? Promise.resolve();
}
const listeners = new Map<string, Set<Listener>>();

const now = () => new Date().toISOString();

function emit(chatId: string, event: ChatStreamEvent): void {
  for (const listener of listeners.get(chatId) ?? []) listener(event);
}

export function subscribe(chatId: string, listener: Listener): () => void {
  const set = listeners.get(chatId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(chatId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(chatId);
  };
}

export function listAgents(): ChatAgent[] {
  return [describeClaudeAgent()];
}

function agentFor(id: Chat["agent"]): ChatAgent {
  const agent = listAgents().find((entry) => entry.id === id);
  if (!agent) throw new ChatStateError(`There is no ${id} agent.`);
  return agent;
}

function checkModel(agent: ChatAgent, model: string): void {
  if (!agent.models.some((entry) => entry.id === model)) throw new ChatStateError(`${agent.name} has no model called ${model}.`);
}

export async function createChat(input: CreateChat): Promise<Chat> {
  checkModel(agentFor(input.agent), input.model);
  const at = now();
  return saveChat({ id: createChatId(), title: "New chat", agent: input.agent, model: input.model, messages: [], status: "idle", createdAt: at, updatedAt: at });
}

export async function getChat(id: string): Promise<Chat> {
  // A running chat's live copy is ahead of its file between saves.
  const live = active.get(id)?.chat;
  if (live) return live;
  const chat = await readChat(id);
  if (!chat) throw new ChatNotFoundError("That chat doesn't exist.");
  return chat;
}

export { listChats };

export async function renameChat(id: string, title: string): Promise<Chat> {
  const chat = await getChat(id);
  chat.title = title;
  chat.updatedAt = now();
  return saveChat(chat);
}

export async function removeChat(id: string): Promise<void> {
  if (active.has(id)) stopChat(id);
  if (!(await deleteChat(id))) throw new ChatNotFoundError("That chat doesn't exist.");
}

function scheduleFlush(turn: ActiveTurn, message: ChatMessage): void {
  if (turn.flush) return;
  turn.flush = setTimeout(() => {
    turn.flush = undefined;
    emit(turn.chat.id, { type: "message", chatId: turn.chat.id, message });
  }, 50);
}

function requestApproval(turn: ActiveTurn, message: ChatMessage, request: ApprovalRequest): Promise<boolean> {
  const part: ChatApprovalPart = { type: "approval", id: `approval_${randomUUID()}`, tool: request.tool, summary: request.summary, reason: request.reason, status: "pending" };
  message.parts.push(part);
  emit(turn.chat.id, { type: "message", chatId: turn.chat.id, message });
  void saveChat(turn.chat);

  return new Promise<boolean>((resolve) => {
    const settle = (allowed: boolean, status: ChatApprovalPart["status"]) => {
      if (!turn.approvals.delete(part.id)) return;
      part.status = status;
      emit(turn.chat.id, { type: "message", chatId: turn.chat.id, message });
      void saveChat(turn.chat);
      resolve(allowed);
    };
    turn.approvals.set(part.id, { part, resolve: (allowed) => settle(allowed, allowed ? "allowed" : "denied") });
    // Stopped, or the agent moved on: the question no longer stands.
    request.signal.addEventListener("abort", () => settle(false, "expired"), { once: true });
  });
}

export async function sendMessage(id: string, input: SendChatMessage): Promise<Chat> {
  if (active.has(id)) throw new ChatStateError("This chat is still answering. Wait for it, or stop it first.");
  const chat = await readChat(id);
  if (!chat) throw new ChatNotFoundError("That chat doesn't exist.");

  const agent = agentFor(chat.agent);
  if (!agent.available) throw new ChatStateError(agent.unavailableReason ?? `${agent.name} isn't available.`);
  if (input.model) {
    checkModel(agent, input.model);
    chat.model = input.model;
  }

  const at = now();
  if (chat.messages.length === 0) chat.title = titleFrom(input.text);
  chat.messages.push({ id: `msg_${randomUUID()}`, role: "user", parts: [{ type: "text", text: input.text }], createdAt: at });
  const reply: ChatMessage = { id: `msg_${randomUUID()}`, role: "assistant", parts: [], createdAt: at, model: chat.model };
  chat.messages.push(reply);
  chat.status = "running";
  chat.updatedAt = at;

  const turn: ActiveTurn = { chat, controller: new AbortController(), approvals: new Map() };
  active.set(id, turn);
  await saveChat(chat);
  emit(id, { type: "status", chatId: id, status: "running" });

  const state = startTurn(reply);

  turn.settled = runTurn({
    prompt: input.text,
    model: chat.model,
    resume: chat.agentSessionId,
    policy: { projectRoot: PROJECT_ROOT },
    state,
    controller: turn.controller,
    onChange: () => scheduleFlush(turn, reply),
    requestApproval: (request) => requestApproval(turn, reply, request),
  })
    .catch((error: unknown) => {
      if (turn.controller.signal.aborted) {
        reply.error ??= "Stopped.";
      } else {
        console.error(`[agentos] chat ${id}: turn failed:`, error);
        reply.error ??= error instanceof Error ? error.message : "The turn failed.";
      }
    })
    .finally(async () => {
      if (turn.flush) clearTimeout(turn.flush);
      for (const pending of [...turn.approvals.values()]) pending.resolve(false);
      if (state.sessionId) chat.agentSessionId = state.sessionId;
      chat.status = "idle";
      chat.updatedAt = now();
      active.delete(id);
      await saveChat(chat).catch((error: unknown) => console.error(`[agentos] chat ${id}: could not save:`, error));
      emit(id, { type: "message", chatId: id, message: reply });
      emit(id, { type: "status", chatId: id, status: "idle" });
    });

  return chat;
}

/**
 * Chats answering right now, for the "working" indicator every screen shows.
 * Observed rather than inferred: a turn is in this map only while this
 * process is running it, so it is never marked uncertain.
 */
export function activeChatWork(): ActiveWorkItem[] {
  return [...active.values()].map(({ chat }) => {
    const asked = chat.messages.findLast((message) => message.role === "user");
    const waiting = chat.messages.at(-1)?.parts.some((part) => part.type === "approval" && part.status === "pending");
    const agent = listAgents().find((entry) => entry.id === chat.agent);
    const model = agent?.models.find((entry) => entry.id === chat.model)?.label ?? chat.model;
    return {
      id: chat.id,
      actor: `CHAT · ${(agent?.name ?? chat.agent).toUpperCase()}`,
      // Chat lives in Operator, so it lights the hub on the agent network.
      agent: "operator",
      title: chat.title,
      detail: waiting ? "Waiting for your OK" : model,
      startedAt: asked?.createdAt ?? chat.updatedAt,
      href: `/operator/chats/${chat.id}`,
      uncertain: false,
    };
  });
}

export function decideApproval(chatId: string, approvalId: string, allowed: boolean): void {
  const pending = active.get(chatId)?.approvals.get(approvalId);
  if (!pending) throw new ChatStateError("That approval has already been answered or no longer applies.");
  pending.resolve(allowed);
}

export function stopChat(id: string): void {
  const turn = active.get(id);
  if (!turn) throw new ChatStateError("This chat isn't running.");
  turn.controller.abort();
}

/**
 * Chats a previous process left mid-turn. Nothing is executing them, so
 * they are settled with a note rather than left "running" forever.
 */
export async function reconcileChats(): Promise<void> {
  for (const summary of await listChats()) {
    if (summary.status !== "running" || active.has(summary.id)) continue;
    const chat = await readChat(summary.id);
    if (!chat) continue;
    const last = chat.messages.at(-1);
    if (last?.role === "assistant") {
      last.error ??= "AgentOS restarted while this reply was in progress.";
      for (const part of last.parts) {
        if (part.type === "tool" && part.status === "running") part.status = "error";
        if (part.type === "approval" && part.status === "pending") part.status = "expired";
      }
    }
    chat.status = "idle";
    await saveChat(chat);
  }
}
