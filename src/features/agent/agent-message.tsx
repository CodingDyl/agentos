import type { AgentMessage as AgentMessageModel } from "@shared/agentos-types";
import { withoutEmDashes } from "@shared/plain-text";
import { Markdown, SectionLabel } from "@/components/os";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<AgentMessageModel["role"], string> = {
  user: "You",
  assistant: "Hermes",
  system: "System",
};

export interface AgentMessageProps {
  message: AgentMessageModel;
}

/**
 * One turn in the thread. Speaker is named in a mono label above the content —
 * an operator transcript, not a chat bubble.
 */
export function AgentMessage({ message }: AgentMessageProps) {
  const isUser = message.role === "user";

  return (
    <article className="border-t border-os-border pt-6 first:border-t-0 first:pt-0">
      <SectionLabel className={cn(isUser ? "text-os-subtle" : "text-os-amber")}>
        {ROLE_LABELS[message.role]}
      </SectionLabel>

      <div className="mt-4 min-w-0">
        {isUser ? (
          // The operator's own text is shown verbatim, never re-interpreted.
          <p className="text-[15px] leading-6 whitespace-pre-wrap text-foreground">
            {message.content}
          </p>
        ) : (
          // Hermes' words, shown in AgentOS's house style (no em dashes).
          // Hermes' own transcript is not changed; only what is displayed.
          <Markdown content={withoutEmDashes(message.content)} />
        )}
      </div>
    </article>
  );
}
