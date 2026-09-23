import { CornerDownLeft, Slash } from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type FormHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { CommandButton } from "./command-button";

export interface AgentCommandSuggestion {
  command: string;
  description: string;
}

export interface AgentCommandInputProps
  extends Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  activeContext?: string;
  suggestions?: AgentCommandSuggestion[];
  showSuggestions?: boolean;
  disabled?: boolean;
  running?: boolean;
}

export function AgentCommandInput({
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
}: AgentCommandInputProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const helpId = useId();
  const currentValue = value ?? internalValue;

  function updateValue(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }

  function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedValue = currentValue.trim();
    if (!normalizedValue || disabled || running) return;
    onSubmit?.(normalizedValue);
  }

  function handleKeyboardShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
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
        "rounded-md border border-input bg-os-surface/90 transition-colors duration-150 focus-within:border-os-amber focus-within:ring-2 focus-within:ring-os-amber/15",
        disabled && "opacity-50",
        className,
      )}
      onSubmit={submitCommand}
      {...props}
    >
      {activeContext ? (
        <div className="os-meta border-b border-os-border px-4 py-2.5 text-os-subtle">
          Context / <span className="text-os-muted">{activeContext}</span>
        </div>
      ) : null}
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-1.5 font-mono text-sm text-os-amber" aria-hidden="true">
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
          onKeyDown={handleKeyboardShortcut}
          className="min-h-14 flex-1 resize-none bg-transparent py-1 text-base leading-6 text-foreground outline-none placeholder:text-os-subtle disabled:cursor-not-allowed"
        />
        <CommandButton
          type="submit"
          variant="primary"
          icon={CornerDownLeft}
          className="mt-0.5 size-10 min-h-10 rounded-full p-0"
          disabled={!currentValue.trim() || disabled}
          loading={running}
          loadingLabel=""
          aria-label={running ? "Agent is running" : "Run command"}
        >
          <span className="sr-only">Run command</span>
        </CommandButton>
      </div>
      <div
        id={helpId}
        className="flex flex-wrap items-center justify-between gap-2 border-t border-os-border px-4 py-2.5"
      >
        <span className="os-meta text-os-subtle">
          <Slash className="mr-1 inline size-3" aria-hidden="true" />
          Commands
        </span>
        <span className="os-meta text-os-subtle">⌘ Enter to run</span>
      </div>
      {showSuggestions && suggestions.length > 0 ? (
        <div className="border-t border-os-border p-2" aria-label="Command suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.command}
              type="button"
              disabled={disabled || running}
              onClick={() => selectSuggestion(suggestion.command)}
              className="os-focus-ring flex min-h-11 w-full cursor-pointer items-center justify-between gap-4 rounded-sm px-3 text-left transition-colors duration-150 hover:bg-os-surface-raised disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="font-mono text-xs text-foreground">
                {suggestion.command}
              </span>
              <span className="text-xs text-os-subtle">
                {suggestion.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
