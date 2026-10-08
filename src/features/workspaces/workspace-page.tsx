import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Code,
  FileText,
  Images,
  MessageSquare,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Target,
  Globe,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ProjectDetail } from "@shared/agentos-types";
import {
  moduleLabel,
  resolveWorkspaceTabs,
  resolveWorkspaceType,
  WORKSPACE_MODULES,
  WORKSPACE_TYPE_LABELS,
  type WorkspaceModule,
  type WorkspaceType,
} from "@shared/workspace";
import { AppShell, ErrorState, LoadingState } from "@/components/os";
import { PAPER_FOCUS, PaperButton, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { DelegatePicker } from "@/features/projects/detail/delegate-picker";
import { ProjectActivity } from "@/features/projects/detail/project-activity";
import { ProjectAgents } from "@/features/projects/detail/project-agents";
import { ProjectDesigns } from "@/features/projects/detail/project-designs";
import { ProjectDocuments } from "@/features/projects/detail/project-documents";
import { ProjectRepository } from "@/features/projects/detail/project-repository";
import { ProjectRoadmap } from "@/features/projects/detail/project-roadmap";
import { ProjectSeo } from "@/features/projects/detail/project-seo";
import { DatabaseTab } from "@/features/databases";
import { useProjectDatabases } from "@/lib/agentos/databases";
import { useRebuildForWorkspace } from "@/lib/agentos/rebuilds";
import { WorkspaceRebuildTab } from "@/features/rebuild";
import { SiteTab } from "@/features/site";
import { stateLabel } from "@/features/projects/projects-model";
import { HEALTH_LABELS } from "@/features/projects/roadmap-model";
import { DecisionsEditor, ProjectSettings, SourceViewer, TaskBoard, useWorkspaceFeedback } from "@/features/workspace";
import { useArchiveProject, useProject, useProjects } from "@/lib/agentos/queries";
import { useFocusSession } from "@/features/learning/focus-session-context";
import { cn } from "@/lib/utils";
import { ClientsBlock, WorkspaceOverview } from "./workspace-overview";
import { recordRecentWorkspace, sidebarWorkspaces, usePinnedWorkspaces } from "./workspace-preferences";

/**
 * A workspace: one area of work, operated from one place.
 *
 * The tabs depend on what the workspace *is*. A business shows Clients and no
 * Repository; a codebase shows Repository and Agents up front; a client
 * engagement calls its roadmap Milestones. Whatever a type hides is still one
 * click away under More, and any `?tab=` link still opens — the type decides
 * what leads, never what exists.
 *
 * The header, tabs and Overview are paper. The working tabs below them —
 * the board, the roadmap, the repository — have not moved to paper yet, so
 * they sit on the dark desk the shell already provides.
 */

type WorkspaceTab = "overview" | WorkspaceModule;

/** Old tab names that must keep working in links people saved. */
const TAB_ALIASES: Record<string, WorkspaceTab> = { designs: "creative", milestones: "roadmap" };

/** Tabs drawn on paper. Everything else is still Editorial Terminal. */
const PAPER_TABS: ReadonlySet<WorkspaceTab> = new Set(["overview", "clients", "database", "rebuild", "site"]);

function readTab(value: string | null): WorkspaceTab {
  if (!value) return "overview";
  const tab = TAB_ALIASES[value] ?? value;
  return tab === "overview" || (WORKSPACE_MODULES as readonly string[]).includes(tab) ? (tab as WorkspaceTab) : "overview";
}

const CONTENT = "mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-12";

export function WorkspacePage() {
  const navigationItems = useNavigationItems();
  const { slug = "" } = useParams();
  const { data: project, isPending, isFetching, error, refetch } = useProject(slug);
  // A linked database earns the Database tab, the way a linked repository earns Repository.
  const databases = useProjectDatabases(slug);
  // A client website rebuild earns the Website rebuild tab.
  const rebuild = useRebuildForWorkspace(slug);

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = readTab(searchParams.get("tab"));

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [delegatingState, setDelegatingState] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  // The palette's "Delegate task" arrives as `?delegate=1`; the picker opens
  // and the parameter is dropped when it closes, so a reload does not reopen it.
  const delegating = delegatingState || searchParams.get("delegate") === "1";

  useEffect(() => {
    if (slug) recordRecentWorkspace(slug);
  }, [slug]);

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
    (tab: WorkspaceTab, extra?: Record<string, string>) => {
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

  // Hands off to the agent console with this workspace in context. The console
  // prepares the command; the operator still chooses to run it. A focus
  // session (a timer, optional music) starts beside it in the shell.
  const focus = useFocusSession();
  const projectName = project?.name;
  const startFocus = useCallback(() => {
    focus?.start({ project: slug, projectName });
    navigate(`/agent?project=${encodeURIComponent(slug)}&run=${encodeURIComponent(`/work-on ${slug}`)}`);
  }, [focus, navigate, projectName, slug]);

  const askHermes = useCallback(() => {
    navigate(`/agent?project=${encodeURIComponent(slug)}`);
  }, [navigate, slug]);

  const addTask = useCallback(() => {
    selectTab("tasks");
    setAddingTask(true);
  }, [selectTab]);

  const type: WorkspaceType = project
    ? resolveWorkspaceType(project.configuration.workspaceType, project.type)
    : "general";
  const tabs = project
    ? resolveWorkspaceTabs({
        type,
        configured: project.configuration.modules,
        hasRepository: !!project.git.repositoryPath,
        hasDatabase: (databases.data?.length ?? 0) > 0,
        hasRebuild: Boolean(rebuild.data),
        hasSite: Boolean(project.configuration.vercelProjectId),
      })
    : { primary: [], more: [] };

  const onPaper = PAPER_TABS.has(activeTab);

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="project"
      activeHref="/workspaces"
      contextLabel={project ? `Workspace / ${project.name}` : undefined}
      modelLabel="Model / AgentOS V1"
    >
      {isPending ? (
        <div className={cn(CONTENT, "py-10")}>
          <LoadingState label="AgentOS" message="Reading workspace…" detail="Vault / reading" />
        </div>
      ) : !project ? (
        <div className={cn(CONTENT, "py-10")}>
          <ErrorState
            label="Workspace unavailable"
            title={error?.message ?? "This workspace could not be read."}
            hint={
              <>
                Workspaces come from <span className="font-mono text-os-subtle">projects/PORTFOLIO.md</span>. Check
                the address, or that the data adapter is running.
              </>
            }
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        </div>
      ) : (
        <div className={cn("min-h-full", onPaper && "bg-paper-white")}>
          <div className="bg-paper-white font-paper-ui text-paper-moss">
            <div className={cn(CONTENT, "pt-8 lg:pt-10")}>
              <WorkspaceHeader
                project={project}
                type={type}
                showDelegate={tabs.primary.includes("agents") || tabs.primary.includes("repository")}
                onAddTask={addTask}
                onStartFocus={startFocus}
                onAskHermes={askHermes}
                onDelegate={() => setDelegating(true)}
                onOpenSettings={() => setSettingsOpen(true)}
                onViewSite={() => selectTab("site")}
              />

              <WorkspaceTabs
                type={type}
                primary={tabs.primary}
                more={tabs.more}
                active={activeTab}
                openTasks={project.tasks.now.length + project.tasks.next.length + project.tasks.later.length}
                changedFiles={project.git.changedFiles.length}
                onSelect={(tab) => selectTab(tab)}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </div>
          </div>

          <div
            id={`panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
            tabIndex={0}
            className={cn(
              CONTENT,
              "pt-10 pb-12 outline-none",
              onPaper ? "bg-paper-white font-paper-ui text-paper-moss" : "focus-visible:ring-1 focus-visible:ring-os-border-strong",
            )}
          >
            <WorkspacePanel
              project={project}
              type={type}
              primary={tabs.primary}
              tab={activeTab}
              addingTask={addingTask}
              onAddingHandled={() => setAddingTask(false)}
              onSelectTab={selectTab}
              onOpenSettings={() => setSettingsOpen(true)}
              onAskHermes={askHermes}
              onDelegate={() => setDelegating(true)}
              onStartFocus={startFocus}
            />
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
        </div>
      )}
    </AppShell>
  );
}

function WorkspacePanel({
  project,
  type,
  primary,
  tab,
  addingTask,
  onAddingHandled,
  onSelectTab,
  onOpenSettings,
  onAskHermes,
  onDelegate,
  onStartFocus,
}: {
  project: ProjectDetail;
  type: WorkspaceType;
  primary: WorkspaceModule[];
  tab: WorkspaceTab;
  addingTask: boolean;
  onAddingHandled: () => void;
  onSelectTab: (tab: WorkspaceTab, extra?: Record<string, string>) => void;
  onOpenSettings: () => void;
  onAskHermes: () => void;
  onDelegate: () => void;
  onStartFocus: () => void;
}) {
  switch (tab) {
    case "overview":
      return <WorkspaceOverview project={project} type={type} modules={primary} onOpenSettings={onOpenSettings} onSelectTab={onSelectTab} />;
    case "tasks":
      return <TaskBoard project={project.slug} startAdding={addingTask} onAddingHandled={onAddingHandled} />;
    case "roadmap":
      return <ProjectRoadmap slug={project.slug} onAsk={onAskHermes} />;
    case "documents":
      return <ProjectDocuments project={project} />;
    case "creative":
      return <ProjectDesigns slug={project.slug} designBoard={project.configuration.designBoard} />;
    case "seo":
      return <ProjectSeo slug={project.slug} vercelProjectId={project.configuration.vercelProjectId} onOpenSettings={onOpenSettings} />;
    case "repository":
      return <ProjectRepository slug={project.slug} />;
    case "database":
      return <DatabaseTab slug={project.slug} />;
    case "rebuild":
      return <WorkspaceRebuildTab slug={project.slug} />;
    case "site":
      return <SiteTab slug={project.slug} onOpenSettings={onOpenSettings} />;
    case "decisions":
      return <DecisionsEditor project={project.slug} />;
    case "activity":
      return <ProjectActivity slug={project.slug} sessions={project.sessions} />;
    case "agents":
      return <ProjectAgents project={project} onAsk={onAskHermes} onDelegate={onDelegate} onStartSession={onStartFocus} />;
    case "clients":
      return (
        <div className="max-w-[44rem]">
          <ClientsBlock />
          <p className="mt-8 max-w-[60ch] text-[13.5px] leading-6 text-paper-sage">
            Clients are workspaces whose type is Client. Revenue, receivables and recurring services will live here
            once they are tracked; for now each client's own workspace holds its tasks, milestones and documents.
          </p>
        </div>
      );
  }
}

function WorkspaceHeader({
  project,
  type,
  showDelegate,
  onAddTask,
  onStartFocus,
  onAskHermes,
  onDelegate,
  onOpenSettings,
  onViewSite,
}: {
  project: ProjectDetail;
  type: WorkspaceType;
  showDelegate: boolean;
  onAddTask: () => void;
  onStartFocus: () => void;
  onAskHermes: () => void;
  onDelegate: () => void;
  onOpenSettings: () => void;
  onViewSite: () => void;
}) {
  const [viewingSource, setViewingSource] = useState(false);
  const archive = useArchiveProject(project.slug);
  const feedback = useWorkspaceFeedback();
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const pins = usePinnedWorkspaces();

  const archived = project.state === "archived";
  const shownInSidebar = sidebarWorkspaces(projects?.projects ?? [], pins.pinned).map((entry) => entry.slug);
  const pinned = shownInSidebar.includes(project.slug);

  const toggleArchive = () =>
    archive.mutate(archived ? "incubating" : undefined, {
      onSuccess: () => feedback.recordEdit(archived ? `${project.name} restored.` : `${project.name} archived.`),
      onError: (error) => feedback.reportFailure(error),
    });

  return (
    <header>
      <Link
        to="/workspaces"
        className={cn(
          "-mx-2 inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-none px-2 text-[13px] font-medium text-paper-sage transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss",
          PAPER_FOCUS,
        )}
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        Workspaces
      </Link>

      <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="font-paper-display text-[34px] leading-[1.08] font-extrabold tracking-[-0.015em] text-balance text-paper-moss sm:text-[42px]">
            {project.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-paper-char">
            <Tag tone="blue">{WORKSPACE_TYPE_LABELS[type]}</Tag>
            <span>{stateLabel(project.state)}</span>
            <span className="text-paper-ash" aria-hidden="true">·</span>
            <span className="capitalize">{project.priority} priority</span>
            {project.health && project.health !== "no_target" ? (
              <>
                <span className="text-paper-ash" aria-hidden="true">·</span>
                <span>{HEALTH_LABELS[project.health]}</span>
              </>
            ) : null}
          </div>
          {project.status ? <p className="mt-3 max-w-[68ch] text-[15px] leading-6 text-paper-char">{project.status}</p> : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <PaperButton variant="amber" onClick={onAddTask}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Add task
          </PaperButton>
          <PaperButton variant="ghost" onClick={onStartFocus} title={`Prepares /work-on ${project.slug} in the console`}>
            <Target className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Start focus
          </PaperButton>
          {project.configuration.vercelProjectId ? (
            <PaperButton variant="ghost" onClick={onViewSite} title="Opens the live site here, in the Site tab">
              <Globe className="size-3.5" strokeWidth={2} aria-hidden="true" />
              View site
            </PaperButton>
          ) : null}
          {showDelegate ? (
            <PaperButton variant="ghost" onClick={onDelegate}>
              <Send className="size-3.5" strokeWidth={2} aria-hidden="true" />
              Delegate
            </PaperButton>
          ) : null}
          <PaperButton variant="ghost" onClick={() => navigate(`/coder?workspace=${project.slug}`)} title="Open this workspace in Coder">
            <Code className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Open in Coder
          </PaperButton>

          <Menu
            label="More actions"
            trigger={<MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden="true" />}
            items={[
              { icon: Settings2, label: "Settings", onSelect: onOpenSettings },
              {
                icon: pinned ? PinOff : Pin,
                label: pinned ? "Unpin from sidebar" : "Pin to sidebar",
                onSelect: () => pins.toggle(project.slug, shownInSidebar),
              },
              { icon: MessageSquare, label: "Ask Hermes", onSelect: onAskHermes },
              ...(showDelegate ? [] : [{ icon: Send, label: "Delegate a task", onSelect: onDelegate }]),
              {
                icon: Images,
                label: "Open in Creative",
                onSelect: () => void navigate(`/designs?project=${encodeURIComponent(project.slug)}`),
              },
              { icon: Code, label: "Open in Coder", onSelect: () => navigate(`/coder?workspace=${project.slug}`) },
              // The vault, visible. AgentOS is a better way to operate these
              // files, not a replacement for them.
              { icon: FileText, label: "View source", onSelect: () => setViewingSource(true) },
              "divider",
              { icon: archived ? RotateCcw : Archive, label: archived ? "Restore workspace" : "Archive workspace", onSelect: toggleArchive },
            ]}
          />
        </div>
      </div>

      {viewingSource ? <SourceViewer project={project.slug} onClose={() => setViewingSource(false)} /> : null}
    </header>
  );
}

function WorkspaceTabs({
  type,
  primary,
  more,
  active,
  openTasks,
  changedFiles,
  onSelect,
  onOpenSettings,
}: {
  type: WorkspaceType;
  primary: WorkspaceModule[];
  more: WorkspaceModule[];
  active: WorkspaceTab;
  openTasks: number;
  changedFiles: number;
  onSelect: (tab: WorkspaceTab) => void;
  onOpenSettings: () => void;
}) {
  // A module opened from More (or a deep link) joins the row while it is open,
  // so the active tab is always visible and underlined.
  const visible: WorkspaceTab[] = ["overview", ...primary];
  if (!visible.includes(active)) visible.push(active);

  const count = (tab: WorkspaceTab): number | undefined =>
    tab === "tasks" ? openTasks || undefined : tab === "repository" ? changedFiles || undefined : undefined;

  const hidden = more.filter((module) => module !== active);

  return (
    <div className="mt-8 flex items-end gap-1 shadow-[inset_0_-1px_0_var(--paper-mist)]">
      <div role="tablist" aria-label="Workspace sections" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const selected = tab === active;
          const badge = count(tab);
          return (
            <button
              key={tab}
              id={`tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${tab}`}
              onClick={() => onSelect(tab)}
              className={cn(
                "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[6px] border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors duration-150",
                PAPER_FOCUS,
                selected
                  ? "border-paper-blue bg-paper-white text-paper-blue"
                  : "border-transparent text-paper-sage hover:bg-paper-linen hover:text-paper-moss",
              )}
            >
              {tab === "overview" ? "Overview" : moduleLabel(tab, type)}
              {badge ? (
                <span className="rounded-full bg-paper-stone px-1.5 text-[12px] leading-[17px] text-paper-char tabular-nums">{badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="shrink-0 pb-1">
        <Menu
          label="More sections"
          align="right"
          trigger={
            <span className="inline-flex items-center gap-1 text-[13.5px] font-medium">
              More
              <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </span>
          }
          items={[
            ...hidden.map((module) => ({ label: moduleLabel(module, type), onSelect: () => onSelect(module) })),
            ...(hidden.length > 0 ? (["divider"] as const) : []),
            { icon: Settings2, label: "Choose tabs…", onSelect: onOpenSettings },
          ]}
        />
      </div>
    </div>
  );
}

type MenuItem = { icon?: typeof Settings2; label: string; onSelect: () => void } | "divider";

/** A small paper dropdown: click to open, Escape or an outside click to close. */
function Menu({
  label,
  trigger,
  items,
  align = "right",
}: {
  label: string;
  trigger: ReactNode;
  items: readonly MenuItem[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-none px-2 text-paper-sage transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss",
          open && "bg-paper-linen text-paper-moss",
          PAPER_FOCUS,
        )}
      >
        {trigger}
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-30 mt-1.5 w-56 overflow-hidden rounded-none border border-paper-mist bg-paper-white py-1 font-paper-ui",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) =>
            item === "divider" ? (
              <div key={`divider-${index}`} className="my-1 h-px bg-paper-stone" aria-hidden="true" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-paper-char transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss",
                  PAPER_FOCUS,
                )}
              >
                {item.icon ? <item.icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : <span className="w-3.5" aria-hidden="true" />}
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
