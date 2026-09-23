import type { ProjectSummary } from "@shared/agentos-types";
import { FilterBar } from "@/components/os";
import { buildFilterOptions, type ProjectFilter } from "./projects-model";

export interface ProjectFiltersProps {
  /** The unfiltered set, so counts stay stable as the selection changes. */
  projects: ProjectSummary[];
  value: ProjectFilter;
  onChange: (value: ProjectFilter) => void;
  className?: string;
}

/** Frontend-only state filter. Never re-queries the adapter. */
export function ProjectFilters({
  projects,
  value,
  onChange,
  className,
}: ProjectFiltersProps) {
  return (
    <FilterBar
      label="Filter projects by state"
      options={buildFilterOptions(projects)}
      value={value}
      onChange={onChange}
      className={className}
    />
  );
}
