import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface TabOption<TValue extends string> {
  value: TValue;
  label: string;
  /** Shown after the label, e.g. an item count. */
  count?: number;
}

export interface TabBarProps<TValue extends string> {
  options: readonly TabOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  /** Names the tab set for screen readers, e.g. "Project sections". */
  label: string;
  className?: string;
}

/**
 * Hairline tab strip. The selected tab is marked by an amber rule and cream
 * foreground — the only place amber appears on a project screen.
 *
 * Implements the tabs keyboard pattern: arrows move between tabs, Home and End
 * jump to the ends.
 */
export function TabBar<TValue extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: TabBarProps<TValue>) {
  const listRef = useRef<HTMLDivElement>(null);

  function focusTab(index: number) {
    const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]");
    tabs?.[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = options.findIndex((option) => option.value === value);
    if (currentIndex === -1) return;

    const lastIndex = options.length - 1;
    const nextIndex =
      event.key === "ArrowRight"
        ? (currentIndex + 1) % options.length
        : event.key === "ArrowLeft"
          ? (currentIndex - 1 + options.length) % options.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? lastIndex
              : -1;

    if (nextIndex === -1) return;

    event.preventDefault();
    onChange(options[nextIndex].value);
    focusTab(nextIndex);
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-os-border",
        className,
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={`tab-${option.value}`}
            aria-selected={isSelected}
            aria-controls={`panel-${option.value}`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "os-focus-ring os-meta relative inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-t-md px-3 transition-colors duration-150",
              isSelected
                ? "text-foreground"
                : "text-os-muted hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "tabular-nums",
                  isSelected ? "text-os-muted" : "text-os-subtle",
                )}
              >
                {option.count}
              </span>
            ) : null}
            {isSelected ? (
              <span
                className="absolute inset-x-0 -bottom-px h-px bg-os-amber"
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
