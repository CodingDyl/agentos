import { ListFilter, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  activeChips,
  activeFilterCount,
  groupIsSearchable,
  optionsMatching,
  toggleMultiple,
  toggleSingle,
  type FilterChip,
  type FilterGroupState,
  type FilterOption,
} from "./filter-toolbar-model";

export type { FilterChip };

interface FilterGroupCommon {
  id: string;
  label: string;
  options: readonly FilterOption[];
  searchable?: boolean;
}

export type FilterGroup =
  | (FilterGroupCommon & {
      mode?: "single";
      value: string;
      emptyValue: string;
      onChange: (value: string) => void;
    })
  | (FilterGroupCommon & {
      mode: "multiple";
      values: readonly string[];
      onChange: (values: string[]) => void;
    });

export interface FilterToolbarProps {
  groups: readonly FilterGroup[];
  /** Visible label on the trigger. Defaults to "Filter". */
  label?: string;
  className?: string;
  /** Controlled open state, used by tests. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function toState(group: FilterGroup): FilterGroupState {
  if (group.mode === "multiple") {
    return {
      id: group.id,
      label: group.label,
      options: group.options,
      searchable: group.searchable,
      mode: "multiple",
      values: group.values,
    };
  }
  return {
    id: group.id,
    label: group.label,
    options: group.options,
    searchable: group.searchable,
    mode: "single",
    value: group.value,
    emptyValue: group.emptyValue,
  };
}

function isChecked(group: FilterGroup, value: string): boolean {
  return group.mode === "multiple" ? group.values.includes(value) : group.value === value;
}

function selectOption(group: FilterGroup, value: string): void {
  if (group.mode === "multiple") {
    group.onChange(toggleMultiple(group.values, value));
    return;
  }
  group.onChange(toggleSingle(group.value, value, group.emptyValue));
}

function clearGroup(group: FilterGroup): void {
  if (group.mode === "multiple") group.onChange([]);
  else group.onChange(group.emptyValue);
}

function removeChip(groups: readonly FilterGroup[], chip: FilterChip): void {
  const group = groups.find((entry) => entry.id === chip.groupId);
  if (!group) return;
  if (group.mode === "multiple") {
    group.onChange(group.values.filter((value) => value !== chip.value));
    return;
  }
  group.onChange(group.emptyValue);
}

export function FilterToolbar({
  groups,
  label = "Filter",
  className,
  open,
  onOpenChange,
}: FilterToolbarProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [queries, setQueries] = useState<Record<string, string>>({});
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const states = useMemo(() => groups.map(toState), [groups]);
  const chips = useMemo(() => activeChips(states), [states]);
  const count = useMemo(() => activeFilterCount(states), [states]);

  if (!isOpen && Object.keys(queries).length > 0) {
    setQueries({});
  }

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.composedPath().includes(rootRef.current)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, setOpen]);

  return (
    <div className={cn("flex w-full min-w-0 items-center gap-2", className)}>
      <div ref={rootRef} className="relative shrink-0">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setOpen(!isOpen)}
          className={cn(
            "os-focus-ring inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[2px] border px-2.5 text-[13px] font-medium transition-colors duration-150",
            isOpen || count > 0
              ? "border-os-border-strong bg-os-surface-raised text-foreground"
              : "border-os-border bg-os-surface text-foreground hover:border-os-border-strong hover:bg-os-surface-raised",
          )}
        >
          <ListFilter className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          {label}
          {count > 0 ? (
            <span
              data-filter-count={count}
              className="inline-flex min-w-4 items-center justify-center rounded-[2px] bg-primary px-1 text-[10px] leading-4 font-bold text-primary-foreground tabular-nums"
            >
              {count}
            </span>
          ) : null}
        </button>

        {isOpen ? (
          <div
            id={panelId}
            role="dialog"
            aria-label="Filters"
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute top-full left-0 z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] max-h-[28rem] overflow-y-auto rounded-[2px] border border-os-border bg-popover p-2 shadow-[var(--shadow-overlay)]"
          >
            {groups.map((group, index) => {
              const searchable = groupIsSearchable(group);
              const query = queries[group.id] ?? "";
              const visible = optionsMatching(group.options, query);

              return (
                <section key={group.id} className={cn(index > 0 && "mt-2 border-t border-os-border pt-2")}>
                  <h3 className="os-meta px-1.5 pb-1 text-os-subtle">{group.label}</h3>
                  {searchable ? (
                    <label className="mb-1.5 block px-0.5">
                      <span className="sr-only">Search {group.label.toLowerCase()}s</span>
                      <input
                        value={query}
                        onChange={(event) =>
                          setQueries((current) => ({ ...current, [group.id]: event.target.value }))
                        }
                        placeholder={`Search ${group.label.toLowerCase()}s`}
                        className="h-8 w-full rounded-[2px] border border-os-border bg-os-surface px-2 text-[13px] text-foreground placeholder:text-os-subtle"
                        style={{ minHeight: 32 }}
                      />
                    </label>
                  ) : null}
                  <div className="grid gap-px">
                    {visible.length === 0 ? (
                      <p className="px-1.5 py-2 text-[12px] text-os-subtle">No matches.</p>
                    ) : (
                      visible.map((option) => {
                        const checked = isChecked(group, option.value);
                        const optionId = `${panelId}-${group.id}-${option.value}`;
                        return (
                          <label
                            key={option.value}
                            htmlFor={optionId}
                            className={cn(
                              "flex min-h-8 cursor-pointer items-center gap-2 rounded-[2px] px-1.5 text-[13px] hover:bg-os-surface-active",
                              checked ? "text-foreground" : "text-os-muted",
                            )}
                          >
                            <input
                              id={optionId}
                              type="checkbox"
                              checked={checked}
                              onChange={() => selectOption(group, option.value)}
                              className="size-3.5 shrink-0 accent-primary"
                            />
                            <span className="min-w-0 flex-1 truncate">{option.label}</span>
                            {option.count !== undefined ? (
                              <span className="os-meta text-os-subtle tabular-nums">{option.count}</span>
                            ) : null}
                          </label>
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {chips.map((chip) => (
            <span
              key={`${chip.groupId}:${chip.value}`}
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-[2px] border border-os-border bg-os-surface-raised pl-2 text-[12px] text-foreground"
            >
              {chip.text}
              <button
                type="button"
                aria-label={`Remove ${chip.text}`}
                onClick={() => removeChip(groups, chip)}
                className="os-focus-ring inline-flex size-7 cursor-pointer items-center justify-center text-os-muted hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => groups.forEach(clearGroup)}
            className="os-focus-ring shrink-0 cursor-pointer px-1.5 text-[12px] text-os-muted hover:text-primary hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
