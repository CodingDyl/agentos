import type { ProjectSummary as Project } from "@shared/agentos-types";
import { cn } from "@/lib/utils";
import { countProjects, STATE_ORDER, stateLabel } from "./projects-model";

export interface ProjectSummaryProps {
  projects: Project[];
  className?: string;
}

/**
 * Portfolio shape in one line of counts. Deliberately not a chart — this is an
 * operator console, not a reporting screen.
 *
 * Zero-count states are omitted, except `blocked`: a blocked count of zero is
 * worth stating, because a non-zero one demands attention.
 */
export function ProjectSummary({ projects, className }: ProjectSummaryProps) {
  const { total, byState } = countProjects(projects);

  const visibleStates = STATE_ORDER.filter(
    (state) => byState[state] > 0 || state === "blocked",
  );

  return (
    <dl
      className={cn(
        "flex flex-wrap items-baseline gap-x-8 gap-y-3 border-b border-os-border pb-6",
        className,
      )}
    >
      <div className="flex items-baseline gap-2">
        <dt className="sr-only">Total projects</dt>
        <dd className="text-[15px] leading-6 tabular-nums">{total}</dd>
        <span className="os-meta text-os-subtle" aria-hidden="true">
          Projects
        </span>
      </div>

      {visibleStates.map((state) => (
        <div key={state} className="flex items-baseline gap-2">
          <dt className="sr-only">{stateLabel(state)}</dt>
          <dd
            className={cn(
              "text-[15px] leading-6 tabular-nums",
              byState[state] === 0 ? "text-os-subtle" : "text-os-muted",
            )}
          >
            {byState[state]}
          </dd>
          <span className="os-meta text-os-subtle" aria-hidden="true">
            {stateLabel(state)}
          </span>
        </div>
      ))}
    </dl>
  );
}
