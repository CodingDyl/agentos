import { History, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ChatAgent, ChatMode } from "@shared/chat-types";
import { AppShell, DedsecLoader } from "@/components/os";
import { PAPER_FOCUS } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useChatAgents, useChats, useChatStream, useDeleteChat } from "@/lib/agentos/chat";
import { cn } from "@/lib/utils";
import { ChatComposer } from "./chat-composer";
import { ChatHistorySidebar } from "./chat-history-sidebar";
import { modelLabel } from "./chat-model";
import { ChatThread } from "./chat-thread";
import { useChatConversation } from "./use-chat-conversation";
import { useChatJarvis } from "./use-chat-jarvis";

/**
 * Operator, as a chat: pick what kind of chat, an agent and a model, and talk to it.
 *
 * An Assistant chat is everyday help, in its own vault folder with a light
 * setup. A Coder chat works in the AgentOS project with the operator's full
 * Claude Code setup. Either reads freely and edits its own folder freely;
 * anything risky (deleting, pushing, installing, credentials, writing outside
 * its folder) pauses in the conversation for your OK. History is on the left, and "New chat" is a
 * clean slate that keeps the old conversation to come back to.
 *
 * `/operator` is a fresh chat; `/operator/chats/:chatId` is a saved one.
 * Planned Operator runs keep their own view at `/operator/runs`.
 */

const SUGGESTIONS: Record<ChatMode, string[]> = {
  assistant: [
    "What's in my Downloads folder that I could delete?",
    "Draft a friendly nudge to a client whose invoice is two weeks late",
    "What happened in AI this week that I should know about?",
    "Turn these notes into a short to-do list for tomorrow",
  ],
  coder: [
    "What changed in AgentOS in the last five commits?",
    "Find why `npm run lint` fails and fix it",
    "Explain how worker routing decides which agent runs a job",
    "Add a loading state to the Mail inbox",
  ],
};

const EMPTY_COPY: Record<ChatMode, string> = {
  assistant:
    "Quick answers, drafts, the web and your files, from the agent and model you pick below. It works in its own folder in your vault, and asks before deleting, installing, touching credentials or changing anything outside it. Tell it about yourself in ABOUT-ME.md there.",
  coder:
    "Works on the AgentOS code with your full Claude Code setup: skills, hooks and MCP servers. It reads anything on this machine and edits the project freely; it asks before deleting, pushing, installing, touching credentials or changing files outside the project. Use /plan, /run or /ask for a planned Operator run.",
};

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
  const connection = useChatStream(chatId);
  const conversation = useChatConversation({ chatId, agents, onCreated: (id) => navigate(`/operator/chats/${encodeURIComponent(id)}`) });
  const { chat, current, messages, running, choice, mode, stop, decide } = conversation;
  const [input, setInput] = useState("");

  // Follow the conversation as it grows, the way any chat does.
  const bottom = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const growth = `${messages.length}:${last?.parts.length ?? 0}:${last?.parts.map((part) => (part.type === "text" ? part.text.length : part.type === "run" ? part.runId : part.status)).join(",")}`;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [growth]);

  const submit = async (text: string) => {
    if (await conversation.submit(text)) setInput("");
  };

  const agentName = agents.find((agent) => agent.id === choice?.agent)?.name ?? "The agent";
  const voice = useChatJarvis({
    chat: current,
    agentName,
    send: (text) => void submit(text),
    stop: () => stop.mutate(),
    decide: (approvalId, decision) => decide.mutate({ approvalId, decision }),
    newChat: () => navigate("/operator"),
  });
  const voiceUsable = voice.jarvis.voice?.enabled === true && voice.jarvis.voice.configured === true;

  const error = conversation.error ?? agentsError;

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
        <button
          type="button"
          onClick={() => voice.setNarrating(!voice.narrating)}
          aria-pressed={voice.narrating}
          title={voiceUsable ? "Hold Ctrl to talk. Say allow, don't allow, stop or new chat." : "Jarvis reads replies here; add a voice to hear them."}
          className={cn(
            "inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 px-2 text-[12.5px] transition-colors hover:bg-paper-stone",
            PAPER_FOCUS,
            voice.narrating ? "text-paper-moss" : "text-paper-sage",
          )}
        >
          {voice.narrating ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
          <span className="hidden lg:inline">{voice.narrating ? "Jarvis reads replies" : "Jarvis quiet"}</span>
        </button>
        {chatId && connection === "reconnecting" ? (
          <span role="status" className="shrink-0 text-[12px] text-paper-marigold">
            Reconnecting…
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[820px] py-8">
          {chatId && chat.isPending ? (
            <DedsecLoader variant="compact" />
          ) : chatId && chat.error ? (
            <p role="alert" className="text-[14px] text-paper-flame-deep">
              {chat.error.message}
            </p>
          ) : messages.length === 0 ? (
            <EmptyChat mode={mode} onPick={setInput} />
          ) : (
            <ChatThread
              messages={messages}
              running={running}
              deciding={decide.isPending}
              onDecide={(approvalId, decision) => decide.mutate({ approvalId, decision })}
              onOpenRun={(runId) => navigate(`/operator/runs/${encodeURIComponent(runId)}`)}
              onRunAgain={(text) => void submit(`/run ${text}`)}
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
            onChoiceChange={conversation.setChoice}
            value={input}
            onValueChange={setInput}
            onSubmit={(text) => void submit(text)}
            sending={conversation.sending}
            running={running}
            onStop={() => stop.mutate()}
            stopping={stop.isPending}
            error={error}
            autoFocusKey={chatId ?? "new"}
            lockedAgent={current?.agent}
            mode={mode}
            onModeChange={conversation.setMode}
            modeLocked={current !== undefined}
          />
        </div>
      </div>
    </section>
  );
}

function EmptyChat({ mode, onPick }: { mode: ChatMode; onPick: (text: string) => void }) {
  return (
    <div className="pt-[8vh]">
      <h2 className="font-paper-display text-[26px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[32px]">What can I help with?</h2>
      <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">{EMPTY_COPY[mode]}</p>
      <ul className="mt-6 grid gap-2 sm:grid-cols-2" aria-label="Suggestions">
        {SUGGESTIONS[mode].map((suggestion) => (
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
