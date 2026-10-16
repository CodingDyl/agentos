import type { ProjectSummary } from "@shared/agentos-types";
import { FilterToolbar } from "@/components/os";
import { FieldLabel } from "@/components/paper";
import { cn } from "@/lib/utils";

export interface AgentContextProps {
  projects: ProjectSummary[];
  /** Slug of the project every request is scoped to, if any. */
  value?: string;
  onChange: (slug: string | undefined) => void;
  className?: string;
}

/**
 * The project every request is scoped to. Naming it lets Hermes load that
 * project's own context from the vault rather than the UI assembling it.
 */
export function AgentContext({ projects, value, onChange, className }: AgentContextProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <FieldLabel>Workspace context</FieldLabel>

      {projects.length === 0 ? (
        <span className="text-[14px] leading-6 text-paper-sage">No workspaces available</span>
      ) : (
        <FilterToolbar
          label="Workspace"
          groups={[
            {
              id: "workspace",
              label: "Workspace",
              value: value ?? "",
              emptyValue: "",
              searchable: true,
              onChange: (slug) => onChange(slug || undefined),
              options: projects.map((project) => ({ value: project.slug, label: project.name })),
            },
          ]}
        />
      )}
    </div>
  );
}
