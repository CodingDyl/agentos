import { X } from "lucide-react";
import type { ProjectSummary } from "@shared/agentos-types";
import { FieldLabel, PAPER_FOCUS, PaperFilterBar } from "@/components/paper";
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
  const selected = projects.find((project) => project.slug === value);

  return (
    <div className={cn("min-w-0", className)}>
      <FieldLabel>Workspace context</FieldLabel>

      {selected ? (
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] leading-6 font-medium text-paper-moss">{selected.name}</span>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label={`Clear ${selected.name} as workspace context`}
            className={cn(
              "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
              PAPER_FOCUS,
            )}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : projects.length === 0 ? (
        <span className="text-[14px] leading-6 text-paper-sage">No workspaces available</span>
      ) : (
        <PaperFilterBar<string>
          label="Choose a workspace as context"
          value=""
          onChange={onChange}
          options={projects.map((project) => ({ value: project.slug, label: project.name }))}
        />
      )}
    </div>
  );
}
