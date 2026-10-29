import { Maximize2, MessageSquarePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ChatPageContext } from "@shared/chat-types";
import { DedsecLoader } from "@/components/os";
import { PAPER_FOCUS } from "@/components/paper";
import { projectInContext } from "@/features/agent/command-catalog";
import { ChatComposer } from "@/features/operator/chat-composer";
import { ChatThread } from "@/features/operator/chat-thread";
import { useChatConversation } from "@/features/operator/use-chat-conversation";
import { useChatAgents, useChatStream } from "@/lib/agentos/chat";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { CHAT_PANEL_ID, useChatPanel } from "./chat-panel-context";
import { screenTitle } from "./chat-panel-model";

/**
 * The ⌘J chat, over whatever screen you are on.
 *
 * The same conversation as Operator (same chats, agents, approvals), in a
 * panel down the right edge, so asking something doesn't mean leaving what
 * you were doing. Each message carries where you are: the screen, what is
 * open on it, and anything you had selected, so "summarise this" works.
 */

const SUGGESTIONS = ["What's on today?", "Does anything in my mail need me?", "What should I work on next?"];

function snippet(text: string, limit = 60): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

export function ChatPanel() {
  const panel = useChatPanel();
  if (!panel.isOpen) return null;
  // Keyed by chat: a new chat starts the composer and model choice fresh.
  return <ChatPanelBody key={panel.chatId ?? "new"} />;
}

function ChatPanelBody() {
  const panel = useChatPanel();
  const navigate = useNavigate();
  const location = useLocation();
  const agents = useChatAgents();
  const { data: projects } = useProjects();
  const chatId = panel.chatId;
  const connection = useChatStream(chatId);
  const [input, setInput] = useState("");
  const [withContext, setWithContext] = useState(true);

  const title = screenTitle(location.pathname);
  const slug = projectInContext(location.pathname, location.search);
  const workspace = slug ? projects?.projects.find((project) => project.slug === slug) : undefined;
  const details = [workspace ? `Workspace "${workspace.name}" (slug ${workspace.slug}). ${workspace.status ?? ""}`.trim() : undefined, ...panel.details].filter(
    (entry): entry is string => Boolean(entry),
  );

  const pageContext = (): ChatPageContext | undefined =>
    withContext
      ? {
          path: `${location.pathname}${location.search}`,
          title: workspace ? `${workspace.name} workspace` : title,
          detail: details.length > 0 ? details.join("\n").slice(0, 2_000) : undefined,
          selection: panel.selection,
        }
      : undefined;

  const conversation = useChatConversation({ chatId, agents: agents.data ?? [], onCreated: panel.setChatId, pageContext });
  const { chat, current, messages, running, stop, decide } = conversation;

  // A remembered chat that has since been deleted: start a new one instead.
  const missing = chatId !== undefined && chat.isError;
  useEffect(() => {
    if (missing) panel.setChatId(undefined);
  }, [missing, panel]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") panel.close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panel]);

  const bottom = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const growth = `${messages.length}:${last?.parts.length ?? 0}:${last?.parts.map((part) => (part.type === "text" ? part.text.length : part.type === "run" ? part.runId : part.status)).join(",")}`;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [growth]);

  const submit = async (text: string) => {
    if (await conversation.submit(text)) {
      setInput("");
      // The selection was about that message; the next one starts clean.
      panel.clearSelection();
      setWithContext(true);
    }
  };

  const contextLabel = [workspace ? workspace.name : title, panel.selection ? `"${snippet(panel.selection, 40)}"` : undefined, panel.details.length > 0 ? snippet(panel.details[0], 40) : undefined]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      id={CHAT_PANEL_ID}
      role="dialog"
      aria-label="Chat"
      className="fixed inset-y-0 right-0 z-40 flex w-[min(100vw,460px)] flex-col border-l border-paper-mist bg-paper-white font-paper-ui text-paper-moss shadow-[-16px_0_40px_-24px_rgb(0_0_0/0.45)] motion-safe:animate-[chat-panel-in_180ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      <header className="flex items-center gap-2 border-b border-paper-stone py-2.5 pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-paper-display text-[16px] leading-6 font-bold tracking-[-0.01em]">{current?.title ?? "Ask AgentOS"}</h2>
          {chatId && connection === "reconnecting" ? (
            <p role="status" className="text-[12px] text-paper-marigold">
              Reconnecting…
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => panel.setChatId(undefined)}
          disabled={!chatId}
          title="New chat"
          aria-label="New chat"
          className={cn("inline-flex size-9 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-stone disabled:cursor-default disabled:opacity-40", PAPER_FOCUS)}
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            panel.close();
            navigate(chatId ? `/operator/chats/${encodeURIComponent(chatId)}` : "/operator");
          }}
          title="Open in Operator, with your chat history"
          aria-label="Open in Operator"
          className={cn("inline-flex size-9 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-stone", PAPER_FOCUS)}
        >
          <Maximize2 className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={panel.close}
          title="Close (Esc)"
          aria-label="Close chat"
          className={cn("inline-flex size-9 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-stone", PAPER_FOCUS)}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="py-5">
          {chatId && chat.isPending ? (
            <DedsecLoader variant="compact" />
          ) : messages.length === 0 ? (
            <div className="pt-6">
              <p className="font-paper-display text-[22px] leading-[1.15] font-extrabold tracking-[-0.015em]">What do you need?</p>
              <p className="mt-2 text-[13.5px] leading-6 text-paper-char">
                Ask about what's on this screen, or anything else. Your day, mail, notes and projects are a question away.
              </p>
              <ul className="mt-4 space-y-1.5" aria-label="Suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => setInput(suggestion)}
                      className={cn("w-full cursor-pointer border border-paper-mist px-3 py-2 text-left text-[13.5px] text-paper-char transition-colors duration-150 hover:bg-paper-cream hover:text-paper-moss", PAPER_FOCUS)}
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ChatThread
              messages={messages}
              running={running}
              deciding={decide.isPending}
              onDecide={(approvalId, decision) => decide.mutate({ approvalId, decision })}
              onOpenRun={(runId) => {
                panel.close();
                navigate(`/operator/runs/${encodeURIComponent(runId)}`);
              }}
              onRunAgain={(text) => void submit(`/run ${text}`)}
            />
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="px-4">
        <div className="flex min-h-7 items-center gap-1.5 pt-2 text-[12px] text-paper-sage">
          {withContext ? (
            <>
              <span className="min-w-0 truncate" title="Sent with your message, so 'this' means what's on screen">
                With: <span className="text-paper-char">{contextLabel}</span>
              </span>
              <button
                type="button"
                onClick={() => setWithContext(false)}
                aria-label="Don't send this screen with the next message"
                className={cn("inline-flex size-6 shrink-0 cursor-pointer items-center justify-center hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setWithContext(true)} className={cn("cursor-pointer underline-offset-2 hover:text-paper-moss hover:underline", PAPER_FOCUS)}>
              Include this screen
            </button>
          )}
        </div>
        <ChatComposer
          agents={agents.data ?? []}
          choice={conversation.choice}
          onChoiceChange={conversation.setChoice}
          value={input}
          onValueChange={setInput}
          onSubmit={(text) => void submit(text)}
          sending={conversation.sending}
          running={running}
          onStop={() => stop.mutate()}
          stopping={stop.isPending}
          error={conversation.error ?? agents.error?.message}
          autoFocusKey={chatId ?? "new"}
          lockedAgent={current?.agent}
          mode={conversation.mode}
          onModeChange={conversation.setMode}
          modeLocked={current !== undefined}
        />
      </div>
    </section>
  );
}
