import type { AgentMessage as AgentMessageModel } from "@shared/agentos-types";
import { withoutEmDashes } from "@shared/plain-text";
import { Markdown } from "@/components/os";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<AgentMessageModel["role"], string> = {
  user: "You",
  assistant: "Hermes",
  system: "System",
};

/**
 * Who is speaking. Hermes carries an amber dot — work by the agent — and the
 * operator carries none, so the two voices read apart without bubbles.
 */
export function SpeakerLabel({ speaker, agent = false }: { speaker: string; agent?: boolean }) {
  return (
    <p className="flex items-center gap-2 text-[12.5px] font-semibold text-paper-char">
      {agent ? <span className="size-2 rounded-full bg-paper-amber" aria-hidden="true" /> : null}
      {speaker}
    </p>
  );
}

export interface AgentMessageProps {
  message: AgentMessageModel;
}

/**
 * One turn in the thread. Speaker is named above the content — an operator
 * transcript, not a chat bubble.
 */
export function AgentMessage({ message }: AgentMessageProps) {
  const isUser = message.role === "user";

  return (
    <article className="border-t border-paper-mist pt-6 first:border-t-0 first:pt-0">
      <SpeakerLabel speaker={ROLE_LABELS[message.role]} agent={message.role === "assistant"} />

      <div className={cn("mt-3 min-w-0")}>
        {isUser ? (
          // The operator's own text is shown verbatim, never re-interpreted.
          <p className="text-[15px] leading-6 whitespace-pre-wrap text-paper-moss">{message.content}</p>
        ) : (
          // Hermes' words, shown in AgentOS's house style (no em dashes).
          // Hermes' own transcript is not changed; only what is displayed.
          <Markdown tone="paper" content={withoutEmDashes(message.content)} />
        )}
      </div>
    </article>
  );
}
