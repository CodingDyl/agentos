import type { ChatAgent, ChatAgentId, ChatMessage, ChatToolPart } from "../../shared/chat-types";
import type { PolicyContext } from "./chat-permission-policy";

/**
 * What every chat agent implements, and the transcript helpers they share.
 *
 * Each agent drives its own harness (Claude Code, Codex, Gemini CLI, Hermes)
 * with its own tools. The chat service only needs three things from any of
 * them: describe yourself, run one turn into this reply, and ask the operator
 * before anything the policy calls risky. Everything else is the agent's own.
 */

/** One turn's live state: the reply being written, and the session to resume next time. */
export interface TurnState {
  message: ChatMessage;
  sessionId?: string;
}

export interface ApprovalRequest {
  tool: string;
  summary: string;
  reason: string;
  signal: AbortSignal;
}

export interface RunTurnInput {
  prompt: string;
  /** The model id, or `default` for whatever the agent is configured to use. */
  model: string;
  /** The agent's own session to continue; absent on a chat's first turn. */
  resume?: string;
  policy: PolicyContext;
  state: TurnState;
  controller: AbortController;
  /** Called whenever the transcript changed. */
  onChange: () => void;
  /** Resolves true to allow. Resolves false (or rejects) to deny. */
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
}

export interface ChatAgentAdapter {
  id: ChatAgentId;
  name: string;
  describe(): Promise<ChatAgent>;
  runTurn(input: RunTurnInput): Promise<void>;
}

/** The model an agent uses when the operator hasn't picked one. */
export const DEFAULT_MODEL = { id: "default", label: "Default", hint: "Whatever this agent is configured to use." } as const;

export function appendText(state: TurnState, text: string): void {
  if (!text) return;
  const last = state.message.parts.at(-1);
  if (last?.type === "text") last.text += text;
  else state.message.parts.push({ type: "text", text });
}

export function findTool(state: TurnState, id: string): ChatToolPart | undefined {
  return state.message.parts.find((part): part is ChatToolPart => part.type === "tool" && part.id === id);
}

/** Adds a tool call once, however many times the agent reports it starting. */
export function startTool(state: TurnState, part: Omit<ChatToolPart, "type" | "status"> & { status?: ChatToolPart["status"] }): ChatToolPart {
  const existing = findTool(state, part.id);
  if (existing) return existing;
  const created: ChatToolPart = { type: "tool", status: "running", ...part };
  state.message.parts.push(created);
  return created;
}

export function clip(value: string, limit = 600): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

export function oneLine(value: string, limit = 160): string {
  const line = value.trim().split("\n")[0] ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** Tools still marked running when a turn ends never reported back. */
export function settleRunningTools(state: TurnState, status: "done" | "error"): void {
  for (const part of state.message.parts) {
    if (part.type === "tool" && part.status === "running") part.status = status;
  }
}
