import type { ProjectSummary } from "@shared/agentos-types";
import { statePill } from "./projects-model";
import { ProjectListItem } from "@/components/os";
import { formatRelativeTime } from "@/lib/format";
import { healthTone, shortDate } from "./roadmap-model";

export interface ProjectRowProps {
  project: ProjectSummary;
}

/** Maps a portfolio project onto the design system's browse-density entry. */
export function ProjectRow({ project }: ProjectRowProps) {
  return (
    <ProjectListItem
      name={project.name}
      status={statePill(project.state)}
      priority={project.priority}
      type={project.type}
      summary={project.status}
      nextAction={project.nextAction}
      lastActivity={formatRelativeTime(project.lastActivity)}
      to={`/projects/${project.slug}`}
      milestone={
        project.milestone
          ? {
              title: project.milestone.title,
              percent: project.milestone.progress.percent,
              detail: [
                `${project.milestone.progress.completed} / ${project.milestone.progress.total}`,
                project.milestone.targetDate ? `Target ${shortDate(project.milestone.targetDate)}` : undefined,
              ]
                .filter(Boolean)
                .join(" · "),
              tone: healthTone(project.health ?? "no_target"),
            }
          : undefined
      }
    />
  );
}
