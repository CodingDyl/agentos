import type { MailStatusFilter } from "./mail-model";

interface FilterOption {
  value: MailStatusFilter;
  label: string;
}

const OPTIONS: readonly FilterOption[] = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs you" },
  { value: "fyi", label: "FYI" },
  { value: "low", label: "Low priority" },
  { value: "unsorted", label: "Awaiting Jev" },
];

interface MailFiltersProps {
  value: MailStatusFilter;
  counts: Record<MailStatusFilter, number>;
  onChange: (value: MailStatusFilter) => void;
}

/**
 * Filters the Inbox to one of Jev's statuses. "Awaiting Jev" only appears
 * while there is something waiting — or while it is the active filter, so
 * the control the reader is on never vanishes under them.
 */
export function MailFilters({ value, counts, onChange }: MailFiltersProps) {
  const visible = OPTIONS.filter(
    (option) => option.value !== "unsorted" || counts.unsorted > 0 || value === "unsorted",
  );

  return (
    <div className="mail-filters" role="group" aria-label="Filter by status">
      {visible.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`mail-filter mail-filter--${option.value}${active ? " mail-filter--active" : ""}`}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            <span className="mail-filter-count">{counts[option.value]}</span>
          </button>
        );
      })}
    </div>
  );
}
