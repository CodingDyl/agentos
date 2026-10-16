import { FilterToolbar, type FilterGroup } from "@/components/os";
import type { MailStatusFilter } from "./mail-model";

interface FilterOption {
  value: MailStatusFilter;
  label: string;
}

const STATUS_OPTIONS: readonly FilterOption[] = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs you" },
  { value: "fyi", label: "FYI" },
  { value: "low", label: "Low priority" },
  { value: "unsorted", label: "Awaiting Jev" },
];

const ACCOUNT_OPTIONS = [
  { value: "all", label: "All accounts" },
  { value: "gmail", label: "Gmail" },
  { value: "titan", label: "Virtara" },
] as const;

interface MailFiltersProps {
  value: MailStatusFilter;
  counts: Record<MailStatusFilter, number>;
  onChange: (value: MailStatusFilter) => void;
  showStatus?: boolean;
  account?: string;
  onAccountChange?: (value: "all" | "gmail" | "titan") => void;
}

/**
 * Filters the Inbox to one of Jev's statuses, and optionally to one mailbox.
 * "Awaiting Jev" only appears while there is something waiting — or while it
 * is the active filter, so the control the reader is on never vanishes under
 * them.
 */
export function MailFilters({
  value,
  counts,
  onChange,
  showStatus = true,
  account,
  onAccountChange,
}: MailFiltersProps) {
  const groups: FilterGroup[] = [];

  if (account !== undefined && onAccountChange) {
    groups.push({
      id: "account",
      label: "Account",
      value: account,
      emptyValue: "all",
      onChange: (next) => onAccountChange(next as "all" | "gmail" | "titan"),
      options: [...ACCOUNT_OPTIONS],
    });
  }

  if (showStatus) {
    const visible = STATUS_OPTIONS.filter(
      (option) => option.value !== "unsorted" || counts.unsorted > 0 || value === "unsorted",
    );
    groups.push({
      id: "status",
      label: "Status",
      value,
      emptyValue: "all",
      onChange: (next) => onChange(next as MailStatusFilter),
      options: visible.map((option) => ({
        value: option.value,
        label: option.label,
        count: counts[option.value],
      })),
    });
  }

  if (groups.length === 0) return null;

  return <FilterToolbar groups={groups} />;
}
