import { EmptyState, HairlineCard, ProjectRow, Section } from "@/components/os";
import type { ProjectSummary } from "./dashboard-model";

export interface ActiveProjectsProps {
  /** Already filtered and ranked by `selectActiveProjects`. */
  projects: ProjectSummary[];
  className?: string;
}

/** The projects competing for today, each with its state and priority on the row. */
export function ActiveProjects({ projects, className }: ActiveProjectsProps) {
  const hasProjects = projects.length > 0;

  return (
    <Section
      label="Active projects"
      className={className}
      action={hasProjects ? `${projects.length} tracked` : undefined}
    >
      <HairlineCard className="overflow-hidden">
        {hasProjects ? (
          <ul className="divide-y divide-os-border">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                name={project.name}
                status={project.state}
                priority={project.priority}
                summary={project.summary}
                to={project.href}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            variant="inline"
            className="p-5 md:p-6"
            description="No active projects. Everything is paused or incubating."
          />
        )}
      </HairlineCard>
    </Section>
  );
}
