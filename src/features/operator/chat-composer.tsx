import { ArrowUp, Square } from "lucide-react";
import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent } from "react";
import { MAX_CHAT_INPUT, type ChatAgent } from "@shared/chat-types";
import { PaperButton } from "@/components/paper";
import type { ModelChoice } from "./chat-model";

/**
 * Where you type, which agent and model answer, and the stop button.
 *
 * The model can change mid-chat: the next turn uses the new one and the
 * conversation carries on. Enter sends, Shift+Enter is a new line, as in any
 * messaging app.
 */
export function ChatComposer({
  agents,
  choice,
  onChoiceChange,
  value,
  onValueChange,
  onSubmit,
  sending,
  running,
  onStop,
  stopping,
  error,
  autoFocusKey,
  lockedAgent,
}: {
  agents: readonly ChatAgent[];
  choice?: ModelChoice;
  onChoiceChange: (choice: ModelChoice) => void;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (text: string) => void;
  sending: boolean;
  running: boolean;
  onStop: () => void;
  stopping: boolean;
  error?: string;
  /** Changes when the chat changes, to put the cursor back in the box. */
  autoFocusKey?: string;
  /**
   * The agent an existing chat belongs to. Its models can still change, but
   * the conversation lives in that agent's session: another agent means a new chat.
   */
  lockedAgent?: ChatAgent["id"];
}) {
  const inputId = useId();
  const modelId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const agent = agents.find((entry) => entry.id === choice?.agent);
  const unavailable = agent && !agent.available ? agent.unavailableReason ?? `${agent.name} isn't available.` : undefined;
  const busy = sending || running;

  useEffect(() => {
    textarea.current?.focus();
  }, [autoFocusKey]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = value.trim();
    if (text && !busy && choice && !unavailable) onSubmit(text);
  };

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form onSubmit={submit} aria-label="Message" className="sticky bottom-0 z-10 bg-paper-white pt-3 pb-3">
      <div className="border border-paper-mist bg-paper-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-paper-blue">
        <label htmlFor={inputId} className="sr-only">
          Message
        </label>
        <textarea
          ref={textarea}
          id={inputId}
          value={value}
          rows={2}
          maxLength={MAX_CHAT_INPUT}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={keys}
          placeholder={agent ? `Message ${agent.name}, or /plan, /run or /ask for a planned run` : "Message"}
          className="block max-h-56 min-h-14 w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-6 text-paper-moss outline-none placeholder:text-paper-ash"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-paper-stone px-3 py-2">
          <label htmlFor={modelId} className="sr-only">
            Agent and model
          </label>
          <select
            id={modelId}
            value={choice ? `${choice.agent}:${choice.model}` : ""}
            onChange={(event) => {
              const [nextAgent, ...rest] = event.currentTarget.value.split(":");
              onChoiceChange({ agent: nextAgent as ModelChoice["agent"], model: rest.join(":") });
            }}
            disabled={agents.length === 0 || running}
            className="min-h-8 max-w-[60vw] cursor-pointer border border-paper-mist bg-paper-white px-2 font-paper-utility text-[12.5px] font-medium tracking-[0.06em] text-paper-moss uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-blue disabled:cursor-not-allowed disabled:opacity-60"
          >
            {agents.length === 0 ? <option value="">Loading models…</option> : null}
            {agents.map((entry) => (
              <optgroup
                key={entry.id}
                label={
                  lockedAgent && entry.id !== lockedAgent
                    ? `${entry.name} (start a new chat)`
                    : entry.available
                      ? `${entry.name}${entry.billing ? ` · ${entry.billing}` : ""}`
                      : `${entry.name} (unavailable)`
                }
              >
                {entry.models.map((model) => (
                  <option
                    key={model.id}
                    value={`${entry.id}:${model.id}`}
                    disabled={!entry.available || (lockedAgent !== undefined && entry.id !== lockedAgent)}
                    title={model.hint}
                  >
                    {entry.name} {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <p className="hidden min-w-0 flex-1 truncate text-[12px] text-paper-sage md:block">
            {agent?.models.find((model) => model.id === choice?.model)?.hint}
          </p>

          {running ? (
            <PaperButton variant="danger" className="ml-auto min-h-9" onClick={onStop} disabled={stopping} aria-label="Stop the reply">
              <Square className="size-3 fill-current" aria-hidden="true" />
              {stopping ? "Stopping…" : "Stop"}
            </PaperButton>
          ) : (
            <PaperButton type="submit" variant="amber" className="ml-auto min-h-9" disabled={!value.trim() || busy || !choice || Boolean(unavailable)}>
              {sending ? "Sending…" : "Send"}
              <ArrowUp className="size-4" aria-hidden="true" />
            </PaperButton>
          )}
        </div>
      </div>
      {unavailable || error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {error ?? unavailable}
        </p>
      ) : null}
    </form>
  );
}
