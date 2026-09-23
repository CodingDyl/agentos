import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AppShell,
  CommandButton,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/os";
import { CreateProject } from "@/features/workspace";
import { useNavigationItems } from "@/config/use-navigation";
import { useProjects } from "@/lib/agentos/queries";
import { ProjectFilters } from "./project-filters";
import { ProjectList } from "./project-list";
import { ProjectSummary } from "./project-summary";
import { filterProjects, type ProjectFilter } from "./projects-model";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

export function ProjectsPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useProjects();
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [creating, setCreating] = useState(false);

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const visibleProjects = useMemo(
    () => filterProjects(projects, filter),
    [projects, filter],
  );

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="projects"
      activeHref="/projects"
      modelLabel="Model / AgentOS V1"
    >
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="AgentOS"
            message="Reading project portfolio…"
            detail="Vault / reading"
          />
        ) : !data ? (
          <ErrorState
            label="Project data unavailable"
            title={
              <>
                Could not read <span className="font-mono">~/AgentOS</span>.
              </>
            }
            detail={error?.message}
            hint={
              <>
                The data adapter reads the vault directly. Check that it is
                running —{" "}
                <span className="font-mono text-os-subtle">npm run dev</span>{" "}
                starts it alongside the app.
              </>
            }
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <>
            <PageHeader
              title="Projects"
              description="Your active work and incubating ideas, read from the AgentOS portfolio."
              actions={
                <div className="flex flex-wrap items-center gap-4">
                  {projects.length > 0 ? (
                    <ProjectFilters
                      projects={projects}
                      value={filter}
                      onChange={setFilter}
                    />
                  ) : null}
                  <CommandButton
                    variant="secondary"
                    icon={Plus}
                    iconPosition="start"
                    onClick={() => setCreating(true)}
                  >
                    New project
                  </CommandButton>
                </div>
              }
            />

            {projects.length === 0 ? (
              <EmptyState
                label="No projects"
                description="Your portfolio is empty. Create one — AgentOS writes the files."
                className="mt-10"
              />
            ) : (
              <>
                <ProjectSummary projects={projects} className="mt-10" />
                <ProjectList
                  projects={visibleProjects}
                  emptyDescription="No projects are in that state right now."
                  className="mt-10 pb-4"
                />
              </>
            )}
          </>
        )}
      </div>

      {creating ? <CreateProject onClose={() => setCreating(false)} /> : null}
    </AppShell>
  );
}
