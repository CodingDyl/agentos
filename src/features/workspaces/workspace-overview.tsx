import { ArrowRight, FileText, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ProjectDetail, RoadmapTask } from "@shared/agentos-types";
import type { TaskDelegationState } from "@shared/delegation-types";
import type { WorkspaceModule, WorkspaceType } from "@shared/workspace";
import { Meter, PAPER_FOCUS, Tag } from "@/components/paper";
import { SOURCE_LABELS, TYPE_LABELS } from "@/features/projects/documents-model";
import { taskJobState } from "@/features/projects/detail/task-job-state";
import { HEALTH_LABELS } from "@/features/projects/roadmap-model";
import { formatRelativeTime } from "@/lib/format";
import {
  useProjectDocuments,
  useProjectProse,
  useProjectSettings,
  useProjects,
  useRoadmap,
  useTaskDelegations,
  useWriteProse,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { PaperInlineEdit } from "./paper-inline-edit";

/**
 * A workspace's Overview: where is this area of work right now?
 *
 * Universal on purpose. A business, a client engagement and a codebase all
 * have a goal, a status, a next action, things they are waiting on and
 * documents that matter — so those lead, in that order, whatever the type.
 * Repository state only appears when the workspace shows a Repository tab,
 * and agents appear only where they are actually doing something: as a line
 * on the task they hold, not as a panel of their own.
 */

const NEXT_LIMIT = 5;

export function WorkspaceOverview({
  project,
  type,
  modules,
  onOpenSettings,
  onSelectTab,
}: {
  project: ProjectDetail;
  type: WorkspaceType;
  /** The tabs this workspace shows. Decides which optional blocks appear. */
  modules: readonly WorkspaceModule[];
  onOpenSettings: () => void;
  onSelectTab: (tab: WorkspaceModule, extra?: Record<string, string>) => void;
}) {
  const slug = project.slug;
  const prose = useProjectProse(slug);
  const write = useWriteProse(slug);
  const settings = useProjectSettings(slug);
  const roadmap = useRoadmap(slug);
  const delegations = useTaskDelegations(slug);

  const jobs = new Map((delegations.data?.delegations ?? []).map((entry) => [entry.taskId, entry]));
  const roadmapTasks = [...(roadmap.data?.milestones.flatMap((milestone) => milestone.tasks) ?? []), ...(roadmap.data?.unplanned ?? [])];
  const byId = new Map(roadmapTasks.map((task) => [task.id, task]));

  // Now first, then Next — "what should I do next?" is the Now list when it
  // has anything in it, and the head of Next when it does not.
  const openNow = project.tasks.now.filter((task) => !task.completed);
  const queue = (openNow.length > 0 ? openNow : project.tasks.next.filter((task) => !task.completed)).slice(0, NEXT_LIMIT);

  const waiting = roadmapTasks.filter((task) => task.status === "blocked" || task.status === "review");
  const goal = settings.data?.goal;

  return (
    <div className="grid gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-11">
        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-paper-display text-[15px] leading-6 font-bold tracking-[-0.01em]">Goal</h2>
            <TextButton onClick={onOpenSettings}>Edit</TextButton>
          </div>
          <p
            className={cn(
              "mt-1.5 max-w-[60ch] font-paper-display text-[21px] leading-[1.4] font-medium tracking-[-0.01em] text-balance",
              goal ? "text-paper-moss" : "text-paper-sage",
            )}
          >
            {goal ?? (settings.isPending ? "Reading…" : "No goal written yet. What is this workspace for?")}
          </p>
        </section>

        <PaperInlineEdit
          label="Current status"
          value={prose.data?.status.body}
          placeholder="No status recorded yet."
          busy={prose.isPending}
          rows={3}
          onReload={() => void prose.refetch()}
          onSave={(body) => write.mutateAsync({ field: "status", body, expectedRevision: prose.data?.status.revision })}
        />

        <Block
          title="Next actions"
          action={<TextButton onClick={() => onSelectTab("tasks")}>All tasks</TextButton>}
        >
          {queue.length === 0 ? (
            <Quiet>Nothing is queued in Now or Next.</Quiet>
          ) : (
            <ul className="divide-y divide-paper-stone border-y border-paper-stone">
              {queue.map((task) => (
                <TaskLine
                  key={task.id ?? task.title}
                  title={task.title}
                  id={task.id}
                  status={task.id ? byId.get(task.id)?.status : undefined}
                  job={task.id ? jobs.get(task.id) : undefined}
                  onOpen={task.id ? () => onSelectTab("tasks", { task: task.id as string }) : undefined}
                />
              ))}
            </ul>
          )}
        </Block>

        <Block title="Waiting">
          {waiting.length === 0 ? (
            <Quiet>Nothing is blocked or waiting for review.</Quiet>
          ) : (
            <ul className="space-y-3">
              {waiting.map((task) => (
                <WaitingLine key={task.id} task={task} byId={byId} job={jobs.get(task.id)} onOpen={() => onSelectTab("tasks", { task: task.id })} />
              ))}
            </ul>
          )}
        </Block>

        <PaperInlineEdit
          label="Purpose"
          value={prose.data?.purpose.body}
          placeholder="No purpose written yet."
          busy={prose.isPending}
          rows={6}
          onReload={() => void prose.refetch()}
          onSave={(body) => write.mutateAsync({ field: "purpose", body, expectedRevision: prose.data?.purpose.revision })}
        />
      </div>

      <aside className="min-w-0 space-y-10">
        <MilestoneCard project={project} type={type} onOpen={() => onSelectTab("roadmap")} />

        <KeyDocuments slug={slug} onOpenAll={() => onSelectTab("documents")} />

        {modules.includes("clients") ? <ClientsBlock onOpenAll={() => onSelectTab("clients")} /> : null}

        {modules.includes("repository") ? <RepositoryLine project={project} onOpen={() => onSelectTab("repository")} /> : null}

        <Block title="Recent" action={<TextButton onClick={() => onSelectTab("activity")}>Activity</TextButton>}>
          {project.sessions[0] ? (
            <div>
              <p className="text-[12.5px] text-paper-sage">{project.sessions[0].date}</p>
              <p className="mt-1 text-[14px] leading-[1.55] text-paper-char">
                {project.sessions[0].resumeHere ?? project.sessions[0].completed?.[0] ?? "A session was recorded without notes."}
              </p>
            </div>
          ) : (
            <Quiet>
              {project.lastActivity ? `Files last changed ${formatRelativeTime(project.lastActivity)}.` : "No sessions recorded yet."}
            </Quiet>
          )}
        </Block>
      </aside>
    </div>
  );
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-paper-display text-[15px] leading-6 font-bold tracking-[-0.01em]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-6 text-paper-sage">{children}</p>;
}

function TextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-[4px] px-2 text-[13px] font-medium text-paper-sage transition-colors duration-150 hover:bg-paper-linen hover:text-paper-moss",
        PAPER_FOCUS,
      )}
    >
      {children}
    </button>
  );
}

const STATUS_TAG: Partial<Record<RoadmapTask["status"], { label: string; tone: "flame" | "green" | "marigold" | "muted" | "blue" }>> = {
  ready: { label: "Ready", tone: "green" },
  in_progress: { label: "In progress", tone: "blue" },
  review: { label: "Review", tone: "marigold" },
  blocked: { label: "Blocked", tone: "flame" },
};

/**
 * One task, with the agent holding it — if one is.
 *
 * This is where agents surface now: `Claude · Running` on the task it is
 * doing, with a way to the job, rather than on a screen of their own.
 */
function TaskLine({
  id,
  title,
  status,
  job,
  onOpen,
}: {
  id?: string;
  title: string;
  status?: RoadmapTask["status"];
  job?: TaskDelegationState;
  onOpen?: () => void;
}) {
  const tag = status ? STATUS_TAG[status] : undefined;
  const jobState = job?.active || job?.status === "awaiting_review" ? taskJobState(job.status) : undefined;

  const body = (
    <>
      <span className="w-14 shrink-0 font-mono text-[12px] text-paper-sage tabular-nums">{id ?? "—"}</span>
      <span className="min-w-0 flex-1 text-[14.5px] leading-6 text-paper-moss">{title}</span>
      {tag ? <Tag tone={tag.tone}>{tag.label}</Tag> : null}
    </>
  );

  return (
    <li className="py-0.5">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn("flex w-full cursor-pointer items-baseline gap-3 rounded-[4px] px-2 py-2 text-left transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-baseline gap-3 px-2 py-2">{body}</div>
      )}
      {job && jobState ? (
        <div className="mb-1.5 ml-[4.75rem] flex items-center gap-2 text-[12.5px] text-paper-char">
          <span
            className={cn("size-1.5 rounded-full", jobState.tone === "attention" ? "bg-paper-flame" : "bg-paper-blue motion-safe:animate-pulse")}
            aria-hidden="true"
          />
          <span className="capitalize">{job.worker ?? "Worker"}</span>
          <span className="text-paper-sage">· {jobState.label}</span>
          <Link to={`/workers/jobs/${job.jobId}`} className={cn("ml-1 rounded-[3px] font-medium text-paper-blue hover:underline", PAPER_FOCUS)}>
            View
          </Link>
        </div>
      ) : null}
    </li>
  );
}

function WaitingLine({
  task,
  byId,
  job,
  onOpen,
}: {
  task: RoadmapTask;
  byId: Map<string, RoadmapTask>;
  job?: TaskDelegationState;
  onOpen: () => void;
}) {
  const reason =
    task.status === "review"
      ? `${job?.worker ? `${job.worker[0].toUpperCase()}${job.worker.slice(1)} finished` : "Work finished"} — needs your review`
      : task.blockedBy.length > 0
        ? `Waiting on ${task.blockedBy.map((id) => (byId.get(id) ? `${id} ${byId.get(id)?.title}` : id)).join(", ")}`
        : "Blocked";

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn("group flex w-full cursor-pointer items-start gap-3 rounded-[4px] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
      >
        <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", task.status === "review" ? "bg-paper-amber" : "bg-paper-flame")} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] leading-6 text-paper-moss">
            <span className="mr-2 font-mono text-[12px] text-paper-sage">{task.id}</span>
            {task.title}
          </span>
          <span className="block text-[13px] leading-5 text-paper-char">{reason}</span>
        </span>
      </button>
    </li>
  );
}

function MilestoneCard({ project, type, onOpen }: { project: ProjectDetail; type: WorkspaceType; onOpen: () => void }) {
  const milestone = project.milestone;
  // A client engagement is delivered against milestones; a product has a roadmap.
  const destination = type === "client" ? "Open milestones" : "Open roadmap";

  return (
    <section className="rounded-[4px] border border-paper-mist bg-paper-cream p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[12.5px] font-medium text-paper-sage">Current milestone</h2>
        {project.health && project.health !== "no_target" ? (
          <Tag tone={project.health === "on_track" ? "green" : project.health === "at_risk" ? "marigold" : "flame"}>{HEALTH_LABELS[project.health]}</Tag>
        ) : null}
      </div>

      {milestone ? (
        <>
          <p className="mt-2 font-paper-display text-[19px] leading-snug font-bold tracking-[-0.01em] text-paper-moss">{milestone.title}</p>
          <div className="mt-4">
            <Meter value={milestone.progress.percent / 100} label={`${milestone.title} progress`} tone="amber" size="md" />
          </div>
          <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-[13px] text-paper-char tabular-nums">
            <span>
              {milestone.progress.completed} of {milestone.progress.total} tasks · {milestone.progress.percent}%
            </span>
            {milestone.targetDate ? (
              <span className="text-paper-sage">
                Target {new Date(`${milestone.targetDate}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </span>
            ) : null}
          </p>
        </>
      ) : (
        <p className="mt-2 text-[14px] leading-6 text-paper-char">No active milestone. A milestone gives the tasks a finish line.</p>
      )}

      <button type="button" onClick={onOpen} className={cn("mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-[3px] text-[13px] font-semibold text-paper-blue hover:underline", PAPER_FOCUS)}>
        {milestone ? destination : "Plan a milestone"}
        <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </button>
    </section>
  );
}

function KeyDocuments({ slug, onOpenAll }: { slug: string; onOpenAll: () => void }) {
  const { data } = useProjectDocuments(slug);
  const documents = [...(data?.agentos ?? []).slice(0, 4), ...(data?.repo ?? []).filter((document) => document.relativePath === "README.md")].slice(0, 5);

  return (
    <Block title="Key documents" action={<TextButton onClick={onOpenAll}>All</TextButton>}>
      {documents.length === 0 ? (
        <Quiet>No documents yet. Plans, research and notes land here.</Quiet>
      ) : (
        <ul className="space-y-0.5">
          {documents.map((document) => {
            const params = new URLSearchParams({ tab: "documents", doc: document.relativePath });
            if (document.origin === "repo") params.set("origin", "repo");
            return (
              <li key={`${document.origin}:${document.id}`}>
                <Link
                  to={`/workspaces/${slug}?${params.toString()}`}
                  className={cn("flex items-start gap-2.5 rounded-[4px] px-2 py-1.5 transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
                >
                  <FileText className="mt-1 size-3.5 shrink-0 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] leading-6 text-paper-moss">{document.title}</span>
                    <span className="block text-[12.5px] text-paper-sage">
                      {TYPE_LABELS[document.type]} · {document.origin === "repo" ? "Repository" : SOURCE_LABELS[document.source]}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}

/**
 * The client workspaces in the portfolio.
 *
 * Not a CRM: which clients belong to which business is not recorded anywhere
 * yet, so this lists every workspace marked as a client and says so.
 */
export function ClientsBlock({ onOpenAll }: { onOpenAll?: () => void }) {
  const { data } = useProjects();
  const clients = (data?.projects ?? []).filter((project) => project.workspaceType === "client" && project.state !== "archived");

  return (
    <Block title="Clients" action={onOpenAll ? <TextButton onClick={onOpenAll}>All</TextButton> : undefined}>
      {clients.length === 0 ? (
        <Quiet>No workspace is marked as a client yet. Set a workspace's type to Client in its Settings.</Quiet>
      ) : (
        <ul className="space-y-0.5">
          {clients.slice(0, 5).map((client) => (
            <li key={client.slug}>
              <Link
                to={`/workspaces/${client.slug}`}
                className={cn("flex items-baseline justify-between gap-3 rounded-[4px] px-2 py-1.5 transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
              >
                <span className="min-w-0 truncate text-[14px] leading-6 text-paper-moss">{client.name}</span>
                <span className="shrink-0 text-[12.5px] text-paper-sage capitalize">{client.state}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

function RepositoryLine({ project, onOpen }: { project: ProjectDetail; onOpen: () => void }) {
  const { git } = project;

  return (
    <Block title="Repository" action={<TextButton onClick={onOpen}>Open</TextButton>}>
      {!git.repositoryPath ? (
        <Quiet>No local repository linked. Workers need one; set it in Settings.</Quiet>
      ) : git.unavailable ? (
        <p className="text-[13.5px] leading-5 text-paper-flame-deep">{git.unavailable}</p>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-[4px] border border-paper-mist px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <GitBranch className="size-3.5 shrink-0 text-paper-sage" strokeWidth={1.75} aria-hidden="true" />
            <span className="truncate font-mono text-[13px] text-paper-moss">{git.branch ?? "Detached HEAD"}</span>
          </span>
          <Tag tone={git.workingTree === "clean" ? "green" : "marigold"}>
            {git.workingTree === "clean" ? "Clean" : `${git.changedFiles.length} changed`}
          </Tag>
        </div>
      )}
    </Block>
  );
}
