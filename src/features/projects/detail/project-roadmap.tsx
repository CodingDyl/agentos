import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Sparkles,
  Square,
  SquareCheck,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { RoadmapMilestone, RoadmapTask } from "@shared/agentos-types";
import {
  CommandButton,
  EmptyState,
  HairlineCard,
  ProgressBar,
  Section,
  SectionLabel,
  StatusPill,
} from "@/components/os";
import { useWorkspaceFeedback } from "@/features/workspace";
import {
  useCreateMilestone,
  useDeleteMilestone,
  useMilestone,
  useMilestoneAction,
  usePatchMilestone,
  usePatchTask,
  useReorderMilestones,
  useRoadmap,
  useSetCriterion,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import {
  describeDays,
  EXECUTION_LABELS,
  groupMilestones,
  HEALTH_LABELS,
  healthPill,
  MILESTONE_LABELS,
  milestonePill,
  shortDate,
} from "../roadmap-model";
import { MilestonePlanPanel } from "./milestone-plan";
import { MilestoneReview } from "./milestone-review";
import { MilestoneRun } from "./milestone-run";

/**
 * Where the project is going.
 *
 * Numbered milestones in reading order — what is being shipped now, what is
 * next, what is done — each a hairline row with its progress, target and
 * state. Opening one shows the outcome, the criteria that would show it was
 * reached, the tasks meant to get there, and what the agents have spent on it.
 *
 * Deliberately not a board and not a Gantt chart. The roadmap is a list with
 * a reason for each task to exist; the pile of tasks in no milestone at the
 * bottom is the drift indicator, and it stays visible.
 */
export function ProjectRoadmap({ slug, onAsk }: { slug: string; onAsk: () => void }) {
  const { data, isPending, error, refetch } = useRoadmap(slug);
  const [creatingState, setCreatingState] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // The open milestone lives in the URL so the palette and Mission Control can
  // link straight to it; `?new=1` (the palette's "New milestone") opens the form.
  const [searchParams, setSearchParams] = useSearchParams();
  const open = searchParams.get("milestone") ?? undefined;
  const creating = creatingState || searchParams.get("new") === "1";

  const setCreating = (next: boolean) => {
    setCreatingState(next);
    if (!next && searchParams.get("new")) {
      setSearchParams(
        (params) => {
          const following = new URLSearchParams(params);
          following.delete("new");
          return following;
        },
        { replace: true },
      );
    }
  };

  const setOpen = (id: string | undefined) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (id) next.set("milestone", id);
        else next.delete("milestone");
        return next;
      },
      { replace: true },
    );

  if (isPending) return <p className="text-[15px] leading-6 text-os-muted">Reading MILESTONES.md…</p>;
  if (error || !data) return <EmptyState label="Roadmap unavailable" description={error?.message ?? "Could not read the roadmap."} />;

  const groups = groupMilestones(data.milestones);
  const reload = () => void refetch();

  // Numbered in reading order across groups: 01 is what is being shipped now,
  // the numbers continue into Next, then into the folded ones.
  const ordered = [...groups.now, ...groups.next, ...groups.done, ...groups.archived];
  const numberOf = new Map(ordered.map((milestone, index) => [milestone.id, index + 1]));

  const rows = (milestones: RoadmapMilestone[]) =>
    milestones.map((milestone) => {
      return (
        <MilestoneRow
          key={milestone.id}
          slug={slug}
          index={numberOf.get(milestone.id) ?? 0}
          milestone={milestone}
          revision={data.revision}
          tasksRevision={data.tasksRevision}
          siblings={data.milestones}
          open={open === milestone.id}
          onToggle={() => setOpen(open === milestone.id ? undefined : milestone.id)}
          onAsk={onAsk}
          onReload={reload}
        />
      );
    });

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={healthPill(data.health)} label={HEALTH_LABELS[data.health]} />
            <span className="text-[14px] leading-5 text-os-muted">{data.healthReason}</span>
          </div>
        </div>
        <CommandButton variant="secondary" icon={Plus} iconPosition="start" onClick={() => setCreating(!creating)}>
          Milestone
        </CommandButton>
      </div>

      {creating ? (
        <MilestoneForm
          slug={slug}
          revision={data.revision}
          onDone={() => setCreating(false)}
          onReload={reload}
        />
      ) : null}

      {data.milestones.length === 0 && !creating ? (
        <EmptyState
          label="No milestones"
          description="Give the tasks a reason to exist. A milestone is an outcome, a target, and the tasks meant to reach it."
        />
      ) : null}

      {groups.now.length > 0 ? (
        <Section label="Now">
          <HairlineCard className="overflow-hidden">
            <ol className="divide-y divide-os-border">{rows(groups.now)}</ol>
          </HairlineCard>
        </Section>
      ) : null}

      {groups.next.length > 0 ? (
        <Section label="Next">
          <HairlineCard className="overflow-hidden">
            <ol className="divide-y divide-os-border">{rows(groups.next)}</ol>
          </HairlineCard>
        </Section>
      ) : null}

      <UnplannedTasks slug={slug} tasks={data.unplanned} milestones={data.milestones} revision={data.revision} onReload={reload} />

      {groups.done.length + groups.archived.length > 0 ? (
        <section className="border-t border-os-border pt-6">
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => setShowDone((value) => !value)}
            className="os-focus-ring os-meta -mx-1 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
          >
            {showDone ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
            Completed and archived
            <span className="tabular-nums">{groups.done.length + groups.archived.length}</span>
          </button>
          {showDone ? (
            <HairlineCard className="mt-4 overflow-hidden">
              <ol className="divide-y divide-os-border">{rows([...groups.done, ...groups.archived])}</ol>
            </HairlineCard>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function MilestoneRow({
  slug,
  index,
  milestone,
  revision,
  tasksRevision,
  siblings,
  open,
  onToggle,
  onAsk,
  onReload,
}: {
  slug: string;
  index: number;
  milestone: RoadmapMilestone;
  revision: string;
  tasksRevision: string;
  siblings: RoadmapMilestone[];
  open: boolean;
  onToggle: () => void;
  onAsk: () => void;
  onReload: () => void;
}) {
  const { progress } = milestone;
  const days = describeDays(progress.daysToTarget);
  const overdue = progress.daysToTarget !== undefined && progress.daysToTarget < 0 && milestone.status !== "completed";

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "os-focus-ring grid w-full cursor-pointer grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-os-surface-raised",
          open && "bg-os-surface-raised",
        )}
      >
        <span className="os-meta pt-1 text-os-subtle tabular-nums">{String(index).padStart(2, "0")}</span>

        <span className="min-w-0">
          <span className="block truncate text-[16px] leading-6 text-foreground">{milestone.title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 text-os-muted">
            <span className="tabular-nums">
              {progress.completed} / {progress.total} tasks
            </span>
            {milestone.targetDate ? (
              <span className={overdue ? "text-os-warning" : undefined}>
                Target {shortDate(milestone.targetDate)}
                {days ? ` · ${days}` : ""}
              </span>
            ) : (
              <span className="text-os-subtle">No target</span>
            )}
            {progress.criteriaTotal > 0 ? (
              <span className="tabular-nums">
                {progress.criteriaDone} / {progress.criteriaTotal} criteria
              </span>
            ) : null}
          </span>
          <ProgressBar
            percent={progress.percent}
            label={`${milestone.title} progress`}
            size="row"
            tone={milestone.status === "completed" ? "success" : "amber"}
            className="mt-3 max-w-[28rem]"
          />
        </span>

        <span className="flex items-center gap-3 pt-0.5">
          <span className="os-meta text-os-subtle tabular-nums">{progress.percent}%</span>
          <StatusPill status={milestonePill(milestone.status)} label={MILESTONE_LABELS[milestone.status]} />
        </span>
      </button>

      {open ? (
        <MilestoneDetail
          slug={slug}
          milestone={milestone}
          revision={revision}
          tasksRevision={tasksRevision}
          siblings={siblings}
          onAsk={onAsk}
          onReload={onReload}
          onClose={onToggle}
        />
      ) : null}
    </li>
  );
}

function MilestoneDetail({
  slug,
  milestone,
  revision,
  tasksRevision,
  siblings,
  onAsk,
  onReload,
  onClose,
}: {
  slug: string;
  milestone: RoadmapMilestone;
  revision: string;
  tasksRevision: string;
  siblings: RoadmapMilestone[];
  onAsk: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const detail = useMilestone(slug, milestone.id);
  const act = useMilestoneAction(slug);
  const remove = useDeleteMilestone(slug);
  const reorder = useReorderMilestones(slug);
  const criterion = useSetCriterion(slug);
  const feedback = useWorkspaceFeedback();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [running, setRunning] = useState(false);

  const handlers = (label: string) => ({
    onSuccess: (result: { undoId?: string }) => feedback.recordEdit(label, result.undoId),
    onError: (error: unknown) => feedback.reportFailure(error, onReload),
  });

  const move = (direction: -1 | 1) => {
    const ids = siblings.map((entry) => entry.id);
    const from = ids.indexOf(milestone.id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorder.mutate({ ids, expectedRevision: revision }, handlers(`${milestone.title} moved.`));
  };

  const busy = act.isPending || remove.isPending || reorder.isPending;
  const canDelete = milestone.taskIds.length === 0 && !milestone.review;
  const runnableCount = milestone.tasks.filter((task) => task.status === "ready" || task.status === "backlog").length;
  const position = siblings.findIndex((entry) => entry.id === milestone.id);

  return (
    <div className="border-t border-os-border bg-os-surface px-5 py-6 pl-[calc(2.5rem+1rem+1.25rem)]">
      {editing ? (
        <MilestoneForm
          slug={slug}
          revision={revision}
          existing={milestone}
          onDone={() => setEditing(false)}
          onReload={onReload}
        />
      ) : (
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-8">
            <div>
              <SectionLabel>Outcome</SectionLabel>
              <p className="mt-3 max-w-[60ch] text-[15px] leading-6 text-foreground">
                {milestone.outcome ?? <span className="text-os-subtle">No outcome written. What would make this milestone a success?</span>}
              </p>
            </div>

            <div>
              <SectionLabel>Success criteria</SectionLabel>
              {milestone.criteria.length === 0 ? (
                <p className="mt-3 text-[14px] leading-5 text-os-subtle">
                  None yet. Criteria are outcomes a person can check — not implementation tasks.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {milestone.criteria.map((entry, index) => (
                    <li key={`${index}-${entry.text}`}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={entry.done}
                        disabled={criterion.isPending}
                        onClick={() =>
                          criterion.mutate(
                            { id: milestone.id, index, done: !entry.done, expectedRevision: revision },
                            handlers(`Criterion ${entry.done ? "reopened" : "met"}: ${entry.text}`),
                          )
                        }
                        className="os-focus-ring -mx-1 flex cursor-pointer items-start gap-3 rounded-md px-1 py-0.5 text-left"
                      >
                        {entry.done ? (
                          <SquareCheck className="mt-1 size-4 shrink-0 text-os-success" strokeWidth={1.5} aria-hidden="true" />
                        ) : (
                          <Square className="mt-1 size-4 shrink-0 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
                        )}
                        <span className={cn("text-[15px] leading-6", entry.done ? "text-os-muted" : "text-foreground")}>{entry.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <SectionLabel action={<span className="os-meta text-os-subtle tabular-nums">{milestone.tasks.length}</span>}>Tasks</SectionLabel>
              {milestone.tasks.length === 0 ? (
                <p className="mt-3 text-[14px] leading-5 text-os-subtle">No tasks yet. Assign from the board, or plan with Hermes.</p>
              ) : (
                <ul className="mt-3 divide-y divide-os-border rounded-lg border border-os-border">
                  {milestone.tasks.map((task) => (
                    <TaskLine key={task.id} task={task} onOpen={() => navigate(`/projects/${slug}?tab=tasks&task=${task.id}`)} />
                  ))}
                </ul>
              )}
            </div>

            {milestone.review ? (
              <div>
                <SectionLabel>Review</SectionLabel>
                <pre className="mt-3 max-w-[68ch] whitespace-pre-wrap font-sans text-[14px] leading-6 text-os-muted">{milestone.review}</pre>
              </div>
            ) : null}
          </div>

          <div className="space-y-8">
            <div>
              <SectionLabel>Agent work</SectionLabel>
              {detail.isPending ? (
                <p className="mt-3 text-[14px] text-os-subtle">Reading…</p>
              ) : detail.data && detail.data.agentWork.length > 0 ? (
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-[14px] leading-5">
                  {detail.data.agentWork.map((entry) => (
                    <FragmentRow key={entry.worker} label={entry.worker} value={`${entry.jobs} ${entry.jobs === 1 ? "job" : "jobs"}`} />
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-[14px] leading-5 text-os-subtle">No worker has been given work in this milestone.</p>
              )}
            </div>

            <div>
              <SectionLabel>AI cost</SectionLabel>
              <p className="mt-3 text-[22px] leading-7 tabular-nums text-foreground">
                {detail.data?.usage.costUsd !== undefined ? `$${detail.data.usage.costUsd.toFixed(2)}` : "—"}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-os-subtle">
                {detail.data?.usage.tokens !== undefined ? `${Math.round(detail.data.usage.tokens / 1000)}k tokens · ` : ""}
                {detail.data ? `${detail.data.usage.jobs} ${detail.data.usage.jobs === 1 ? "job" : "jobs"}` : ""}
              </p>
            </div>

            <div className="flex flex-col items-start gap-2">
              <CommandButton variant="secondary" icon={Sparkles} iconPosition="start" onClick={() => setPlanning((value) => !value)}>
                Plan with Hermes
              </CommandButton>
              {runnableCount > 0 && milestone.status !== "completed" && milestone.status !== "archived" ? (
                <CommandButton variant="secondary" icon={Rocket} iconPosition="start" onClick={() => setRunning(true)}>
                  Run milestone ({runnableCount})
                </CommandButton>
              ) : null}
              <CommandButton variant="quiet" icon={MessageSquare} iconPosition="start" onClick={onAsk}>
                Ask Hermes
              </CommandButton>
              {milestone.status !== "completed" && milestone.status !== "archived" ? (
                <CommandButton variant="primary" onClick={() => setReviewing(true)}>
                  Complete milestone
                </CommandButton>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {planning ? (
        <MilestonePlanPanel
          slug={slug}
          milestone={milestone}
          revision={revision}
          tasksRevision={tasksRevision}
          onClose={() => setPlanning(false)}
          onReload={onReload}
          className="mt-8"
        />
      ) : null}

      {!editing ? (
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-os-border pt-4">
          <SmallAction icon={Pencil} label="Edit" disabled={busy} onClick={() => setEditing(true)} />
          <SmallAction icon={ChevronUp} label="Up" disabled={busy || position <= 0} onClick={() => move(-1)} />
          <SmallAction icon={ChevronDown} label="Down" disabled={busy || position === siblings.length - 1} onClick={() => move(1)} />
          <span className="h-3 w-px bg-os-border" aria-hidden="true" />
          {milestone.status === "planned" ? (
            <SmallAction icon={Play} label="Make active" disabled={busy} onClick={() => act.mutate({ id: milestone.id, action: "activate", expectedRevision: revision }, handlers(`${milestone.title} is now active.`))} />
          ) : null}
          {milestone.status === "active" ? (
            <SmallAction icon={Pause} label="Pause" disabled={busy} onClick={() => act.mutate({ id: milestone.id, action: "pause", expectedRevision: revision }, handlers(`${milestone.title} paused.`))} />
          ) : null}
          {milestone.status === "paused" ? (
            <SmallAction icon={Play} label="Resume" disabled={busy} onClick={() => act.mutate({ id: milestone.id, action: "resume", expectedRevision: revision }, handlers(`${milestone.title} resumed.`))} />
          ) : null}
          {milestone.status === "archived" ? (
            <SmallAction icon={RotateCcw} label="Restore" disabled={busy} onClick={() => act.mutate({ id: milestone.id, action: "restore", expectedRevision: revision }, handlers(`${milestone.title} restored.`))} />
          ) : (
            <SmallAction icon={Archive} label="Archive" disabled={busy} onClick={() => act.mutate({ id: milestone.id, action: "archive", expectedRevision: revision }, handlers(`${milestone.title} archived.`))} />
          )}
          {canDelete ? (
            <SmallAction
              icon={Trash2}
              label="Delete"
              danger
              disabled={busy}
              onClick={() =>
                remove.mutate(
                  { id: milestone.id, expectedRevision: revision },
                  {
                    onSuccess: (result) => {
                      feedback.recordEdit(`${milestone.title} deleted.`, result.undoId);
                      onClose();
                    },
                    onError: (error) => feedback.reportFailure(error, onReload),
                  },
                )
              }
            />
          ) : null}
        </div>
      ) : null}

      {reviewing ? (
        <MilestoneReview
          slug={slug}
          milestone={milestone}
          revision={revision}
          onClose={() => setReviewing(false)}
          onReload={onReload}
        />
      ) : null}

      {running ? (
        <MilestoneRun
          slug={slug}
          milestone={milestone}
          onClose={() => setRunning(false)}
          onReload={onReload}
        />
      ) : null}
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="capitalize text-os-muted">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </>
  );
}

function TaskLine({ task, onOpen }: { task: RoadmapTask; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="os-focus-ring flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-os-surface-raised"
      >
        <StatusDot status={task.status} />
        <span className="os-meta w-16 shrink-0 text-os-subtle">{task.id}</span>
        <span className={cn("min-w-0 flex-1 truncate text-[14px] leading-5", task.status === "done" ? "text-os-subtle line-through decoration-os-border" : "text-foreground")}>
          {task.title}
        </span>
        <span className="os-meta shrink-0 text-os-subtle">
          {task.status === "blocked" ? `Blocked by ${task.blockedBy.join(", ")}` : EXECUTION_LABELS[task.status]}
        </span>
      </button>
    </li>
  );
}

/** The execution state as a dot with a name for screen readers; the row says the rest. */
export function StatusDot({ status, className }: { status: RoadmapTask["status"]; className?: string }) {
  return (
    <span
      className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}
      role="img"
      aria-label={EXECUTION_LABELS[status]}
      title={EXECUTION_LABELS[status]}
    >
      <span className={cn("size-1.5 rounded-full", DOT[status])} />
    </span>
  );
}

const DOT: Record<RoadmapTask["status"], string> = {
  backlog: "bg-os-subtle",
  ready: "bg-os-success",
  in_progress: "bg-os-amber motion-safe:animate-pulse",
  review: "bg-os-warning",
  blocked: "bg-os-danger",
  done: "bg-os-success/50",
};

function SmallAction({
  icon: Icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: typeof Pencil;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "os-focus-ring os-meta inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 transition-colors duration-150",
        danger ? "text-os-subtle hover:text-os-danger" : "text-os-muted hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-30",
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
      {label}
    </button>
  );
}

/** Create, or edit in place. Criteria are one per line. */
function MilestoneForm({
  slug,
  revision,
  existing,
  onDone,
  onReload,
}: {
  slug: string;
  revision: string;
  existing?: RoadmapMilestone;
  onDone: () => void;
  onReload: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [outcome, setOutcome] = useState(existing?.outcome ?? "");
  const [target, setTarget] = useState(existing?.targetDate ?? "");
  const [criteria, setCriteria] = useState(existing?.criteria.map((entry) => entry.text).join("\n") ?? "");
  const [activate, setActivate] = useState(existing ? existing.status === "active" : false);

  const create = useCreateMilestone(slug);
  const patch = usePatchMilestone(slug);
  const feedback = useWorkspaceFeedback();

  const busy = create.isPending || patch.isPending;
  const lines = criteria.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  return (
    <form
      className={cn("rounded-lg border border-os-border p-5", existing ? "" : "bg-os-surface")}
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length === 0) return;

        const done = {
          onSuccess: (result: { undoId?: string }) => {
            feedback.recordEdit(existing ? `${title.trim()} updated.` : `${title.trim()} created.`, result.undoId);
            onDone();
          },
          onError: (error: unknown) => feedback.reportFailure(error, onReload),
        };

        if (existing) {
          const kept = new Map(existing.criteria.map((entry) => [entry.text, entry.done]));
          patch.mutate(
            {
              id: existing.id,
              title,
              outcome,
              targetDate: target,
              criteria: lines.map((text) => ({ text, done: kept.get(text) ?? false })),
              status: activate && existing.status !== "active" ? "active" : undefined,
              expectedRevision: revision,
            },
            done,
          );
        } else {
          create.mutate(
            {
              title,
              outcome: outcome.trim() || undefined,
              targetDate: target || undefined,
              criteria: lines,
              status: activate ? "active" : "planned",
              expectedRevision: revision,
            },
            done,
          );
        }
      }}
    >
      <SectionLabel>{existing ? "Edit milestone" : "New milestone"}</SectionLabel>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label="Name">
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Chef Experience" className={INPUT} />
        </Field>
        <Field label="Target">
          <input type="date" value={target} onChange={(event) => setTarget(event.target.value)} className={`${INPUT} font-mono text-[13px]`} />
        </Field>
      </div>

      <Field label="Outcome" hint="What would be true when this is done. One or two sentences.">
        <textarea rows={2} value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Make Chef reliable enough for beta users." className={`${INPUT} resize-y`} />
      </Field>

      <Field label="Success criteria" hint="One per line. Outcomes a person can check, not implementation tasks.">
        <textarea rows={3} value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder={"Chef creates recipes when MealDB has no match\nUsers can retry results"} className={`${INPUT} resize-y`} />
      </Field>

      <label className="mt-5 flex cursor-pointer items-center gap-3 text-[14px] leading-5 text-os-muted">
        <input type="checkbox" checked={activate} onChange={(event) => setActivate(event.target.checked)} className="size-4 accent-os-amber" />
        Make this the active milestone
      </label>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <CommandButton type="submit" variant="primary" disabled={title.trim().length === 0} loading={busy} loadingLabel="Saving">
          {existing ? "Save" : "Create milestone"}
        </CommandButton>
        <CommandButton variant="quiet" onClick={onDone}>
          Cancel
        </CommandButton>
      </div>
    </form>
  );
}

function UnplannedTasks({
  slug,
  tasks,
  milestones,
  revision,
  onReload,
}: {
  slug: string;
  tasks: RoadmapTask[];
  milestones: RoadmapMilestone[];
  revision: string;
  onReload: () => void;
}) {
  const patch = usePatchTask(slug);
  const feedback = useWorkspaceFeedback();
  const targets = milestones.filter((milestone) => milestone.status === "active" || milestone.status === "planned" || milestone.status === "paused");

  if (tasks.length === 0) return null;

  return (
    <Section label="Unplanned tasks" action={<span className="os-meta text-os-warning tabular-nums">{tasks.length}</span>}>
      <p className="mb-4 text-[13px] leading-5 text-os-subtle">Open tasks in no milestone. A growing pile here means the project is drifting.</p>
      <HairlineCard className="overflow-hidden">
        <ul className="divide-y divide-os-border">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="os-meta w-16 shrink-0 text-os-subtle">{task.id}</span>
              <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-foreground">{task.title}</span>
              <span className="os-meta shrink-0 text-os-subtle">{task.section}</span>
              {targets.length > 0 ? (
                <select
                  aria-label={`Assign ${task.id} to a milestone`}
                  value=""
                  disabled={patch.isPending}
                  onChange={(event) => {
                    const id = event.target.value;
                    if (!id) return;
                    patch.mutate(
                      { taskId: task.id, milestone: id, milestoneRevision: revision },
                      {
                        onSuccess: (result) =>
                          feedback.recordEdit(`${task.id} added to ${targets.find((entry) => entry.id === id)?.title ?? id}.`, result.milestone?.undoId),
                        onError: (error) => feedback.reportFailure(error, onReload),
                      },
                    );
                  }}
                  className="os-focus-ring os-meta cursor-pointer rounded-md border border-os-border bg-os-surface px-2 py-1.5 text-os-muted"
                >
                  <option value="">Add to…</option>
                  {targets.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </select>
              ) : null}
            </li>
          ))}
        </ul>
      </HairlineCard>
    </Section>
  );
}

const INPUT =
  "os-focus-ring mt-3 w-full rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mt-5 block first:mt-0">
      <SectionLabel>{label}</SectionLabel>
      {children}
      {hint ? <span className="mt-2 block text-[13px] leading-5 text-os-subtle">{hint}</span> : null}
    </label>
  );
}

