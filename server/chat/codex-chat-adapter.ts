import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatAgent, ChatModel } from "../../shared/chat-types";
import { findOnPath } from "../ai-stack/detect";
import { classifyBashCommand, decideFileChanges } from "./chat-permission-policy";
import { cachedModels, rememberModels } from "./chat-model-cache";
import { JsonLineRpc, RpcError } from "./json-line-rpc";
import {
  appendText,
  clip,
  DEFAULT_MODEL,
  findTool,
  oneLine,
  settleRunningTools,
  startTool,
  type ChatAgentAdapter,
  type RunTurnInput,
  type TurnState,
} from "./chat-turn";

/**
 * Codex, through its app-server: JSON-RPC over stdio.
 *
 * `codex exec` can't stop to ask anyone, so it would have to either refuse
 * every risky command or run them all. The app-server sends an approval
 * request instead, which this adapter answers from the same policy as every
 * other agent: safe commands and project edits go straight through, anything
 * else waits for the operator.
 *
 * Full access is the sandbox setting (`danger-full-access`); "approve risky"
 * is the approval policy (`untrusted`, which has Codex ask about everything it
 * doesn't itself consider safe) combined with that policy.
 */

const INSTALL = "Install Codex with `npm install -g @openai/codex`, then run `codex login`.";

function signedIn(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) || fs.existsSync(path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "auth.json"));
}

function connect(binary: string, cwd: string): JsonLineRpc {
  const child = spawn(binary, ["app-server"], { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  return new JsonLineRpc(child);
}

async function initialize(rpc: JsonLineRpc): Promise<void> {
  await rpc.request("initialize", {
    clientInfo: { name: "agentos", title: "AgentOS", version: "1.0" },
    capabilities: { experimentalApi: false, requestAttestation: false },
  });
  rpc.notify("initialized");
}

// ---------------------------------------------------------------------------
// Models, from Codex itself.
// ---------------------------------------------------------------------------

interface CodexModel {
  id: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
}

export function modelsFromCatalogue(data: readonly CodexModel[]): ChatModel[] {
  return data
    .filter((model) => !model.hidden && model.id)
    .map((model) => ({ id: model.id, label: model.displayName || model.id, hint: model.description ? oneLine(model.description, 120) : undefined }));
}

let refreshing: Promise<void> | undefined;
let refreshedAt = 0;
const REFRESH_MS = 10 * 60 * 1000;

/** Asks Codex which models it offers. Never more than every ten minutes; never blocks a screen. */
function refreshModels(binary: string): void {
  if (refreshing || Date.now() - refreshedAt < REFRESH_MS) return;
  refreshedAt = Date.now();
  const rpc = connect(binary, os.homedir());
  refreshing = (async () => {
    try {
      await initialize(rpc);
      const result = await rpc.request<{ data: CodexModel[] }>("model/list", {});
      rememberModels("codex", modelsFromCatalogue(result.data ?? []));
    } catch (error) {
      console.error("[agentos] chat: Codex didn't list its models:", error instanceof Error ? error.message : error);
    } finally {
      rpc.close();
      refreshing = undefined;
    }
  })();
}

async function describeCodex(): Promise<ChatAgent> {
  const binary = await findOnPath("codex");
  if (binary) refreshModels(binary);
  const available = Boolean(binary) && signedIn();
  return {
    id: "codex",
    name: "Codex",
    models: [DEFAULT_MODEL, ...cachedModels("codex")],
    defaultModel: DEFAULT_MODEL.id,
    available,
    unavailableReason: !binary ? `Codex isn't installed. ${INSTALL}` : !signedIn() ? "Codex isn't signed in. Run `codex login`." : undefined,
    billing: "Your ChatGPT plan",
  };
}

// ---------------------------------------------------------------------------
// Folding Codex's events into the reply.
// ---------------------------------------------------------------------------

export interface CodexTurnContext {
  /** Agent messages whose text arrived as deltas, so it isn't added twice. */
  streamed: Set<string>;
  /** Files each pending change touches, for answering its approval. */
  changePaths: Map<string, string[]>;
}

export function startCodexContext(): CodexTurnContext {
  return { streamed: new Set(), changePaths: new Map() };
}

type Item = { type: string; id: string; [key: string]: unknown };

const STATUS: Record<string, "running" | "done" | "error" | "denied"> = {
  inProgress: "running",
  completed: "done",
  failed: "error",
  declined: "denied",
};

function describeItem(item: Item): { name: string; summary: string } | undefined {
  switch (item.type) {
    case "commandExecution":
      return { name: "Bash", summary: oneLine(String(item.command ?? "")) };
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? (item.changes as Array<{ path?: string }>) : [];
      return { name: "Edit", summary: oneLine(changes.map((change) => change.path).filter(Boolean).join(", ")) };
    }
    case "mcpToolCall":
      return { name: `${String(item.server ?? "mcp")}.${String(item.tool ?? "tool")}`, summary: oneLine(JSON.stringify(item.arguments ?? {})) };
    case "webSearch":
      return { name: "WebSearch", summary: oneLine(String(item.query ?? "")) };
    default:
      return undefined;
  }
}

/** Applies one notification. Returns true when the reply changed. */
export function applyCodexEvent(state: TurnState, context: CodexTurnContext, method: string, params: unknown): boolean {
  const data = (params ?? {}) as { delta?: string; itemId?: string; item?: Item };

  if (method === "item/agentMessage/delta" && typeof data.delta === "string") {
    if (data.itemId) context.streamed.add(data.itemId);
    appendText(state, data.delta);
    return true;
  }

  const item = data.item;
  if (!item) return false;

  if (method === "item/started") {
    if (item.type === "fileChange") {
      const changes = Array.isArray(item.changes) ? (item.changes as Array<{ path?: string }>) : [];
      context.changePaths.set(item.id, changes.map((change) => change.path ?? "").filter(Boolean));
    }
    const shown = describeItem(item);
    if (!shown) return false;
    startTool(state, { id: item.id, ...shown });
    return true;
  }

  if (method === "item/completed") {
    if (item.type === "agentMessage") {
      if (context.streamed.has(item.id) || typeof item.text !== "string") return false;
      appendText(state, item.text);
      return true;
    }
    const shown = describeItem(item);
    if (!shown) return false;
    const part = startTool(state, { id: item.id, ...shown });
    const status = STATUS[String(item.status)];
    // A tool the operator declined stays declined, whatever Codex calls it.
    if (status && part.status !== "denied") part.status = status;
    const output = typeof item.aggregatedOutput === "string" ? clip(item.aggregatedOutput) : undefined;
    if (output) part.output = output;
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Running one turn.
// ---------------------------------------------------------------------------

interface TurnResult {
  status: string;
  error?: { message?: string } | null;
}

async function runCodexTurn(input: RunTurnInput): Promise<void> {
  const binary = await findOnPath("codex");
  if (!binary) throw new Error(`Codex isn't installed. ${INSTALL}`);

  const rpc = connect(binary, input.policy.projectRoot);
  const context = startCodexContext();
  const state = input.state;
  let threadId: string | undefined;
  let turnId: string | undefined;
  let finished: (result: TurnResult) => void = () => undefined;
  const completion = new Promise<TurnResult>((resolve) => (finished = resolve));

  rpc.onNotification((method, params) => {
    const scoped = params as { threadId?: string; turn?: TurnResult } | undefined;
    if (threadId && scoped?.threadId && scoped.threadId !== threadId) return; // A sub-agent's thread.
    if (method === "turn/completed" && scoped?.turn) {
      finished(scoped.turn);
      return;
    }
    if (applyCodexEvent(state, context, method, params)) input.onChange();
  });

  const deny = (itemId: string) => {
    const part = findTool(state, itemId);
    if (part) part.status = "denied";
    input.onChange();
  };

  rpc.onRequest(async (method, params) => {
    const request = (params ?? {}) as { itemId?: string; command?: string | null; reason?: string | null };
    const itemId = request.itemId ?? "";

    if (method === "item/commandExecution/requestApproval") {
      const command = request.command ?? "";
      const verdict = classifyBashCommand(command);
      if (verdict.decision === "allow") return { decision: "accept" };
      const allowed = await input.requestApproval({ tool: "Bash", summary: oneLine(command), reason: verdict.reason, signal: input.controller.signal }).catch(() => false);
      if (!allowed) deny(itemId);
      return { decision: allowed ? "accept" : "decline" };
    }

    if (method === "item/fileChange/requestApproval") {
      const paths = context.changePaths.get(itemId) ?? [];
      const verdict = decideFileChanges(paths, input.policy);
      if (verdict.decision === "allow") return { decision: "accept" };
      const allowed = await input.requestApproval({ tool: "Edit", summary: oneLine(paths.join(", ")), reason: verdict.reason, signal: input.controller.signal }).catch(() => false);
      if (!allowed) deny(itemId);
      return { decision: allowed ? "accept" : "decline" };
    }

    // Wider sandbox permissions, questions for the user, MCP forms: the chat
    // already runs with full access, and nothing else is answered blind.
    throw new RpcError(`AgentOS chat doesn't answer ${method}.`, -32601);
  });

  const stop = () => {
    if (threadId && turnId) void rpc.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
    // Give Codex a moment to wind down the turn, then end the process regardless.
    setTimeout(() => rpc.close(), 2_000).unref();
  };
  input.controller.signal.addEventListener("abort", stop, { once: true });

  try {
    await initialize(rpc);

    const thread = {
      cwd: input.policy.projectRoot,
      approvalPolicy: "untrusted",
      sandbox: "danger-full-access",
      ...(input.model !== DEFAULT_MODEL.id ? { model: input.model } : {}),
    };

    let started: { thread: { id: string } };
    if (input.resume) {
      try {
        started = await rpc.request("thread/resume", { threadId: input.resume, ...thread });
      } catch {
        // Codex no longer has that conversation (deleted, or another machine's). Say so rather than pretend.
        started = await rpc.request("thread/start", thread);
        appendText(state, "_Codex couldn't reopen the earlier part of this chat, so it starts fresh from here._\n\n");
      }
    } else {
      started = await rpc.request("thread/start", thread);
    }
    threadId = started.thread.id;
    state.sessionId = threadId;

    const turn = await rpc.request<{ turn: { id: string } }>("turn/start", {
      threadId,
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
    });
    turnId = turn.turn.id;

    const result = await completion;
    if (result.status === "failed") state.message.error = result.error?.message ?? "Codex stopped with an error.";
    settleRunningTools(state, result.status === "completed" ? "done" : "error");
  } catch (error) {
    if (input.controller.signal.aborted) throw error;
    throw new Error(error instanceof Error ? error.message : "Codex failed.", { cause: error });
  } finally {
    input.controller.signal.removeEventListener("abort", stop);
    rpc.close();
  }
}

export const codexAgent: ChatAgentAdapter = {
  id: "codex",
  name: "Codex",
  describe: describeCodex,
  runTurn: runCodexTurn,
};
