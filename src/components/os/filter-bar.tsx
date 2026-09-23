import { cn } from "@/lib/utils";

export interface FilterOption<TValue extends string> {
  value: TValue;
  label: string;
  /** Shown after the label, e.g. a match count. */
  count?: number;
}

export interface FilterBarProps<TValue extends string> {
  options: readonly FilterOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  /** Names the group for screen readers, e.g. "Filter projects by state". */
  label: string;
  className?: string;
}

/**
 * A mono, hairline filter group. Selection is carried by border and foreground
 * weight rather than a filled chip, so it stays quiet in a dense screen.
 */
export function FilterBar<TValue extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: FilterBarProps<TValue>) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              "os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 transition-colors duration-150",
              isSelected
                ? "border-os-border-strong bg-os-surface-raised text-foreground"
                : "border-transparent text-os-muted hover:border-os-border hover:text-foreground",
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
          </button>
        );
      })}
    </div>
  );
}
