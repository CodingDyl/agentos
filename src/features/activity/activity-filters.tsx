import type { ActivitySource, ProjectSummary } from "@shared/agentos-types";
import { FilterBar, SectionLabel } from "@/components/os";
import { sourceLabel, SOURCE_FILTERS } from "./activity-model";

/** `all` is not a source — it is the absence of a source filter. */
export type SourceFilter = ActivitySource | "all";
export type ProjectFilter = string | "all";

export interface ActivityFiltersProps {
  source: SourceFilter;
  onSourceChange: (value: SourceFilter) => void;
  project: ProjectFilter;
  onProjectChange: (value: ProjectFilter) => void;
  projects: ProjectSummary[];
  className?: string;
}

/**
 * Two filters, and deliberately only two.
 *
 * Both re-query the adapter rather than filtering in the browser, so a filtered
 * view is a full timeline of that slice — not the first fifty events with most
 * of them hidden.
 */
export function ActivityFilters({
  source,
  onSourceChange,
  project,
  onProjectChange,
  projects,
  className,
}: ActivityFiltersProps) {
  return (
    <div className={className}>
      <FilterBar<SourceFilter>
        label="Filter activity by source"
        value={source}
        onChange={onSourceChange}
        options={[
          { value: "all", label: "All" },
          ...SOURCE_FILTERS.map((entry) => ({
            value: entry as SourceFilter,
            label: sourceLabel(entry),
          })),
        ]}
      />

      {projects.length > 0 ? (
        <div className="mt-6">
          <SectionLabel>Project</SectionLabel>
          <FilterBar<ProjectFilter>
            label="Filter activity by project"
            value={project}
            onChange={onProjectChange}
            className="mt-3"
            options={[
              { value: "all", label: "All projects" },
              ...projects.map((entry) => ({
                value: entry.slug as ProjectFilter,
                label: entry.name,
              })),
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
