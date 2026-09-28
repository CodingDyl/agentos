import { Pin, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectState, ProjectSummary } from "@shared/agentos-types";
import { WORKSPACE_TYPE_LABELS, type WorkspaceType } from "@shared/workspace";
import { AppShell } from "@/components/os";
import { Meter, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperStage, SegmentedControl, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { sortProjects, stateLabel } from "@/features/projects/projects-model";
import { CreateProject } from "@/features/workspace";
import { formatRelativeTime } from "@/lib/format";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { sidebarWorkspaces, usePinnedWorkspaces } from "./workspace-preferences";

/**
 * Workspaces: every area of work, in one list.
 *
 * Products, businesses, clients, codebases and personal areas side by side,
 * because a day moves between them. Each row answers "where is this?" — its
 * status, where it is heading and what is next — without opening it. The
 * portfolio order is kept: what is in play, then what is parked, then what is
 * finished; archived work only appears when asked for.
 */

type Scope = "live" | "all" | "archived";

const SCOPES = [
  { value: "live" as const, label: "In play" },
  { value: "all" as const, label: "Everything" },
  { value: "archived" as const, label: "Archived" },
];

const GROUPS: readonly { label: string; states: readonly ProjectState[] }[] = [
  { label: "In play", states: ["active", "blocked"] },
  { label: "Parked", states: ["incubating", "paused"] },
  { label: "Finished", states: ["completed"] },
  { label: "Archived", states: ["archived"] },
];

function inScope(project: ProjectSummary, scope: Scope): boolean {
  if (scope === "archived") return project.state === "archived";
  if (project.state === "archived") return false;
  return scope === "all" || project.state === "active" || project.state === "blocked";
}

export function WorkspacesPage() {
  const navigationItems = useNavigationItems();
  const { data, isPending, isFetching, error, refetch } = useProjects();
  const [scope, setScope] = useState<Scope>("all");
  const [type, setType] = useState<WorkspaceType | "all">("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const presentTypes = useMemo(
    () => [...new Set(projects.map((project) => project.workspaceType ?? "general"))],
    [projects],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortProjects(projects).filter(
      (project) =>
        inScope(project, scope) &&
        (type === "all" || (project.workspaceType ?? "general") === type) &&
        (!needle || [project.name, project.type, project.status, project.nextAction].some((value) => value?.toLowerCase().includes(needle))),
    );
  }, [projects, query, scope, type]);

  const live = projects.filter((project) => project.state === "active" || project.state === "blocked").length;
  const parked = projects.filter((project) => project.state === "incubating" || project.state === "paused").length;

  return (
    <AppShell navigationItems={navigationItems} pageId="projects" activeHref="/workspaces" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="font-paper-display text-[34px] leading-[1.1] font-extrabold tracking-[-0.015em] text-paper-moss">Workspaces</h1>
            <p className="mt-1 text-[14px] text-paper-sage tabular-nums">
              {data ? `${live} in play · ${parked} parked · ${projects.length} in all` : "Reading the portfolio…"}
            </p>
          </div>
          <PaperButton variant="amber" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
            New workspace
          </PaperButton>
        </header>

        {isPending ? null : !data ? (
          <div className="mt-10">
            <h2 className="font-paper-display text-[21px] font-bold">The portfolio could not be read.</h2>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-6 text-paper-char">
              {error?.message ?? "The data adapter did not answer."} Workspaces are read from{" "}
              <span className="font-mono text-[13px]">~/AgentOS/projects</span>; check that the AgentOS server is running.
            </p>
            <PaperButton variant="ghost" className="mt-5" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Trying again…" : "Try again"}
            </PaperButton>
          </div>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <label className="relative min-w-[14rem] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a workspace…"
                  aria-label="Find a workspace"
                  className={cn(PAPER_INPUT, "w-full pl-8")}
                />
              </label>
              <SegmentedControl label="Show" options={SCOPES} value={scope} onChange={setScope} />
              {presentTypes.length > 1 ? (
                <select
                  aria-label="Workspace type"
                  value={type}
                  onChange={(event) => setType(event.target.value as WorkspaceType | "all")}
                  className={cn(PAPER_INPUT, "cursor-pointer pr-8")}
                >
                  <option value="all">All types</option>
                  {presentTypes.map((entry) => (
                    <option key={entry} value={entry}>
                      {WORKSPACE_TYPE_LABELS[entry]}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {visible.length === 0 ? (
              <p className="mt-12 text-[15px] text-paper-sage">
                {projects.length === 0 ? "No workspaces yet. Create one and AgentOS writes the files." : "Nothing matches."}
              </p>
            ) : (
              <div className="mt-8 space-y-10">
                {GROUPS.map((group) => {
                  const members = visible.filter((project) => group.states.includes(project.state));
                  if (members.length === 0) return null;
                  return <WorkspaceGroup key={group.label} label={group.label} workspaces={members} all={projects} />;
                })}
              </div>
            )}
          </>
        )}
      </PaperStage>

      {creating ? <CreateProject onClose={() => setCreating(false)} /> : null}
    </AppShell>
  );
}

function WorkspaceGroup({ label, workspaces, all }: { label: string; workspaces: ProjectSummary[]; all: ProjectSummary[] }) {
  const pins = usePinnedWorkspaces();
  const shown = sidebarWorkspaces(all, pins.pinned).map((project) => project.slug);

  return (
    <section aria-labelledby={`group-${label}`}>
      <h2 id={`group-${label}`} className="mb-2 flex items-center gap-2 font-paper-display text-[15px] font-bold">
        {label}
        <span className="rounded-full bg-paper-stone px-2 py-px font-paper-ui text-[11.5px] font-medium text-paper-char tabular-nums">{workspaces.length}</span>
      </h2>

      <ul className="divide-y divide-paper-stone border-y border-paper-mist">
        {workspaces.map((project) => {
          const pinned = shown.includes(project.slug);
          return (
            <li key={project.slug} className="group relative flex items-stretch transition-colors duration-150 hover:bg-paper-cream">
              <button
                type="button"
                onClick={() => pins.toggle(project.slug, shown)}
                aria-pressed={pinned}
                aria-label={pinned ? `Unpin ${project.name} from the sidebar` : `Pin ${project.name} to the sidebar`}
                title={pinned ? "Pinned to the sidebar" : "Pin to the sidebar"}
                className={cn(
                  "flex w-10 shrink-0 cursor-pointer items-start justify-center pt-5 transition-colors duration-150",
                  pinned ? "text-paper-amber-deep" : "text-paper-ash hover:text-paper-moss",
                  PAPER_FOCUS,
                )}
              >
                <Pin className={cn("size-3.5", pinned && "fill-current")} strokeWidth={1.75} aria-hidden="true" />
              </button>

              <Link
                to={`/workspaces/${project.slug}`}
                className={cn(
                  "grid min-w-0 flex-1 gap-x-8 gap-y-2 py-4 pr-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(9rem,0.7fr)]",
                  PAPER_FOCUS,
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">{project.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-paper-sage">
                    <Tag tone="muted">{WORKSPACE_TYPE_LABELS[project.workspaceType ?? "general"]}</Tag>
                    <span>{stateLabel(project.state)}</span>
                    {project.priority === "high" ? <span>· High priority</span> : null}
                  </span>
                </span>

                <span className="min-w-0 text-[14px] leading-6">
                  <span className={cn("line-clamp-2", project.status ? "text-paper-char" : "text-paper-sage")}>
                    {project.status ?? (project.nextAction ? `Next: ${project.nextAction}` : "No status recorded.")}
                  </span>
                  {project.status && project.nextAction ? (
                    <span className="mt-0.5 block truncate text-[13px] text-paper-sage">Next: {project.nextAction}</span>
                  ) : null}
                </span>

                <span className="min-w-0 text-[12.5px] text-paper-sage">
                  {project.milestone ? (
                    <>
                      <span className="block truncate text-paper-char">{project.milestone.title}</span>
                      <span className="mt-1.5 block">
                        <Meter value={project.milestone.progress.percent / 100} label={`${project.milestone.title} progress`} tone="amber" />
                      </span>
                      <span className="mt-1 block tabular-nums">{project.milestone.progress.percent}%</span>
                    </>
                  ) : project.lastActivity ? (
                    <span>Updated {formatRelativeTime(project.lastActivity)}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
