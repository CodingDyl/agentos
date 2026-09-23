import { useCallback, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ProjectDetail } from "@shared/agentos-types";
import { AppShell, ErrorState, LoadingState, TabBar, type TabOption } from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { useProject } from "@/lib/agentos/queries";
import { DecisionsEditor, ProjectSettings, TaskBoard } from "@/features/workspace";
import { DelegatePicker } from "./delegate-picker";
import { ProjectActivity } from "./project-activity";
import { ProjectAgents } from "./project-agents";
import { ProjectDesigns } from "./project-designs";
import { ProjectHeader } from "./project-header";
import { ProjectOverview } from "./project-overview";
import { ProjectRepository } from "./project-repository";
import { ProjectRoadmap } from "./project-roadmap";
import { ProjectDocuments } from "./project-documents";

/**
 * The project, as the place it is operated from.
 *
 * Nine tabs: what it is, what to do, where it is going, what it looks like,
 * where the code actually is, what was decided, what happened, and who does
 * the work. The header's actions work from any tab —
 * `+ Task` and `Delegate` switch to Tasks with the right thing open — so the
 * operator never has to go looking for the affordance.
 */

const TAB_VALUES = ["overview", "tasks", "roadmap", "documents", "designs", "repository", "decisions", "activity", "agents"] as const;

type ProjectTab = (typeof TAB_VALUES)[number];

function isProjectTab(value: string | null): value is ProjectTab {
  return value !== null && (TAB_VALUES as readonly string[]).includes(value);
}

function buildTabs(project: ProjectDetail): TabOption<ProjectTab>[] {
  const openTasks = project.tasks.now.length + project.tasks.next.length + project.tasks.later.length;

  return [
    { value: "overview", label: "Overview" },
    { value: "tasks", label: "Tasks", count: openTasks },
    { value: "roadmap", label: "Roadmap" },
    { value: "documents", label: "Documents" },
    { value: "designs", label: "Designs" },
    // Uncommitted work is a count worth carrying on the tab: it is the thing
    // that silently blocks an approved job from being applied.
    {
      value: "repository",
      label: "Repository",
      count: project.git.changedFiles.length || undefined,
    },
    { value: "decisions", label: "Decisions", count: project.decisions.length },
    { value: "activity", label: "Activity" },
    { value: "agents", label: "Agents" },
  ];
}

export function ProjectDetailPage() {
  const navigationItems = useNavigationItems();
  const { slug = "" } = useParams();
  const { data: project, isPending, isFetching, error, refetch } = useProject(slug);

  // Tab lives in the URL so a section can be linked to and survives a reload.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: ProjectTab = isProjectTab(tabParam) ? tabParam : "overview";

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [delegatingState, setDelegatingState] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  // The palette's "Delegate work" arrives as `?delegate=1`; the picker opens
  // and the parameter is dropped when it closes, so a reload does not reopen it.
  const delegating = delegatingState || searchParams.get("delegate") === "1";

  const setDelegating = useCallback(
    (open: boolean) => {
      setDelegatingState(open);
      if (!open && searchParams.get("delegate")) {
        setSearchParams(
          (params) => {
            const next = new URLSearchParams(params);
            next.delete("delegate");
            return next;
          },
          { replace: true },
        );
      }
    },
    [searchParams, setSearchParams],
  );

  const navigate = useNavigate();

  const selectTab = useCallback(
    (tab: ProjectTab, extra?: Record<string, string>) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          if (tab === "overview") next.delete("tab");
          else next.set("tab", tab);
          next.delete("delegate");
          // A document open in one tab is not open in the next.
          next.delete("doc");
          next.delete("origin");
          for (const [key, value] of Object.entries(extra ?? {})) next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Hands off to the agent console with this project in context. The console
  // prepares the command; the operator still chooses to run it.
  const startSession = useCallback(() => {
    navigate(`/agent?project=${encodeURIComponent(slug)}`);
  }, [navigate, slug]);

  const askHermes = useCallback(() => {
    navigate(`/agent?project=${encodeURIComponent(slug)}`);
  }, [navigate, slug]);

  const addTask = useCallback(() => {
    selectTab("tasks");
    setAddingTask(true);
  }, [selectTab]);

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="project"
      activeHref="/projects"
      contextLabel={project ? `Context / ${project.name}` : undefined}
      modelLabel="Model / AgentOS V1"
    >
      <div className="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        {isPending ? (
          <LoadingState label="AgentOS" message="Reading project…" detail="Vault / reading" />
        ) : !project ? (
          <ErrorState
            label="Project unavailable"
            title={error?.message ?? "This project could not be read."}
            hint={
              <>
                Projects come from{" "}
                <span className="font-mono text-os-subtle">projects/PORTFOLIO.md</span>. Check the slug, or that
                the data adapter is running.
              </>
            }
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <>
            <ProjectHeader
              project={project}
              sessionCommand={`/work-on ${project.slug}`}
              onStartSession={startSession}
              onAddTask={addTask}
              onDelegate={() => setDelegating(true)}
              onOpenSettings={() => setSettingsOpen(true)}
            />

            <TabBar
              label="Project sections"
              options={buildTabs(project)}
              value={activeTab}
              onChange={(tab) => selectTab(tab)}
              className="mt-10"
            />

            <div
              id={`panel-${activeTab}`}
              role="tabpanel"
              aria-labelledby={`tab-${activeTab}`}
              tabIndex={0}
              className="os-focus-ring mt-10 pb-4"
            >
              {activeTab === "overview" ? (
                <ProjectOverview
                  project={project}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenRepository={() => selectTab("repository")}
                />
              ) : activeTab === "tasks" ? (
                <TaskBoard
                  project={project.slug}
                  startAdding={addingTask}
                  onAddingHandled={() => setAddingTask(false)}
                />
              ) : activeTab === "roadmap" ? (
                <ProjectRoadmap slug={project.slug} onAsk={askHermes} />
              ) : activeTab === "documents" ? (
                <ProjectDocuments project={project} />
              ) : activeTab === "designs" ? (
                <ProjectDesigns slug={project.slug} designBoard={project.configuration.designBoard} />
              ) : activeTab === "repository" ? (
                <ProjectRepository slug={project.slug} />
              ) : activeTab === "decisions" ? (
                <DecisionsEditor project={project.slug} />
              ) : activeTab === "activity" ? (
                <ProjectActivity slug={project.slug} sessions={project.sessions} />
              ) : (
                <ProjectAgents
                  project={project}
                  onAsk={askHermes}
                  onDelegate={() => setDelegating(true)}
                  onStartSession={startSession}
                />
              )}
            </div>

            {settingsOpen ? <ProjectSettings slug={project.slug} onClose={() => setSettingsOpen(false)} /> : null}

            {delegating ? (
              <DelegatePicker
                project={project}
                onClose={() => setDelegating(false)}
                onPick={(task) => {
                  setDelegating(false);
                  selectTab("tasks", { task: task.id });
                }}
              />
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
