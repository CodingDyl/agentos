import { useState } from "react";
import type { Chat, ChatAgent, ChatMode, ChatPageContext } from "@shared/chat-types";
import { useChat, useCreateChat, useDecideApproval, useSendChatMessage, useStartChatRun, useStopChat } from "@/lib/agentos/chat";
import { chatModelChoice, initialModelChoice, parseSlashRun, type ModelChoice } from "./chat-model";

/**
 * One conversation, wherever it is shown: the Operator page or the ⌘J panel.
 *
 * Holds what both need: the chat, the agent and model, Assistant or Coder,
 * and sending (which starts the chat on the first message). The screens
 * differ only in layout and in where a new chat goes once it exists.
 */

const REMEMBERED_MODEL = "agentos.chat.model";
const REMEMBERED_MODE = "agentos.chat.mode";

function rememberedModel(): Partial<ModelChoice> | undefined {
  try {
    const raw = window.localStorage.getItem(REMEMBERED_MODEL);
    return raw ? (JSON.parse(raw) as Partial<ModelChoice>) : undefined;
  } catch {
    return undefined;
  }
}

function rememberedMode(): ChatMode {
  try {
    return window.localStorage.getItem(REMEMBERED_MODE) === "coder" ? "coder" : "assistant";
  } catch {
    return "assistant";
  }
}

function remember(choice: ModelChoice, mode: ChatMode): void {
  try {
    window.localStorage.setItem(REMEMBERED_MODEL, JSON.stringify(choice));
    window.localStorage.setItem(REMEMBERED_MODE, mode);
  } catch {
    // Private windows and blocked storage: the defaults are fine.
  }
}

export function useChatConversation({
  chatId,
  agents,
  onCreated,
  pageContext,
}: {
  chatId?: string;
  agents: readonly ChatAgent[];
  /** A new chat now exists: show it at its own address. */
  onCreated: (id: string) => void;
  /** Where the operator is, read at the moment they send. */
  pageContext?: () => ChatPageContext | undefined;
}) {
  const chat = useChat(chatId);
  const create = useCreateChat();
  const send = useSendChatMessage();
  const startRun = useStartChatRun();
  const stop = useStopChat(chatId);
  const decide = useDecideApproval(chatId);

  const [override, setOverride] = useState<ModelChoice>();
  const [pickedMode, setPickedMode] = useState<ChatMode>(rememberedMode);

  const current: Chat | undefined = chat.data;
  const choice: ModelChoice | undefined = override ?? (current ? chatModelChoice(agents, current) : initialModelChoice(agents, rememberedModel()));
  const running = current?.status === "running";
  // A saved chat keeps its own mode; one saved before modes existed was a coder chat.
  const mode: ChatMode = current ? (current.mode ?? "coder") : pickedMode;

  /** Resolves true once sent, so the caller can clear the box. */
  const submit = async (text: string): Promise<boolean> => {
    if (!choice) return false;
    remember(choice, mode);
    try {
      let id = chatId;
      if (!id) id = (await create.mutateAsync({ ...choice, mode })).id;
      // `/run`, `/plan`, `/ask`: a planned Operator run, not a message to the agent.
      const slash = parseSlashRun(text);
      if (slash) await startRun.mutateAsync({ id, ...slash });
      else await send.mutateAsync({ id, text, model: current && choice.model !== current.model ? choice.model : undefined, context: pageContext?.() });
      if (!chatId) onCreated(id);
      return true;
    } catch {
      // Shown under the composer from the mutation's own error.
      return false;
    }
  };

  return {
    chat,
    current,
    messages: current?.messages ?? [],
    running,
    choice,
    setChoice: setOverride,
    mode,
    setMode: setPickedMode,
    submit,
    sending: create.isPending || send.isPending,
    stop,
    decide,
    error: create.error?.message ?? send.error?.message ?? startRun.error?.message ?? stop.error?.message ?? decide.error?.message,
  };
}
