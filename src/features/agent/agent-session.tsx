import { ChevronDown, GitBranch, Plus } from "lucide-react";
import { useState } from "react";
import type { AgentSession } from "@shared/agentos-types";
import { FieldLabel, PAPER_FOCUS, PaperButton, PaperIndicator } from "@/components/paper";
import { formatRelativeTime } from "@/lib/format";
import { useAgentSessions } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

export interface AgentSessionBarProps {
  session?: AgentSession;
  /** Message count from the canonical transcript, not the session record. */
  messageCount?: number;
  onNewSession: () => void;
  onForkSession?: () => void;
  isBusy?: boolean;
  className?: string;
}

function sessionMeta(session: AgentSession, messageCount?: number): string {
  const count = messageCount ?? session.messageCount;
  const when = formatRelativeTime(session.updatedAt ?? session.createdAt);

  return [when, count === undefined ? undefined : `${count} ${count === 1 ? "message" : "messages"}`]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The conversation lane this project is in.
 *
 * Hermes owns the transcript; this only names the session and offers the two
 * ways to change lanes — a fresh one, or a branch of the current one.
 */
export function AgentSessionBar({
  session,
  messageCount,
  onNewSession,
  onForkSession,
  isBusy = false,
  className,
}: AgentSessionBarProps) {
  const [showHistory, setShowHistory] = useState(false);
  const { data: history, isPending } = useAgentSessions(showHistory);

  const previous = (history?.sessions ?? []).filter((entry) => entry.id !== session?.id);

  return (
    <section aria-label="Session" className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <FieldLabel>Session</FieldLabel>
          {session ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="truncate text-[15px] leading-6 font-medium text-paper-moss">{session.title ?? session.id}</span>
              <PaperIndicator tone="green" label="Active session" />
              <span className="text-[13px] text-paper-sage">{sessionMeta(session, messageCount)}</span>
            </div>
          ) : (
            <p className="text-[14px] leading-6 text-paper-sage">Resolving session…</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <PaperButton variant="ghost" disabled={isBusy} onClick={onNewSession}>
            <Plus className="size-3.5" aria-hidden="true" />
            New session
          </PaperButton>
          {onForkSession ? (
            <PaperButton variant="quiet" disabled={isBusy || !session} onClick={onForkSession}>
              <GitBranch className="size-3.5" aria-hidden="true" />
              Fork
            </PaperButton>
          ) : null}
          <button
            type="button"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((open) => !open)}
            className={cn(
              "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-none px-3 text-[13.5px] font-semibold text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
              PAPER_FOCUS,
            )}
          >
            History
            <ChevronDown className={cn("size-3.5 transition-transform duration-150", showHistory && "rotate-180")} aria-hidden="true" />
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="mt-4 border-t border-paper-mist pt-4">
          {isPending ? (
            <p className="text-[13px] text-paper-sage">Reading sessions…</p>
          ) : previous.length === 0 ? (
            <p className="text-[13px] text-paper-sage">No previous sessions</p>
          ) : (
            <ul className="space-y-0.5">
              {previous.map((entry) => (
                <li key={entry.id} className="flex min-h-8 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13.5px] leading-5">
                  <span className="min-w-0 truncate text-paper-char">{entry.title ?? entry.id}</span>
                  <span className="shrink-0 text-[12.5px] text-paper-sage">{sessionMeta(entry)}</span>
                </li>
              ))}
            </ul>
          )}
          {/* Previous sessions are kept in Hermes, never deleted from here. */}
          <p className="mt-4 text-[12.5px] text-paper-sage">Previous sessions stay in Hermes</p>
        </div>
      ) : null}
    </section>
  );
}
