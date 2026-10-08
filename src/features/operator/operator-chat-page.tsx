import { History, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Chat, ChatAgent } from "@shared/chat-types";
import { AppShell } from "@/components/os";
import { PAPER_FOCUS } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import {
  useChat,
  useChatAgents,
  useChats,
  useChatStream,
  useCreateChat,
  useDecideApproval,
  useDeleteChat,
  useSendChatMessage,
  useStopChat,
} from "@/lib/agentos/chat";
import { cn } from "@/lib/utils";
import { ChatComposer } from "./chat-composer";
import { ChatHistorySidebar } from "./chat-history-sidebar";
import { initialModelChoice, modelLabel, type ModelChoice } from "./chat-model";
import { ChatThread } from "./chat-thread";

/**
 * Operator, as a chat: pick an agent and a model, and talk to it.
 *
 * The agent works in the AgentOS project with its own tools. It reads freely
 * and edits the project freely; anything risky (deleting, pushing,
 * installing, credentials, writing outside the project) pauses in the
 * conversation for your OK. History is on the left, and "New chat" is a
 * clean slate that keeps the old conversation to come back to.
 *
 * `/operator` is a fresh chat; `/operator/chats/:chatId` is a saved one.
 * Planned Operator runs keep their own view at `/operator/runs`.
 */

const REMEMBERED = "agentos.chat.model";

function remembered(): Partial<ModelChoice> | undefined {
  try {
    const raw = window.localStorage.getItem(REMEMBERED);
    return raw ? (JSON.parse(raw) as Partial<ModelChoice>) : undefined;
  } catch {
    return undefined;
  }
}

function remember(choice: ModelChoice): void {
  try {
    window.localStorage.setItem(REMEMBERED, JSON.stringify(choice));
  } catch {
    // Private windows and blocked storage: the default model is fine.
  }
}

const SUGGESTIONS = [
  "What changed in AgentOS in the last five commits?",
  "Find why `npm run lint` fails and fix it",
  "Explain how worker routing decides which agent runs a job",
  "What's in my Downloads folder that I could delete?",
];

export function OperatorChatPage() {
  const navigationItems = useNavigationItems();
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const agents = useChatAgents();
  const chats = useChats();
  const remove = useDeleteChat();

  const sidebar = (onNavigate?: () => void) => (
    <ChatHistorySidebar
      chats={chats.data ?? []}
      activeId={chatId}
      loading={chats.isPending}
      error={chats.error?.message}
      onNewChat={() => {
        onNavigate?.();
        navigate("/operator");
      }}
      onDelete={(id) =>
        remove.mutate(id, {
          onSuccess: () => {
            if (id === chatId) navigate("/operator");
          },
        })
      }
      deletingId={remove.isPending ? remove.variables : undefined}
      onNavigate={onNavigate}
    />
  );

  return (
    <AppShell navigationItems={navigationItems} pageId="operator" activeHref="/operator" modelLabel="Model / AgentOS V1">
      <div className="flex h-full min-h-0 bg-background font-paper-ui text-paper-moss">
        <aside className="hidden w-64 shrink-0 border-r border-paper-mist bg-paper-white md:block">{sidebar()}</aside>

        {drawerOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button type="button" aria-label="Close chat history" className="absolute inset-0 cursor-default bg-paper-moss/30" onClick={() => setDrawerOpen(false)} />
            <div role="dialog" aria-modal="true" aria-label="Chat history" className="absolute inset-y-0 left-0 w-[min(85vw,300px)] border-r border-paper-mist bg-paper-white">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close chat history"
                className={cn("absolute top-3 right-3 z-10 inline-flex size-8 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-stone", PAPER_FOCUS)}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
              <div className="h-full pt-12">{sidebar(() => setDrawerOpen(false))}</div>
            </div>
          </div>
        ) : null}

        {/* Keyed by chat: switching chats starts the composer and model choice fresh. */}
        <ChatWorkspace key={chatId ?? "new"} chatId={chatId} agents={agents.data ?? []} agentsError={agents.error?.message} onOpenHistory={() => setDrawerOpen(true)} />
      </div>
    </AppShell>
  );
}

function ChatWorkspace({
  chatId,
  agents,
  agentsError,
  onOpenHistory,
}: {
  chatId?: string;
  agents: readonly ChatAgent[];
  agentsError?: string;
  onOpenHistory: () => void;
}) {
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const connection = useChatStream(chatId);
  const create = useCreateChat();
  const send = useSendChatMessage();
  const stop = useStopChat(chatId);
  const decide = useDecideApproval(chatId);

  const [input, setInput] = useState("");
  const [override, setOverride] = useState<ModelChoice>();

  const current: Chat | undefined = chat.data;
  const choice: ModelChoice | undefined = override ?? (current ? { agent: current.agent, model: current.model } : initialModelChoice(agents, remembered()));
  const running = current?.status === "running";
  const messages = current?.messages ?? [];

  // Follow the conversation as it grows, the way any chat does.
  const bottom = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const growth = `${messages.length}:${last?.parts.length ?? 0}:${last?.parts.map((part) => (part.type === "text" ? part.text.length : part.status)).join(",")}`;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [growth]);

  const submit = async (text: string) => {
    if (!choice) return;
    remember(choice);
    try {
      let id = chatId;
      if (!id) {
        id = (await create.mutateAsync(choice)).id;
      }
      await send.mutateAsync({ id, text, model: current && choice.model !== current.model ? choice.model : undefined });
      setInput("");
      if (!chatId) navigate(`/operator/chats/${encodeURIComponent(id)}`);
    } catch {
      // Shown under the composer from the mutation's own error.
    }
  };

  const error = create.error?.message ?? send.error?.message ?? stop.error?.message ?? decide.error?.message ?? agentsError;

  return (
    <section aria-label="Chat" className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-paper-stone px-4 py-3 sm:px-8">
        <button
          type="button"
          onClick={onOpenHistory}
          aria-label="Open chat history"
          className={cn("inline-flex size-9 shrink-0 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-stone md:hidden", PAPER_FOCUS)}
        >
          <History className="size-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-paper-utility text-[11.5px] font-medium tracking-[0.14em] text-paper-sage uppercase">Operator</p>
          <h1 data-heading="compact" className="truncate text-paper-moss">{current?.title ?? "New chat"}</h1>
        </div>
        {choice ? <span className="hidden shrink-0 text-[12.5px] text-paper-sage sm:inline">{modelLabel(agents, choice.agent, choice.model)}</span> : null}
        {chatId && connection === "reconnecting" ? (
          <span role="status" className="shrink-0 text-[12px] text-paper-marigold">
            Reconnecting…
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[820px] py-8">
          {chatId && chat.isPending ? (
            <div aria-busy="true" className="h-24 bg-paper-cream motion-safe:animate-pulse" />
          ) : chatId && chat.error ? (
            <p role="alert" className="text-[14px] text-paper-flame-deep">
              {chat.error.message}
            </p>
          ) : messages.length === 0 ? (
            <EmptyChat onPick={setInput} />
          ) : (
            <ChatThread
              messages={messages}
              running={running}
              deciding={decide.isPending}
              onDecide={(approvalId, decision) => decide.mutate({ approvalId, decision })}
            />
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[820px]">
          <ChatComposer
            agents={agents}
            choice={choice}
            onChoiceChange={setOverride}
            value={input}
            onValueChange={setInput}
            onSubmit={(text) => void submit(text)}
            sending={create.isPending || send.isPending}
            running={running}
            onStop={() => stop.mutate()}
            stopping={stop.isPending}
            error={error}
            autoFocusKey={chatId ?? "new"}
          />
        </div>
      </div>
    </section>
  );
}

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="pt-[8vh]">
      <h2 className="font-paper-display text-[26px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[32px]">What can I help with?</h2>
      <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
        Ask anything. It works in the AgentOS project and can read anything on this machine; it asks before deleting, pushing, installing, touching credentials or changing files outside the project.
      </p>
      <ul className="mt-6 grid gap-2 sm:grid-cols-2" aria-label="Suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => onPick(suggestion)}
              className={cn("w-full cursor-pointer border border-paper-mist bg-paper-white px-4 py-3 text-left text-[13.5px] leading-5 text-paper-char transition-colors hover:bg-paper-cream hover:text-paper-moss", PAPER_FOCUS)}
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
