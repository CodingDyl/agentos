import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ChatAgentsResponseSchema,
  ChatListResponseSchema,
  ChatSchema,
  ChatStreamEventSchema,
  type Chat,
  type ChatAgentId,
  type ChatSummary,
} from "@shared/chat-types";
import { readSseStream } from "@/features/agent/sse";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Chat's client, queries and live stream.
 *
 * A chat is read once, then kept current by its stream: the server sends the
 * whole chat on connect and each changed message after, and both are written
 * straight into the query cache, so every component reading the chat sees the
 * same thing without polling.
 */

export const chatAgentsKey = () => [...agentosKeys.all, "chat", "agents"] as const;
export const chatsKey = () => [...agentosKeys.all, "chat", "list"] as const;
export const chatKey = (id: string) => [...agentosKeys.all, "chat", "one", id] as const;

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(failure?.error ?? "Chat could not do that.", response.status);
  }
  return payload as T;
}

/** Always JSON: the server refuses anything else, so another site can't post here. */
const json = (body: unknown = {}, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function parseChat(payload: unknown): Chat {
  const parsed = ChatSchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The chat came back in an unexpected shape.");
  return parsed.data;
}

const chatPath = (id: string, suffix = "") => `/api/chat/chats/${encodeURIComponent(id)}${suffix}`;

export function useChatAgents() {
  return useQuery({
    queryKey: chatAgentsKey(),
    queryFn: async () => {
      const parsed = ChatAgentsResponseSchema.safeParse(await request("/api/chat/agents"));
      if (!parsed.success) throw new AgentOSRequestError("The agent list came back in an unexpected shape.");
      return parsed.data.agents;
    },
    staleTime: 60_000,
  });
}

export function useChats() {
  return useQuery({
    queryKey: chatsKey(),
    queryFn: async (): Promise<ChatSummary[]> => {
      const parsed = ChatListResponseSchema.safeParse(await request("/api/chat/chats"));
      if (!parsed.success) throw new AgentOSRequestError("The chat list came back in an unexpected shape.");
      return parsed.data.chats;
    },
  });
}

export function useChat(id: string | undefined) {
  return useQuery({
    queryKey: chatKey(id ?? "none"),
    queryFn: async () => parseChat(await request(chatPath(id ?? ""))),
    enabled: Boolean(id),
  });
}

export function useCreateChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { agent: ChatAgentId; model: string }) => parseChat(await request("/api/chat/chats", json(input))),
    onSuccess: (chat) => {
      client.setQueryData(chatKey(chat.id), chat);
      void client.invalidateQueries({ queryKey: chatsKey() });
    },
  });
}

/** Takes the chat per call: a new chat's first message goes to an id that didn't exist when the page rendered. */
export function useSendChatMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string; text: string; model?: string }) => parseChat(await request(chatPath(id, "/messages"), json(input))),
    onSuccess: (chat) => {
      client.setQueryData(chatKey(chat.id), chat);
      void client.invalidateQueries({ queryKey: chatsKey() });
    },
  });
}

/** `/run`, `/plan`, `/ask`: a planned Operator run, recorded in the chat. */
export function useStartChatRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string; input: string; mode: "ask" | "plan" | "run" }) => parseChat(await request(chatPath(id, "/runs"), json(input))),
    onSuccess: (chat) => {
      client.setQueryData(chatKey(chat.id), chat);
      void client.invalidateQueries({ queryKey: chatsKey() });
    },
  });
}

export function useStopChat(id: string | undefined) {
  return useMutation({ mutationFn: () => request(chatPath(id ?? "", "/stop"), json()) });
}

export function useDecideApproval(id: string | undefined) {
  return useMutation({
    mutationFn: (input: { approvalId: string; decision: "allow" | "deny" }) =>
      request(chatPath(id ?? "", `/approvals/${encodeURIComponent(input.approvalId)}`), json({ decision: input.decision })),
  });
}

export function useDeleteChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(chatPath(id), { method: "DELETE" }),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: chatKey(id) });
      void client.invalidateQueries({ queryKey: chatsKey() });
    },
  });
}

export type ChatConnection = "connecting" | "live" | "reconnecting";

/**
 * Keeps one chat current while it is on screen.
 *
 * Reconnects after a drop with a growing delay, and needs nothing replayed
 * when it does: the first event of every connection is the whole chat.
 */
export function useChatStream(id: string | undefined): ChatConnection {
  const client = useQueryClient();
  // Keyed by chat, so switching chats reads as "connecting" without a reset in the effect.
  const [state, setState] = useState<{ id?: string; connection: ChatConnection }>({ connection: "connecting" });
  const setConnection = (connection: ChatConnection) => setState({ id, connection });

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let attempt = 0;

    const apply = (data: string) => {
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      const snapshot = payload as { type?: string; chat?: unknown };
      if (snapshot.type === "snapshot") {
        const chat = ChatSchema.safeParse(snapshot.chat);
        if (chat.success) client.setQueryData(chatKey(id), chat.data);
        return;
      }

      const event = ChatStreamEventSchema.safeParse(payload);
      if (!event.success) return;

      client.setQueryData<Chat>(chatKey(id), (current) => {
        if (!current) return current;
        if (event.data.type === "status") return { ...current, status: event.data.status };
        const message = event.data.message;
        const index = current.messages.findIndex((entry) => entry.id === message.id);
        const messages = index === -1 ? [...current.messages, message] : current.messages.map((entry, at) => (at === index ? message : entry));
        return { ...current, messages };
      });
      // A turn ending changes the list's order and the chat's title.
      if (event.data.type === "status" && event.data.status === "idle") void client.invalidateQueries({ queryKey: chatsKey() });
    };

    const connect = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(chatPath(id, "/stream"), { signal: controller.signal, headers: { Accept: "text/event-stream" } });
          if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
          attempt = 0;
          setConnection("live");
          await readSseStream(response.body, (message) => apply(message.data));
        } catch {
          if (controller.signal.aborted) return;
        }
        if (controller.signal.aborted) return;
        setConnection("reconnecting");
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 500 * 2 ** attempt)));
      }
    };

    void connect();
    return () => controller.abort();
    // `setConnection` closes over `id`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, client]);

  return state.id === id ? state.connection : "connecting";
}
