import { CornerDownLeft } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type FormHTMLAttributes, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { PAPER_FOCUS } from "./paper";

export interface PaperCommandSuggestion {
  command: string;
  description: string;
}

export interface PaperCommandInputProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  activeContext?: string;
  suggestions?: PaperCommandSuggestion[];
  showSuggestions?: boolean;
  disabled?: boolean;
  running?: boolean;
}

/**
 * The console's command line, on paper. Calm and terminal-like rather than a
 * chat bubble: a `>` prompt, a plain textarea, slash suggestions beneath.
 *
 * The send control is a dark icon button rather than the amber one, so the
 * view's single amber action stays free for the decision on the page.
 */
export function PaperCommandInput({
  value,
  defaultValue = "",
  onValueChange,
  onSubmit,
  placeholder = "Ask Hermes or run a command…",
  activeContext,
  suggestions = [],
  showSuggestions = false,
  disabled = false,
  running = false,
  className,
  ...props
}: PaperCommandInputProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const helpId = useId();
  const currentValue = value ?? internalValue;

  function updateValue(next: string) {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  }

  function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = currentValue.trim();
    if (!normalized || disabled || running) return;
    onSubmit?.(normalized);
  }

  function handleShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function selectSuggestion(command: string) {
    updateValue(`${command} `);
    textareaRef.current?.focus();
  }

  return (
    <form
      className={cn(
        "rounded-[4px] border border-paper-mist bg-paper-white transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-paper-blue",
        disabled && "opacity-50",
        className,
      )}
      onSubmit={submitCommand}
      {...props}
    >
      {activeContext ? (
        <div className="border-b border-paper-mist px-4 py-2 text-[12.5px] text-paper-sage">
          Context: <span className="font-medium text-paper-char">{activeContext}</span>
        </div>
      ) : null}
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-1.5 font-mono text-sm text-paper-char" aria-hidden="true">
          &gt;
        </span>
        <label htmlFor={inputId} className="sr-only">
          Agent command
        </label>
        <textarea
          ref={textareaRef}
          id={inputId}
          value={currentValue}
          rows={2}
          disabled={disabled || running}
          placeholder={placeholder}
          aria-describedby={helpId}
          onChange={(event) => updateValue(event.currentTarget.value)}
          onKeyDown={handleShortcut}
          className="min-h-14 flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 text-paper-moss outline-none placeholder:text-paper-ash disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!currentValue.trim() || disabled || running}
          aria-label={running ? "Agent is running" : "Run command"}
          className={cn(
            "mt-0.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[4px] bg-paper-moss text-paper-white transition-colors duration-150 hover:bg-paper-char disabled:cursor-not-allowed disabled:opacity-40",
            PAPER_FOCUS,
          )}
        >
          <CornerDownLeft className={cn("size-4", running && "motion-safe:animate-pulse")} aria-hidden="true" />
        </button>
      </div>
      <div id={helpId} className="flex flex-wrap items-center justify-between gap-2 border-t border-paper-mist px-4 py-2 text-[12.5px] text-paper-sage">
        <span>Type / for commands</span>
        <span>⌘ Enter to run</span>
      </div>
      {showSuggestions && suggestions.length > 0 ? (
        <div className="border-t border-paper-mist p-1.5" aria-label="Command suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.command}
              type="button"
              disabled={disabled || running}
              onClick={() => selectSuggestion(suggestion.command)}
              className={cn(
                "flex min-h-10 w-full cursor-pointer items-center justify-between gap-4 rounded-[3px] px-3 text-left transition-colors duration-150 hover:bg-paper-linen disabled:cursor-not-allowed disabled:opacity-45",
                PAPER_FOCUS,
              )}
            >
              <span className="font-mono text-[12.5px] text-paper-moss">{suggestion.command}</span>
              <span className="text-[12.5px] text-paper-sage">{suggestion.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
