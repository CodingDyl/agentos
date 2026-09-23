import { X } from "lucide-react";
import type { ProjectSummary } from "@shared/agentos-types";
import { SectionLabel } from "@/components/os";
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
export function AgentContext({
  projects,
  value,
  onChange,
  className,
}: AgentContextProps) {
  const selected = projects.find((project) => project.slug === value);

  return (
    <div className={cn("min-w-0", className)}>
      <SectionLabel>Project context</SectionLabel>

      {selected ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="truncate text-[15px] leading-6">{selected.name}</span>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label={`Clear ${selected.name} as project context`}
            className="os-focus-ring inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-os-subtle transition-colors duration-150 hover:bg-os-surface-raised hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {projects.length === 0 ? (
            <span className="text-[15px] leading-6 text-os-subtle">
              No projects available
            </span>
          ) : (
            projects.map((project) => (
              <button
                key={project.slug}
                type="button"
                onClick={() => onChange(project.slug)}
                className="os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center rounded-md border border-transparent px-3 text-os-muted transition-colors duration-150 hover:border-os-border hover:text-foreground"
              >
                {project.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
