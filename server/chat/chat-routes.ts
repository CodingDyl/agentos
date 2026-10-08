import express, { type NextFunction, type Request, type Response } from "express";
import { ApprovalDecisionSchema, CreateChatSchema, RenameChatSchema, SendChatMessageSchema, StartChatRunSchema, type ChatStreamEvent } from "../../shared/chat-types";
import { isChatId } from "./chat-store";
import {
  ChatNotFoundError,
  ChatStateError,
  createChat,
  decideApproval,
  getChat,
  listAgents,
  listChats,
  removeChat,
  renameChat,
  sendMessage,
  startChatRun,
  stopChat,
  subscribe,
} from "./chat-service";

/**
 * `/api/chat`: conversations with an agent that can act on this machine.
 *
 * These routes can run shell commands, so they take one more precaution than
 * the rest of the API. The server only listens on loopback, and writes must be
 * JSON (so a plain cross-site form can't post here). Neither stops DNS
 * rebinding, where a hostile page points its own hostname at 127.0.0.1 and
 * becomes "same-origin". Checking that Host and Origin both name loopback does.
 */
export const chatRouter = express.Router();

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function requireLoopback(request: Request, response: Response, next: NextFunction): void {
  const host = request.headers.host ?? "";
  const origin = request.headers.origin;
  let originHost: string | undefined;
  if (origin) {
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = "";
    }
  }
  // Tauri serves the desktop app from its own scheme, which is not a website.
  const tauri = origin !== undefined && /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/i.test(origin);

  if (!LOOPBACK_HOST.test(host) || (originHost !== undefined && !tauri && !LOOPBACK_HOST.test(originHost))) {
    response.status(403).json({ error: "Chat only answers this machine." });
    return;
  }
  next();
}

/** Writes must be JSON: a plain cross-site form can't send that without a preflight this server never grants. */
function requireJson(request: Request, response: Response, next: NextFunction): void {
  if (request.method !== "GET" && request.method !== "DELETE" && !request.is("application/json")) {
    response.status(415).json({ error: "Send chat requests as application/json." });
    return;
  }
  next();
}

chatRouter.use(requireLoopback);
chatRouter.use(requireJson);

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof ChatNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof ChatStateError) {
    response.status(409).json({ error: error.message });
    return;
  }
  console.error(`[agentos] chat: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}.` });
}

function chatId(request: Request, response: Response): string | undefined {
  const id = String(request.params.id ?? "");
  if (isChatId(id)) return id;
  response.status(404).json({ error: "That chat doesn't exist." });
  return undefined;
}

chatRouter.get("/agents", async (_request, response) => {
  try {
    response.json({ agents: await listAgents() });
  } catch (error) {
    fail(response, error, "list the agents");
  }
});

chatRouter.get("/chats", async (_request, response) => {
  try {
    response.json({ chats: await listChats() });
  } catch (error) {
    fail(response, error, "read your chats");
  }
});

chatRouter.post("/chats", async (request, response) => {
  const parsed = CreateChatSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Send { agent, model }." });
    return;
  }
  try {
    response.status(201).json(await createChat(parsed.data));
  } catch (error) {
    fail(response, error, "start a chat");
  }
});

chatRouter.get("/chats/:id", async (request, response) => {
  const id = chatId(request, response);
  if (!id) return;
  try {
    response.json(await getChat(id));
  } catch (error) {
    fail(response, error, "read the chat");
  }
});

chatRouter.patch("/chats/:id", async (request, response) => {
  const id = chatId(request, response);
  if (!id) return;
  const parsed = RenameChatSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Send { title }." });
    return;
  }
  try {
    response.json(await renameChat(id, parsed.data.title));
  } catch (error) {
    fail(response, error, "rename the chat");
  }
});

chatRouter.delete("/chats/:id", async (request, response) => {
  const id = chatId(request, response);
  if (!id) return;
  try {
    await removeChat(id);
    response.status(204).end();
  } catch (error) {
    fail(response, error, "delete the chat");
  }
});

chatRouter.post("/chats/:id/messages", async (request, response) => {
  const id = chatId(request, response);
  if (!id) return;
  const parsed = SendChatMessageSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Send { text }." });
    return;
  }
  try {
    response.status(202).json(await sendMessage(id, parsed.data));
  } catch (error) {
    fail(response, error, "send the message");
  }
});

/** `/run`, `/plan` or `/ask` from the composer: a planned Operator run, recorded in the chat. */
chatRouter.post("/chats/:id/runs", async (request, response) => {
  const id = chatId(request, response);
  if (!id) return;
  const parsed = StartChatRunSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Send { input, mode }." });
    return;
  }
  try {
    response.status(202).json(await startChatRun(id, parsed.data));
  } catch (error) {
    fail(response, error, "start the run");
  }
});

chatRouter.post("/chats/:id/stop", (request, response) => {
  const id = chatId(request, response);
  if (!id) return;
  try {
    stopChat(id);
    response.status(202).json({ stopping: true });
  } catch (error) {
    fail(response, error, "stop the chat");
  }
});

chatRouter.post("/chats/:id/approvals/:approvalId", (request, response) => {
  const id = chatId(request, response);
  if (!id) return;
  const parsed = ApprovalDecisionSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Send { decision: \"allow\" | \"deny\" }." });
    return;
  }
  try {
    decideApproval(id, String(request.params.approvalId), parsed.data.decision === "allow");
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "answer the approval");
  }
});

/**
 * Live changes to one chat, as server-sent events. The first event is the
 * whole chat as it stands, so a screen that connects mid-turn, or reconnects
 * after a drop, starts from the truth rather than from wherever it left off.
 */
chatRouter.get("/chats/:id/stream", async (request, response) => {
  const id = chatId(request, response);
  if (!id) return;

  let chat;
  try {
    chat = await getChat(id);
  } catch (error) {
    fail(response, error, "open the chat");
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: ChatStreamEvent | { type: "snapshot"; chat: typeof chat }) => {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: "snapshot", chat });
  const unsubscribe = subscribe(id, send);
  // Proxies and browsers drop a silent connection; a comment line keeps it open.
  const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 20_000);

  request.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});
