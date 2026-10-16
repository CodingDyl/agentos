import type { ActivitySource, ProjectSummary } from "@shared/agentos-types";
import { FilterToolbar, type FilterGroup } from "@/components/os";
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
 * of them hidden. The chrome is the shared Filter toolbar: a button, chips for
 * what is on, and a searchable workspace list rather than a wall of toggles.
 */
export function ActivityFilters({
  source,
  onSourceChange,
  project,
  onProjectChange,
  projects,
  className,
}: ActivityFiltersProps) {
  const groups: FilterGroup[] = [
    {
      id: "type",
      label: "Type",
      value: source,
      emptyValue: "all",
      onChange: (value) => onSourceChange(value as SourceFilter),
      options: [
        { value: "all", label: "All" },
        ...SOURCE_FILTERS.map((entry) => ({
          value: entry,
          label: sourceLabel(entry),
        })),
      ],
    },
  ];

  if (projects.length > 0) {
    groups.push({
      id: "workspace",
      label: "Workspace",
      value: project,
      emptyValue: "all",
      searchable: true,
      onChange: (value) => onProjectChange(value as ProjectFilter),
      options: [
        { value: "all", label: "All workspaces" },
        ...projects.map((entry) => ({
          value: entry.slug,
          label: entry.name,
        })),
      ],
    });
  }

  return <FilterToolbar groups={groups} className={className} />;
}
