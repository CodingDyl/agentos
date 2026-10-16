/**
 * View-model for the shared filter toolbar.
 *
 * Pages keep their own filter state and query logic; this only decides which
 * chips to show, how a click changes a group, and when a long list earns a
 * search field. Filtering the underlying data is never done here.
 */

export const SEARCHABLE_OPTION_THRESHOLD = 8;

export interface FilterOption {
  value: string;
  label: string;
  /** Shown after the label inside the popover, e.g. a match count. */
  count?: number;
}

interface FilterGroupBase {
  id: string;
  label: string;
  options: readonly FilterOption[];
  /** Force search on or off; omitted means "on once the list is long". */
  searchable?: boolean;
}

export type FilterGroupState =
  | (FilterGroupBase & {
      mode?: "single";
      value: string;
      emptyValue: string;
    })
  | (FilterGroupBase & {
      mode: "multiple";
      values: readonly string[];
    });

export interface FilterChip {
  groupId: string;
  groupLabel: string;
  value: string;
  label: string;
  text: string;
}

export function toggleSingle(current: string, clicked: string, emptyValue: string): string {
  if (clicked === emptyValue || current === clicked) return emptyValue;
  return clicked;
}

export function toggleMultiple(current: readonly string[], clicked: string): string[] {
  return current.includes(clicked) ? current.filter((value) => value !== clicked) : [...current, clicked];
}

export function optionsMatching(options: readonly FilterOption[], query: string): FilterOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}

export function groupIsSearchable(group: { options: readonly FilterOption[]; searchable?: boolean }): boolean {
  if (group.searchable === false) return false;
  if (group.searchable === true) return true;
  return group.options.length >= SEARCHABLE_OPTION_THRESHOLD;
}

function chipsForOption(group: FilterGroupBase, value: string): FilterChip[] {
  const option = group.options.find((entry) => entry.value === value);
  const label = option?.label ?? value;
  return [
    {
      groupId: group.id,
      groupLabel: group.label,
      value,
      label,
      text: `${group.label}: ${label}`,
    },
  ];
}

export function activeChips(groups: readonly FilterGroupState[]): FilterChip[] {
  return groups.flatMap((group) => {
    if (group.mode === "multiple") {
      return group.values.flatMap((value) => chipsForOption(group, value));
    }
    if (group.value === group.emptyValue) return [];
    return chipsForOption(group, group.value);
  });
}

export function activeFilterCount(groups: readonly FilterGroupState[]): number {
  return activeChips(groups).length;
}
