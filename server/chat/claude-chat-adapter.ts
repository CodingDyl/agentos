import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query, type CanUseTool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatAgent, ChatMessage, ChatToolPart } from "../../shared/chat-types";
import { decideToolUse, summariseToolInput, type PolicyContext } from "./chat-permission-policy";

/**
 * Claude, through the Claude Agent SDK: Claude Code as a library.
 *
 * Claude Code brings its own tools (read, search, edit, shell, web, sub-agents)
 * and its own session store, so this adapter does three things only: start or
 * resume a session in the AgentOS project, put every tool call through the
 * chat permission policy, and fold what comes back into the chat transcript.
 */

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "The default. Strong at everything, including long agentic work." },
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Most capable. Slower and pricier; for the hardest problems." },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Fast and capable for everyday coding and questions." },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Quickest and cheapest, for simple asks." },
] as const;

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

/** Told once per session, on top of Claude Code's own system prompt. */
const CHAT_SYSTEM_PROMPT = `You are chatting with the operator inside AgentOS, their personal AI operating system. Your working directory is the AgentOS repository; you can read anything on this machine and change the project. Actions the operator has to approve (deleting, pushing, installing, touching credentials, writing outside the project) pause for their decision: if one is denied, say what you would have done and continue without it. Answer conversationally; this is a chat, not a report.`;

function hasPlanLogin(): boolean {
  return fs.existsSync(path.join(os.homedir(), ".claude"));
}

/**
 * The plan login when there is one, else the API key. A chat is the
 * operator's own conversation, so it goes on the operator's plan by
 * preference, exactly as the Claude Code worker does.
 */
function billing(): { env: NodeJS.ProcessEnv; label: string } | { error: string } {
  if (hasPlanLogin()) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    // Left in place, these would bill the API key AgentOS holds instead.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return { env, label: "Your Claude plan" };
  }
  if (process.env.ANTHROPIC_API_KEY) return { env: { ...process.env }, label: "Anthropic API key" };
  return { error: "Claude isn't signed in on this machine. Run `claude` once and log in, or set ANTHROPIC_API_KEY." };
}

export function describeClaudeAgent(): ChatAgent {
  const how = billing();
  return {
    id: "claude",
    name: "Claude",
    models: CLAUDE_MODELS.map((model) => ({ ...model })),
    defaultModel: DEFAULT_CLAUDE_MODEL,
    available: !("error" in how),
    unavailableReason: "error" in how ? how.error : undefined,
    billing: "label" in how ? how.label : undefined,
  };
}

// ---------------------------------------------------------------------------
// Folding the SDK's messages into one assistant turn.
// ---------------------------------------------------------------------------

/** What a turn learns besides its transcript. */
export interface ClaudeTurnState {
  message: ChatMessage;
  sessionId?: string;
  /** Assistant messages whose text arrived as stream deltas, so it isn't added twice. */
  streamed: Set<string>;
  /** The message id the deltas currently belong to. */
  streamingId?: string;
}

export function startTurn(message: ChatMessage): ClaudeTurnState {
  return { message, streamed: new Set() };
}

function lastPart(state: ClaudeTurnState) {
  return state.message.parts.at(-1);
}

function appendText(state: ClaudeTurnState, text: string): void {
  if (!text) return;
  const last = lastPart(state);
  if (last?.type === "text") last.text += text;
  else state.message.parts.push({ type: "text", text });
}

function clip(value: string, limit = 600): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
      .join("\n");
  }
  return "";
}

/**
 * Applies one SDK message to the turn. Returns true when the transcript
 * changed and is worth sending to the screen.
 *
 * Sub-agent traffic (`parent_tool_use_id` set) is left out: the sub-agent's
 * own reasoning and tool calls would bury the conversation, and its result
 * comes back to the parent as the Task tool's output anyway.
 */
export function applyClaudeMessage(state: ClaudeTurnState, message: SDKMessage): boolean {
  switch (message.type) {
    case "system": {
      if (message.subtype === "init") {
        state.sessionId = message.session_id;
        state.message.model = message.model;
      }
      return false;
    }

    case "stream_event": {
      if (message.parent_tool_use_id) return false;
      const event = message.event;
      if (event.type === "message_start") {
        state.streamingId = event.message.id;
        return false;
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (state.streamingId) state.streamed.add(state.streamingId);
        appendText(state, event.delta.text);
        return true;
      }
      return false;
    }

    case "assistant": {
      if (message.parent_tool_use_id) return false;
      let changed = false;
      const alreadyStreamed = state.streamed.has(message.message.id);

      for (const block of message.message.content) {
        if (block.type === "text" && !alreadyStreamed) {
          appendText(state, block.text);
          changed = true;
        } else if (block.type === "tool_use") {
          const input = (block.input ?? {}) as Record<string, unknown>;
          if (!state.message.parts.some((part) => part.type === "tool" && part.id === block.id)) {
            state.message.parts.push({ type: "tool", id: block.id, name: block.name, summary: summariseToolInput(block.name, input), status: "running" });
            changed = true;
          }
        }
      }
      return changed;
    }

    case "user": {
      if (message.parent_tool_use_id) return false;
      const content = message.message.content;
      if (!Array.isArray(content)) return false;
      let changed = false;

      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const part = state.message.parts.find((entry): entry is ChatToolPart => entry.type === "tool" && entry.id === block.tool_use_id);
        if (!part) continue;
        // A denial already marked the tool; the "denied" result text adds nothing.
        if (part.status !== "denied") {
          part.status = block.is_error ? "error" : "done";
          const output = clip(toolResultText(block.content));
          if (output) part.output = output;
        }
        changed = true;
      }
      return changed;
    }

    case "result": {
      state.message.costUsd = message.total_cost_usd;
      if (message.subtype !== "success") {
        state.message.error = RESULT_ERRORS[message.subtype] ?? "Claude stopped before finishing.";
      } else if (message.is_error) {
        state.message.error = message.result || "Claude reported an error.";
      }
      // Anything still marked running never reported back.
      for (const part of state.message.parts) {
        if (part.type === "tool" && part.status === "running") part.status = message.subtype === "success" ? "done" : "error";
      }
      return true;
    }

    default:
      return false;
  }
}

const RESULT_ERRORS: Record<string, string> = {
  error_max_turns: "Claude hit its turn limit before finishing. Say \"continue\" to carry on.",
  error_max_budget_usd: "Claude hit its spending limit for this turn.",
  error_during_execution: "Claude stopped with an error partway through.",
};

// ---------------------------------------------------------------------------
// Running one turn.
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  tool: string;
  summary: string;
  reason: string;
  signal: AbortSignal;
}

export interface RunClaudeTurnInput {
  prompt: string;
  model: string;
  /** The session to continue; absent for a chat's first turn. */
  resume?: string;
  policy: PolicyContext;
  state: ClaudeTurnState;
  controller: AbortController;
  /** Called whenever the transcript changed. */
  onChange: () => void;
  /** Resolves true to allow. Rejects or resolves false to deny. */
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
}

export async function runClaudeTurn(input: RunClaudeTurnInput): Promise<void> {
  const how = billing();
  if ("error" in how) throw new Error(how.error);

  const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
    const verdict = decideToolUse(toolName, toolInput, input.policy);
    if (verdict.decision === "allow") return { behavior: "allow", updatedInput: toolInput };

    const allowed = await input
      .requestApproval({ tool: toolName, summary: summariseToolInput(toolName, toolInput), reason: verdict.reason, signal: options.signal })
      .catch(() => false);

    if (allowed) return { behavior: "allow", updatedInput: toolInput };

    // Mark the call itself, so the transcript says "you said no" rather than "it failed".
    const part = input.state.message.parts.findLast((entry): entry is ChatToolPart => entry.type === "tool" && entry.name === toolName && entry.status === "running");
    if (part) part.status = "denied";
    input.onChange();
    return { behavior: "deny", message: "The operator declined this action. Carry on without it, and say what you would have done." };
  };

  const messages = query({
    prompt: input.prompt,
    options: {
      cwd: input.policy.projectRoot,
      model: input.model,
      resume: input.resume,
      abortController: input.controller,
      includePartialMessages: true,
      // Every call the allowlist doesn't cover comes to `canUseTool`.
      permissionMode: "default",
      canUseTool,
      // The operator's own Claude Code setup (CLAUDE.md, skills, MCP servers)
      // and the project's: this is their assistant, not a sandboxed worker.
      settingSources: ["user", "project"],
      systemPrompt: { type: "preset", preset: "claude_code", append: CHAT_SYSTEM_PROMPT },
      env: { ...how.env, CLAUDE_AGENT_SDK_CLIENT_APP: "agentos-chat/1.0" },
    },
  });

  for await (const message of messages) {
    if (applyClaudeMessage(input.state, message)) input.onChange();
  }
}
