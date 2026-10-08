import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { ChatAgent, ChatAgentId, ChatModel, ChatToolPart } from "../../shared/chat-types";
import { findOnPath } from "../ai-stack/detect";
import { decideAcpToolCall } from "./chat-permission-policy";
import { cachedModels, rememberModels } from "./chat-model-cache";
import { appendText, clip, DEFAULT_MODEL, findTool, oneLine, settleRunningTools, startTool, type ChatAgentAdapter, type RunTurnInput, type TurnState } from "./chat-turn";

/**
 * Any agent that speaks the Agent Client Protocol: Gemini CLI and Hermes today.
 *
 * ACP is the editor-to-agent standard (Zed's): the agent runs its own tools
 * and asks the client before anything it isn't allowed to do alone. AgentOS
 * is that client. It answers each permission request from the chat policy:
 * routine work goes through, anything risky waits for the operator.
 */

export interface AcpAgentSpec {
  id: ChatAgentId;
  name: string;
  binary: string;
  args: readonly string[];
  installHint: string;
  billing?: string;
}

const STATUS: Record<string, ChatToolPart["status"]> = {
  pending: "running",
  in_progress: "running",
  completed: "done",
  failed: "error",
};

// ---------------------------------------------------------------------------
// Folding session updates into the reply.
// ---------------------------------------------------------------------------

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      const block = entry as { type?: string; content?: { type?: string; text?: string } };
      return block.type === "content" && block.content?.type === "text" ? (block.content.text ?? "") : "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolName(update: { kind?: string | null; title?: string | null; name?: string | null }): string {
  const kind = update.kind && update.kind !== "other" ? update.kind : undefined;
  return (update.name ?? kind ?? "tool").replace(/^\w/, (letter) => letter.toUpperCase());
}

/** Applies one session update. Returns true when the reply changed. */
export function applyAcpUpdate(state: TurnState, notification: Pick<SessionNotification, "update">): boolean {
  const update = notification.update as { sessionUpdate: string; [key: string]: unknown };

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const content = update.content as { type?: string; text?: string } | undefined;
      if (content?.type !== "text" || !content.text) return false;
      appendText(state, content.text);
      return true;
    }

    case "tool_call":
    case "tool_call_update": {
      const call = update as unknown as { toolCallId: string; title?: string | null; kind?: string | null; name?: string | null; status?: string | null; content?: unknown };
      const part = findTool(state, call.toolCallId) ?? startTool(state, { id: call.toolCallId, name: toolName(call), summary: oneLine(call.title ?? "") });
      if (call.title) part.summary = oneLine(call.title);
      const status = call.status ? STATUS[call.status] : undefined;
      if (status && part.status !== "denied") part.status = status;
      const output = clip(textOf(call.content));
      if (output) part.output = output;
      return true;
    }

    default:
      return false;
  }
}

/** The models an agent offers, from its session's config options. */
export function modelOption(options: readonly SessionConfigOption[] | null | undefined): { configId: string; current: string; models: ChatModel[] } | undefined {
  const option = (options ?? []).find((entry) => entry.type === "select" && (entry.category === "model" || entry.id === "model"));
  if (!option || option.type !== "select") return undefined;

  const models: ChatModel[] = [];
  for (const entry of option.options) {
    // A select's options are either flat or grouped; groups hold their own options.
    const nested = (entry as { options?: unknown }).options;
    for (const choice of Array.isArray(nested) ? nested : [entry]) {
      const { value, name, description } = choice as { value: string; name: string; description?: string | null };
      models.push({ id: value, label: name, hint: description ? oneLine(description, 120) : undefined });
    }
  }
  return { configId: option.id, current: option.currentValue, models };
}

/** The option to send back for allow or deny. "Once" every time: the policy decides again next time. */
export function permissionResponse(request: Pick<RequestPermissionRequest, "options">, allow: boolean): RequestPermissionResponse {
  const order = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const kind of order) {
    const option = request.options.find((entry) => entry.kind === kind);
    if (option) return { outcome: { outcome: "selected", optionId: option.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

const STOP_ERRORS: Record<string, string> = {
  max_tokens: "The reply hit its length limit. Say \"continue\" to carry on.",
  max_turn_requests: "The agent hit its step limit for this turn. Say \"continue\" to carry on.",
  refusal: "The agent declined to answer that.",
};

export function createAcpAgent(spec: AcpAgentSpec): ChatAgentAdapter {
  async function describe(): Promise<ChatAgent> {
    const binary = await findOnPath(spec.binary);
    return {
      id: spec.id,
      name: spec.name,
      models: [DEFAULT_MODEL, ...cachedModels(spec.id)],
      defaultModel: DEFAULT_MODEL.id,
      available: Boolean(binary),
      unavailableReason: binary ? undefined : `${spec.name} isn't installed. ${spec.installHint}`,
      billing: spec.billing,
    };
  }

  async function runTurn(input: RunTurnInput): Promise<void> {
    const binary = await findOnPath(spec.binary);
    if (!binary) throw new Error(`${spec.name} isn't installed. ${spec.installHint}`);

    const child = spawn(binary, [...spec.args], { cwd: input.policy.projectRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4_000);
    });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

    const state = input.state;
    // While an earlier conversation is replayed on load, its updates are history, not this reply.
    let replaying = false;

    const client: Client = {
      sessionUpdate: async (notification) => {
        if (replaying) return;
        if (applyAcpUpdate(state, notification)) input.onChange();
      },
      requestPermission: async (request) => {
        const verdict = decideAcpToolCall(request.toolCall, input.policy);
        if (verdict.decision === "allow") return permissionResponse(request, true);

        const allowed = await input
          .requestApproval({ tool: toolName(request.toolCall), summary: oneLine(request.toolCall.title ?? ""), reason: verdict.reason, signal: input.controller.signal })
          .catch(() => false);
        if (!allowed) {
          const part = findTool(state, request.toolCall.toolCallId);
          if (part) part.status = "denied";
          input.onChange();
        }
        return permissionResponse(request, allowed);
      },
    };

    const connection = new ClientSideConnection(
      () => client,
      ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
    );

    let sessionId: string | undefined;
    const stop = () => {
      if (sessionId) void connection.cancel({ sessionId }).catch(() => undefined);
      setTimeout(() => child.kill("SIGTERM"), 2_000).unref();
    };
    input.controller.signal.addEventListener("abort", stop, { once: true });

    const explain = (error: unknown) => {
      const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
      const tail = stderr.trim().split("\n").filter(Boolean).slice(-2).join(" ");
      return new Error(message || tail || `${spec.name} failed.`, { cause: error });
    };

    try {
      const init = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        // The agent uses its own file and terminal tools; AgentOS only answers permissions.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });

      const where = { cwd: input.policy.projectRoot, mcpServers: [] };
      let configOptions: SessionConfigOption[] | null | undefined;

      if (input.resume) {
        try {
          if (init.agentCapabilities?.sessionCapabilities && "resume" in init.agentCapabilities.sessionCapabilities && init.agentCapabilities.sessionCapabilities.resume) {
            configOptions = (await connection.resumeSession({ sessionId: input.resume, ...where })).configOptions;
          } else if (init.agentCapabilities?.loadSession) {
            replaying = true;
            configOptions = (await connection.loadSession({ sessionId: input.resume, ...where })).configOptions;
          } else {
            throw new Error("This agent can't reopen a conversation.");
          }
          sessionId = input.resume;
        } catch {
          sessionId = undefined;
        } finally {
          replaying = false;
        }
      }

      if (!sessionId) {
        const created = await connection.newSession(where);
        sessionId = created.sessionId;
        configOptions = created.configOptions;
        if (input.resume) appendText(state, `_${spec.name} couldn't reopen the earlier part of this chat, so it starts fresh from here._\n\n`);
      }
      state.sessionId = sessionId;

      const models = modelOption(configOptions);
      if (models) {
        rememberModels(spec.id, models.models);
        if (input.model !== DEFAULT_MODEL.id && input.model !== models.current && models.models.some((model) => model.id === input.model)) {
          await connection.setSessionConfigOption({ sessionId, configId: models.configId, value: input.model });
        }
      }
      state.message.model = input.model === DEFAULT_MODEL.id ? (models?.current ?? undefined) : input.model;

      const result = await connection.prompt({ sessionId, prompt: [{ type: "text", text: input.prompt }] });
      const error = STOP_ERRORS[result.stopReason];
      if (error) state.message.error = error;
      settleRunningTools(state, result.stopReason === "end_turn" ? "done" : "error");
    } catch (error) {
      if (input.controller.signal.aborted) throw error;
      throw explain(error);
    } finally {
      input.controller.signal.removeEventListener("abort", stop);
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }

  return { id: spec.id, name: spec.name, describe, runTurn };
}

export const geminiAgent = createAcpAgent({
  id: "gemini",
  name: "Gemini",
  binary: "gemini",
  args: ["--acp"],
  installHint: "Install it with `npm install -g @google/gemini-cli`, then run `gemini` once to sign in.",
  billing: "Your Google account",
});

export const hermesAgent = createAcpAgent({
  id: "hermes",
  name: "Hermes",
  binary: "hermes",
  args: ["acp"],
  installHint: "Install Hermes Agent with its ACP extra and make sure `hermes` is on your PATH.",
  billing: "Hermes' configured provider",
});
