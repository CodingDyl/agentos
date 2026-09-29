import { useEffect, useRef } from "react";
import type { AgentMessage as AgentMessageModel } from "@shared/agentos-types";
import { PaperEmpty } from "@/components/paper";
import { cn } from "@/lib/utils";
import { AgentMessage, SpeakerLabel } from "./agent-message";

export interface AgentThreadProps {
  messages: AgentMessageModel[];
  isThinking?: boolean;
  className?: string;
}

/** The conversation so far. Scrolls to the newest turn as it arrives. */
export function AgentThread({ messages, isThinking = false, className }: AgentThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isThinking]);

  if (messages.length === 0 && !isThinking) {
    return (
      <PaperEmpty
        title="No messages"
        description="Ask Hermes a question, or run one of the quick commands below."
        className={className}
      />
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {messages.map((message) => (
        <AgentMessage key={message.id} message={message} />
      ))}

      {isThinking ? (
        <div className="border-t border-paper-mist pt-6" role="status" aria-live="polite">
          <SpeakerLabel speaker="Hermes" agent />
          <p className="mt-3 text-[15px] leading-6 text-paper-sage">Thinking…</p>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
