import { History, MessageSquarePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ChatSummary } from "@shared/chat-types";
import { PAPER_FOCUS, PaperButton } from "@/components/paper";
import { cn } from "@/lib/utils";
import { groupChats } from "./chat-model";

/**
 * Every chat, newest first, and the button for a clean slate.
 *
 * "New chat" never deletes anything: the previous conversation stays here to
 * go back to. Deleting is its own, deliberate act, confirmed in place.
 */
export function ChatHistorySidebar({
  chats,
  activeId,
  loading,
  error,
  onNewChat,
  onDelete,
  deletingId,
  onNavigate,
}: {
  chats: readonly ChatSummary[];
  activeId?: string;
  loading: boolean;
  error?: string;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  deletingId?: string;
  /** Closes the drawer on small screens after picking a chat. */
  onNavigate?: () => void;
}) {
  const [confirming, setConfirming] = useState<string>();
  const groups = groupChats(chats);

  return (
    <nav aria-label="Chat history" className="flex h-full min-h-0 flex-col">
      <div className="border-b border-paper-stone p-3">
        <PaperButton variant="amber" className="w-full" onClick={onNewChat}>
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          New chat
        </PaperButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div aria-busy="true" className="m-1 h-24 bg-paper-cream motion-safe:animate-pulse" />
        ) : error ? (
          <p role="alert" className="p-2 text-[13px] text-paper-flame-deep">
            {error}
          </p>
        ) : groups.length === 0 ? (
          <p className="flex items-start gap-2 p-2 text-[13px] leading-5 text-paper-sage">
            <History className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Your chats will appear here.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="mb-3">
              <h3 className="px-2 pt-2 pb-1 font-paper-utility text-[11px] font-medium tracking-[0.12em] text-paper-sage uppercase">{group.label}</h3>
              <ul className="space-y-px">
                {group.chats.map((chat) => {
                  const active = chat.id === activeId;
                  return (
                    <li key={chat.id} className="group/row relative">
                      {confirming === chat.id ? (
                        <div className="flex items-center gap-1 bg-paper-cream px-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-[13px] text-paper-moss">Delete this chat?</span>
                          <PaperButton
                            variant="danger"
                            className="min-h-7 px-2 text-[12.5px]"
                            disabled={deletingId === chat.id}
                            onClick={() => {
                              onDelete(chat.id);
                              setConfirming(undefined);
                            }}
                          >
                            Delete
                          </PaperButton>
                          <PaperButton variant="quiet" className="min-h-7 px-2 text-[12.5px]" onClick={() => setConfirming(undefined)}>
                            Keep
                          </PaperButton>
                        </div>
                      ) : (
                        <>
                          <Link
                            to={`/operator/chats/${encodeURIComponent(chat.id)}`}
                            onClick={onNavigate}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex min-h-9 items-center gap-2 py-1.5 pr-9 pl-2 text-[13.5px] leading-5 transition-colors duration-150",
                              PAPER_FOCUS,
                              active ? "bg-paper-stone text-paper-moss" : "text-paper-char hover:bg-paper-cream hover:text-paper-moss",
                            )}
                          >
                            {chat.status === "running" ? (
                              <span className="size-2 shrink-0 rounded-full bg-paper-green motion-safe:animate-pulse" role="img" aria-label="Answering" />
                            ) : null}
                            <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                          </Link>
                          <button
                            type="button"
                            onClick={() => setConfirming(chat.id)}
                            aria-label={`Delete "${chat.title}"`}
                            className={cn(
                              "absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center text-paper-sage opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-paper-flame-deep focus-visible:opacity-100",
                              PAPER_FOCUS,
                              active && "opacity-100",
                            )}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="border-t border-paper-stone p-3">
        <Link to="/operator/runs" onClick={onNavigate} className={cn("text-[12.5px] text-paper-sage underline-offset-[3px] hover:text-paper-moss hover:underline", PAPER_FOCUS)}>
          Planned runs and their audit trail
        </Link>
      </div>
    </nav>
  );
}
