import { ChevronDown, GitBranch, Plus } from "lucide-react";
import { useState } from "react";
import type { AgentSession } from "@shared/agentos-types";
import { CommandButton, SectionLabel, SystemIndicator } from "@/components/os";
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

  return [
    when,
    count === undefined
      ? undefined
      : `${count} ${count === 1 ? "message" : "messages"}`,
  ]
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

  const previous = (history?.sessions ?? []).filter(
    (entry) => entry.id !== session?.id,
  );

  return (
    <section className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <SectionLabel>Session</SectionLabel>
          {session ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="truncate text-[15px] leading-6">
                {session.title ?? session.id}
              </span>
              <SystemIndicator state="online" label="Active session" />
              <span className="os-meta text-os-subtle">
                {sessionMeta(session, messageCount)}
              </span>
            </div>
          ) : (
            <p className="mt-3 text-[15px] leading-6 text-os-subtle">
              Resolving session…
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <CommandButton
            variant="secondary"
            icon={Plus}
            iconPosition="start"
            disabled={isBusy}
            onClick={onNewSession}
          >
            New session
          </CommandButton>
          {onForkSession ? (
            <CommandButton
              variant="quiet"
              icon={GitBranch}
              iconPosition="start"
              disabled={isBusy || !session}
              onClick={onForkSession}
            >
              Fork
            </CommandButton>
          ) : null}
          <button
            type="button"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((open) => !open)}
            className="os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-os-muted transition-colors duration-150 hover:text-foreground"
          >
            History
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform duration-150",
                showHistory && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="mt-4 border-t border-os-border pt-4">
          {isPending ? (
            <p className="os-meta text-os-subtle">Reading sessions…</p>
          ) : previous.length === 0 ? (
            <p className="os-meta text-os-subtle">No previous sessions</p>
          ) : (
            <ul className="space-y-0.5">
              {previous.map((entry) => (
                <li
                  key={entry.id}
                  className="flex min-h-8 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] leading-5"
                >
                  <span className="min-w-0 truncate text-os-muted">
                    {entry.title ?? entry.id}
                  </span>
                  <span className="os-meta shrink-0 text-os-subtle">
                    {sessionMeta(entry)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* Previous sessions are kept in Hermes, never deleted from here. */}
          <p className="os-meta mt-4 text-os-subtle">
            Previous sessions stay in Hermes
          </p>
        </div>
      ) : null}
    </section>
  );
}
