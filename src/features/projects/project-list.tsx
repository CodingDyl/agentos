import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectSummary } from "@shared/agentos-types";
import { EmptyState, HairlineCard, Section } from "@/components/os";
import { useWorkspaceFeedback } from "@/features/workspace";
import { useArchiveProject } from "@/lib/agentos/queries";
import { groupProjectsByState } from "./projects-model";
import { ProjectRow } from "./project-row";

export interface ProjectListProps {
  projects: ProjectSummary[];
  /** Shown when a filter excludes everything, as distinct from an empty vault. */
  emptyDescription?: string;
  className?: string;
}

/**
 * The portfolio, grouped by state in reading order: what is in play, then what
 * is parked, then what is done.
 *
 * Archived projects are folded, not filtered out. They exist — their history,
 * costs and designs are still referenced — but they are the last thing anyone
 * scanning this list is looking for, so they sit under one row with a count
 * and a `Restore` on each.
 */
export function ProjectList({
  projects,
  emptyDescription = "No projects match this filter.",
  className,
}: ProjectListProps) {
  const groups = groupProjectsByState(projects);
  const archived = groups.find((group) => group.state === "archived");
  const visible = groups.filter((group) => group.state !== "archived");

  if (groups.length === 0) {
    return <EmptyState label="No matches" description={emptyDescription} className={className} />;
  }

  return (
    <div className={className}>
      {/* No per-group count: the summary bar above already states them. */}
      <div className="space-y-10">
        {visible.map((group) => (
          <Section key={group.state} label={group.label}>
            <HairlineCard className="overflow-hidden">
              <ul className="divide-y divide-os-border">
                {group.projects.map((project) => (
                  <ProjectRow key={project.slug} project={project} />
                ))}
              </ul>
            </HairlineCard>
          </Section>
        ))}

        {archived ? <ArchivedProjects projects={archived.projects} /> : null}
      </div>
    </div>
  );
}

function ArchivedProjects({ projects }: { projects: ProjectSummary[] }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="border-t border-os-border pt-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="os-focus-ring os-meta -mx-1 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
        Archived
        <span className="tabular-nums">{projects.length}</span>
      </button>

      {open ? (
        <HairlineCard className="mt-4 overflow-hidden">
          <ul className="divide-y divide-os-border">
            {projects.map((project) => (
              <ArchivedRow key={project.slug} project={project} />
            ))}
          </ul>
        </HairlineCard>
      ) : null}
    </section>
  );
}

function ArchivedRow({ project }: { project: ProjectSummary }) {
  const restore = useArchiveProject(project.slug);
  const feedback = useWorkspaceFeedback();

  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-3.5">
      <Link
        to={`/projects/${project.slug}`}
        className="os-focus-ring min-w-0 flex-1 cursor-pointer rounded-md text-[15px] leading-6 text-os-muted transition-colors duration-150 hover:text-foreground"
      >
        {project.name}
        {project.type ? <span className="os-meta ml-3 text-os-subtle">{project.type}</span> : null}
      </Link>

      <button
        type="button"
        disabled={restore.isPending}
        onClick={() =>
          restore.mutate("incubating", {
            onSuccess: () => feedback.recordEdit(`${project.name} restored.`),
            onError: (error) => feedback.reportFailure(error),
          })
        }
        className="os-focus-ring os-meta inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground disabled:opacity-40"
      >
        <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        {restore.isPending ? "Restoring" : "Restore"}
      </button>
    </li>
  );
}
