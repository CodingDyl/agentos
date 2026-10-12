import { spawn } from "node:child_process";
import os from "node:os";
import type { ChatAgent, ChatModel } from "../../shared/chat-types";
import { agentEnv, findAgentBinary, searchedFolders } from "./agent-environment";
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

/** `AGENTOS_CODEX_BIN` points at a specific Codex; otherwise it is looked for on the PATH. */
function codexBinary(): Promise<string | undefined> {
  return findAgentBinary(process.env.AGENTOS_CODEX_BIN?.trim() || "codex");
}

async function connect(binary: string, cwd: string): Promise<JsonLineRpc> {
  const child = spawn(binary, ["app-server"], { cwd, env: await agentEnv(), stdio: ["pipe", "pipe", "pipe"] });
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
  // Tests describe agents constantly and must not start real ones to do it.
  if (process.env.AGENTOS_SKIP_MODEL_DISCOVERY === "1") return;
  if (refreshing || Date.now() - refreshedAt < REFRESH_MS) return;
  refreshedAt = Date.now();
  refreshing = (async () => {
    const rpc = await connect(binary, os.homedir());
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

/**
 * Available when the binary is found. Sign-in isn't checked here: newer Codex
 * keeps its login in the system keychain rather than a file AgentOS can see,
 * and a missing login is reported by Codex itself on the first message.
 */
async function describeCodex(): Promise<ChatAgent> {
  const binary = await codexBinary();
  if (binary) refreshModels(binary);
  return {
    id: "codex",
    name: "Codex",
    models: [DEFAULT_MODEL, ...cachedModels("codex")],
    defaultModel: DEFAULT_MODEL.id,
    available: Boolean(binary),
    unavailableReason: binary ? undefined : `Codex wasn't found. ${INSTALL} AgentOS looked in: ${await searchedFolders()}. Or set AGENTOS_CODEX_BIN to its full path.`,
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

interface CodexErrorNotice {
  error?: { message?: string; additionalDetails?: string | null } | null;
  willRetry?: boolean;
}

/**
 * How long Codex may keep reconnecting without making progress before the
 * turn is called off. Offline or signed out, Codex retries forever ("waiting
 * for network") and never ends the turn, which left the chat spinning.
 */
function retryLimitMs(): number {
  const configured = Number(process.env.AGENTOS_CODEX_RETRY_LIMIT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

export function codexErrorMessage(notice: CodexErrorNotice, gaveUp: boolean): string {
  const message = notice.error?.message?.trim() || "Codex stopped with an error.";
  const details = notice.error?.additionalDetails?.trim();
  const said = details && details !== message ? `${message} (${details})` : message;
  return gaveUp
    ? `Codex couldn't reach OpenAI and kept retrying, so AgentOS stopped the turn. Last word from Codex: ${said}. Check you're online and signed in (run \`codex login\`).`
    : said;
}

async function runCodexTurn(input: RunTurnInput): Promise<void> {
  const binary = await codexBinary();
  if (!binary) throw new Error(`Codex wasn't found. ${INSTALL}`);

  const rpc = await connect(binary, input.policy.projectRoot);
  const context = startCodexContext();
  const state = input.state;
  let threadId: string | undefined;
  let turnId: string | undefined;
  let finished: (result: TurnResult) => void = () => undefined;
  const completion = new Promise<TurnResult>((resolve) => (finished = resolve));

  // Codex reports trouble as `error` notifications. One it won't retry ends
  // the turn; ones it will are given a while to come right, then the turn is
  // stopped with Codex's own explanation.
  let retryTimer: NodeJS.Timeout | undefined;
  let lastRetry: CodexErrorNotice | undefined;
  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
  };
  const giveUp = (message: string) => {
    clearRetry();
    if (threadId && turnId) void rpc.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
    finished({ status: "failed", error: { message } });
  };

  rpc.onNotification((method, params) => {
    const scoped = params as { threadId?: string; turn?: TurnResult } | undefined;
    if (threadId && scoped?.threadId && scoped.threadId !== threadId) return; // A sub-agent's thread.
    if (method === "turn/completed" && scoped?.turn) {
      clearRetry();
      finished(scoped.turn);
      return;
    }
    if (method === "error") {
      const notice = (params ?? {}) as CodexErrorNotice;
      if (notice.willRetry !== true) {
        giveUp(codexErrorMessage(notice, false));
        return;
      }
      lastRetry = notice;
      retryTimer ??= setTimeout(() => giveUp(codexErrorMessage(lastRetry ?? notice, true)), retryLimitMs());
      return;
    }
    if (applyCodexEvent(state, context, method, params)) {
      clearRetry(); // Progress: whatever was failing has recovered.
      input.onChange();
    }
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
    clearRetry();
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
