import { z } from "zod";

/**
 * Chat: a normal multi-turn conversation with an agent of your choosing.
 *
 * The transcript is AgentOS's own record, not the agent's. Each agent keeps
 * its session in its own format (Claude Code in `~/.claude`); a chat stores
 * the id it needs to resume that session, plus a normalised copy of what was
 * said and done, so the screen never has to understand any agent's format.
 */

export const CHAT_ID = /^chat_[a-f0-9]{32}$/;

export const MAX_CHAT_INPUT = 32_000;

/** Which harness runs the chat. Each agent brings its own tools. */
export const ChatAgentIdSchema = z.enum(["claude", "codex", "gemini", "hermes"]);

export const ChatModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** One line on when to pick it. */
  hint: z.string().optional(),
});

export const ChatAgentSchema = z.object({
  id: ChatAgentIdSchema,
  name: z.string(),
  models: z.array(ChatModelSchema).min(1),
  defaultModel: z.string(),
  available: z.boolean(),
  /** Why it cannot be used right now, in words that say how to fix it. */
  unavailableReason: z.string().optional(),
  /** Where it bills: a plan login or an API key. */
  billing: z.string().optional(),
});

export const ChatAgentsResponseSchema = z.object({ agents: z.array(ChatAgentSchema) });

/** Text the agent said. Streamed in, then stored whole. */
export const ChatTextPartSchema = z.object({ type: z.literal("text"), text: z.string() });

/** One tool the agent used, and how it went. */
export const ChatToolPartSchema = z.object({
  type: z.literal("tool"),
  id: z.string(),
  name: z.string(),
  /** A one-line, human summary of the call: the command, the file. */
  summary: z.string(),
  status: z.enum(["running", "done", "error", "denied"]),
  /** The first lines of what came back, for an error or a quick look. */
  output: z.string().optional(),
});

/** A pause for the operator's decision on a risky action. */
export const ChatApprovalPartSchema = z.object({
  type: z.literal("approval"),
  id: z.string(),
  tool: z.string(),
  summary: z.string(),
  /** Why the policy stopped to ask. */
  reason: z.string(),
  status: z.enum(["pending", "allowed", "denied", "expired"]),
});

/**
 * A planned Operator run started from the chat (`/run`, `/plan`, `/ask`).
 * The run keeps its own record and approval flow; the chat only points at it.
 */
export const ChatRunPartSchema = z.object({
  type: z.literal("run"),
  runId: z.string(),
  mode: z.enum(["ask", "plan", "run"]),
});

export const ChatPartSchema = z.discriminatedUnion("type", [ChatTextPartSchema, ChatToolPartSchema, ChatApprovalPartSchema, ChatRunPartSchema]);

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(ChatPartSchema),
  createdAt: z.string(),
  /** Assistant turns: which model answered, and what it cost. */
  model: z.string().optional(),
  costUsd: z.number().optional(),
  /** Assistant turns that did not finish: why, in a sentence. */
  error: z.string().optional(),
});

export const ChatStatusSchema = z.enum(["idle", "running"]);

export const ChatSchema = z.object({
  id: z.string().regex(CHAT_ID),
  title: z.string(),
  agent: ChatAgentIdSchema,
  model: z.string(),
  /** The agent's own session id, used to resume it on the next turn. */
  agentSessionId: z.string().optional(),
  messages: z.array(ChatMessageSchema),
  status: ChatStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** One row of the history list. */
export const ChatSummarySchema = ChatSchema.pick({
  id: true,
  title: true,
  agent: true,
  model: true,
  status: true,
  createdAt: true,
  updatedAt: true,
}).extend({ messageCount: z.number() });

export const ChatListResponseSchema = z.object({ chats: z.array(ChatSummarySchema) });

export const CreateChatSchema = z
  .object({
    agent: ChatAgentIdSchema,
    model: z.string().min(1).max(100),
  })
  .strict();

export const SendChatMessageSchema = z
  .object({
    text: z.string().trim().min(1, "Say something.").max(MAX_CHAT_INPUT),
    /** Switch model for this turn onward. */
    model: z.string().min(1).max(100).optional(),
  })
  .strict();

export const StartChatRunSchema = z
  .object({
    input: z.string().trim().min(1, "Say what you want done.").max(4_000),
    mode: z.enum(["ask", "plan", "run"]),
  })
  .strict();

export const ApprovalDecisionSchema = z.object({ decision: z.enum(["allow", "deny"]) }).strict();

export const RenameChatSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();

/**
 * What the stream sends while a turn runs. Every event carries the full
 * message being built, so a client that joins late or drops an event is
 * never out of step: it just takes the latest.
 */
export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), chatId: z.string(), message: ChatMessageSchema }),
  z.object({ type: z.literal("status"), chatId: z.string(), status: ChatStatusSchema }),
]);

export type ChatAgentId = z.infer<typeof ChatAgentIdSchema>;
export type ChatModel = z.infer<typeof ChatModelSchema>;
export type ChatAgent = z.infer<typeof ChatAgentSchema>;
export type ChatTextPart = z.infer<typeof ChatTextPartSchema>;
export type ChatToolPart = z.infer<typeof ChatToolPartSchema>;
export type ChatApprovalPart = z.infer<typeof ChatApprovalPartSchema>;
export type ChatRunPart = z.infer<typeof ChatRunPartSchema>;
export type StartChatRun = z.infer<typeof StartChatRunSchema>;
export type ChatPart = z.infer<typeof ChatPartSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatStatus = z.infer<typeof ChatStatusSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type ChatSummary = z.infer<typeof ChatSummarySchema>;
export type CreateChat = z.infer<typeof CreateChatSchema>;
export type SendChatMessage = z.infer<typeof SendChatMessageSchema>;
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
