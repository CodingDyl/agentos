import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Square,
  SquareCheck,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CommandButton,
  EmptyState,
  HairlineCard,
  Section,
} from "@/components/os";
import type { TaskDelegationState } from "@shared/delegation-types";
import type { RoadmapMilestone, RoadmapTask } from "@shared/agentos-types";
import { EXECUTION_LABELS } from "@/features/projects/roadmap-model";
import { StatusDot } from "@/features/projects/detail/project-roadmap";
import { TaskPanel } from "@/features/projects/detail/task-panel";
import type { TaskRecord } from "@/lib/agentos/client";
import {
  useArchiveTask,
  useBulkTasks,
  useCreateTask,
  useDeleteTask,
  useEditableTasks,
  usePatchTask,
  useReorderTasks,
  useRestoreTask,
  useRoadmap,
  useTaskDelegations,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { useWorkspaceFeedback } from "./use-workspace-feedback";

/**
 * Tasks you can actually change.
 *
 * The screen this whole step exists for. Before it, running a project meant
 * reading `TASKS.md` here and editing it in a terminal; every affordance below
 * replaces one of those round trips.
 *
 * Three decisions shape the interaction.
 *
 * **Completion is one click and no dialog.** It is the most common action on
 * the screen and the least dangerous, and a confirmation on every checkbox
 * would make the easy thing tedious. The undo bar is the safety net, and it is
 * a better one than a modal — it catches the mistake *after* it is visible,
 * which is when the operator actually notices.
 *
 * **Archive is the normal way to drop a task; delete asks, once.** A task id is
 * referenced by worker jobs, reviews, usage and activity, and the row cannot
 * tell whether it has history behind it. Archiving keeps the line and the id.
 * Deletion is there for the task that was a typo.
 *
 * **Dragging and buttons both work, and write the same file.** A pointer
 * drags; a keyboard picks the row up with space and moves it with arrows
 * (dnd-kit's keyboard sensor); and the row menu still offers up/down and
 * move-to for anyone who would rather click. Whatever the gesture, the result
 * is one `reorder` or one `move` against the current revision.
 */

const OPEN_SECTIONS = [
  { key: "now", label: "Now" },
  { key: "next", label: "Next" },
  { key: "later", label: "Later" },
] as const;

const SECTIONS = [...OPEN_SECTIONS, { key: "done", label: "Done" }] as const;

type OpenSectionKey = (typeof OPEN_SECTIONS)[number]["key"];
type SectionKey = (typeof SECTIONS)[number]["key"];

const isSectionKey = (value: string): value is SectionKey =>
  SECTIONS.some((section) => section.key === value);

/** Section ids for droppables, distinct from task ids. */
const dropId = (section: SectionKey) => `section:${section}`;
const sectionFromDropId = (id: string): SectionKey | undefined =>
  id.startsWith("section:") && isSectionKey(id.slice(8)) ? (id.slice(8) as SectionKey) : undefined;

type Board = Record<SectionKey, TaskRecord[]>;

function emptyBoard(): Board {
  return { now: [], next: [], later: [], done: [] };
}

function groupTasks(tasks: TaskRecord[]): { board: Board; archived: TaskRecord[] } {
  const board = emptyBoard();
  const archived: TaskRecord[] = [];

  for (const task of tasks) {
    if (task.section === "archived") {
      archived.push(task);
      continue;
    }

    // A task under a heading AgentOS does not recognise still belongs
    // somewhere: it reads as `Now`, which is where an operator would look for
    // work that is not filed anywhere else.
    const key = task.section && isSectionKey(task.section) ? task.section : "now";
    board[key].push(task);
  }

  return { board, archived };
}

export interface TaskBoardProps {
  project: string;
  /** Opens the add-task form in `Now` on mount — the header's `+ Task`. */
  startAdding?: boolean;
  onAddingHandled?: () => void;
}

export function TaskBoard({ project, startAdding, onAddingHandled }: TaskBoardProps) {
  const { data, isPending, refetch } = useEditableTasks(project);
  const [addingState, setAddingState] = useState<SectionKey>();
  const [expandedState, setExpandedState] = useState<string>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [dragging, setDragging] = useState<TaskRecord>();

  // Search results and Mission Control link straight to a task: `?task=PP-014`
  // opens its panel. The parameter is the source of truth until the operator
  // touches the board, at which point it is dropped and local state takes over.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedTask = searchParams.get("task");
  const expanded = linkedTask ? linkedTask.toUpperCase() : expandedState;

  const setExpanded = (next: string | undefined) => {
    setExpandedState(next);
    if (linkedTask) {
      setSearchParams(
        (params) => {
          const following = new URLSearchParams(params);
          following.delete("task");
          return following;
        },
        { replace: true },
      );
    }
  };

  // The header's `+ Task` opens the form in `Now`; closing it tells the header.
  const adding = addingState ?? (startAdding ? "now" : undefined);

  const setAdding = (next: SectionKey | undefined) => {
    setAddingState(next);
    if (next === undefined && startAdding) onAddingHandled?.();
  };

  const { data: delegationData } = useTaskDelegations(project);

  // Where each task stands and which milestone it serves, from the roadmap.
  // Read alongside the tasks so a row can say "blocked by PP-021" without the
  // board re-deriving what the server already knows.
  const { data: roadmapData } = useRoadmap(project);

  const roadmapByTask = useMemo(() => {
    const map = new Map<string, RoadmapTask>();
    for (const milestone of roadmapData?.milestones ?? []) {
      for (const entry of milestone.tasks) map.set(entry.id, entry);
    }
    for (const entry of roadmapData?.unplanned ?? []) map.set(entry.id, entry);
    return map;
  }, [roadmapData]);

  const milestones = useMemo(
    () => (roadmapData?.milestones ?? []).filter((entry) => entry.status !== "archived" && entry.status !== "completed"),
    [roadmapData],
  );

  const delegations = useMemo(
    () =>
      new Map<string, TaskDelegationState>(
        (delegationData?.delegations ?? []).map((entry) => [
          entry.taskId.toUpperCase(),
          entry,
        ]),
      ),
    [delegationData],
  );

  const revision = data?.revision;
  const tasks = data?.tasks;

  const grouped = useMemo(() => groupTasks(tasks ?? []), [tasks]);

  // While a drop is being written the server's order lags a round trip
  // behind. The board shows the dropped order immediately and forgets it the
  // moment a fresh read arrives, so nothing is ever *displayed* that the file
  // has not confirmed for longer than one request.
  const [optimistic, setOptimistic] = useState<{ revision?: string; board: Board }>();

  // Dropped the moment the file's revision moves on — which is the fresh read
  // after the write. Keyed on the revision rather than a timer so it can never
  // outlive the truth; and cleared, rather than merely hidden, so an undo that
  // restores the identical content (and therefore the identical hash) does not
  // resurrect a stale board.
  if (optimistic && optimistic.revision !== revision) setOptimistic(undefined);

  const board =
    optimistic && optimistic.revision === revision ? optimistic.board : grouped.board;

  const patch = usePatchTask(project);
  const reorder = useReorderTasks(project);
  const bulk = useBulkTasks(project);
  const feedback = useWorkspaceFeedback();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findSection = (taskId: string): SectionKey | undefined =>
    SECTIONS.find(({ key }) => board[key].some((task) => task.id === taskId))?.key;

  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    const section = findSection(id);
    setDragging(section ? board[section].find((task) => task.id === id) : undefined);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(undefined);
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);
    const from = findSection(taskId);
    if (!from) return;

    const to = sectionFromDropId(overId) ?? findSection(overId);
    if (!to) return;

    const handlers = {
      onSuccess: (result: { undoId?: string }) =>
        feedback.recordEdit(
          from === to ? `${taskId} reordered.` : `${taskId} moved to ${to}.`,
          result.undoId,
        ),
      onError: (error: unknown) => {
        setOptimistic(undefined);
        feedback.reportFailure(error, () => void refetch());
      },
    };

    if (from === to) {
      const ids = board[from].map((task) => task.id).filter((id): id is string => !!id);
      const fromIndex = ids.indexOf(taskId);
      const toIndex = overId === dropId(to) ? ids.length - 1 : ids.indexOf(overId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      const next = arrayMove(ids, fromIndex, toIndex);
      const byId = new Map(board[from].map((task) => [task.id, task]));

      setOptimistic({
        revision,
        board: { ...board, [from]: next.map((id) => byId.get(id)!).filter(Boolean) },
      });

      reorder.mutate({ section: from, taskIds: next, expectedRevision: revision }, handlers);
      return;
    }

    const moving = board[from].find((task) => task.id === taskId);
    if (!moving) return;

    const targetIds = board[to].map((task) => task.id);
    const position = overId === dropId(to) ? targetIds.length : targetIds.indexOf(overId);
    const at = position === -1 ? targetIds.length : position;

    const nextTarget = [...board[to]];
    nextTarget.splice(at, 0, {
      ...moving,
      section: to,
      completed: to === "done" ? true : false,
    });

    setOptimistic({
      revision,
      board: {
        ...board,
        [from]: board[from].filter((task) => task.id !== taskId),
        [to]: nextTarget,
      },
    });

    patch.mutate(
      {
        taskId,
        section: to,
        position: at,
        completed: to === "done" ? true : moving.completed && from === "done" ? false : undefined,
        expectedRevision: revision,
      },
      handlers,
    );
  };

  const toggleSelected = (taskId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
  };

  const runBulk = (
    action: "complete" | "move" | "archive",
    section?: OpenSectionKey,
    describe?: string,
  ) => {
    const taskIds = [...selected];
    if (taskIds.length === 0) return;

    bulk.mutate(
      { taskIds, action, section, expectedRevision: revision },
      {
        onSuccess: (result) => {
          feedback.recordEdit(
            `${result.applied.length} ${result.applied.length === 1 ? "task" : "tasks"} ${describe ?? `${action}d`}.`,
            result.undoId,
          );
          clearSelection();
        },
        onError: (error) => feedback.reportFailure(error, () => void refetch()),
      },
    );
  };

  if (isPending) {
    return <p className="text-[15px] leading-6 text-os-muted">Reading TASKS.md…</p>;
  }

  const openCount = OPEN_SECTIONS.reduce((sum, { key }) => sum + board[key].length, 0);

  return (
    <div className="space-y-10">
      {/* Board-level controls: selection mode. Kept to one quiet toggle so the
          board's default state is the list, not a toolbar. */}
      {openCount > 0 ? (
        <div className="-mt-4 flex items-center justify-end">
          <button
            type="button"
            aria-pressed={selecting}
            onClick={() => (selecting ? clearSelection() : setSelecting(true))}
            className={cn(
              "os-focus-ring os-meta inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 transition-colors duration-150",
              selecting
                ? "border-os-border-strong bg-os-surface-raised text-foreground"
                : "border-transparent text-os-muted hover:border-os-border hover:text-foreground",
            )}
          >
            {selecting ? <X className="size-3.5" aria-hidden="true" /> : <SquareCheck className="size-3.5" aria-hidden="true" />}
            {selecting ? "Done selecting" : "Select"}
          </button>
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(undefined)}
      >
        {SECTIONS.map(({ key, label }) => {
          const items = board[key];

          // `Done` earns its heading only when something is in it; the other
          // three are always offered, because an empty `Next` is where the
          // next task goes.
          if (key === "done" && items.length === 0) return null;

          return (
            <Section
              key={key}
              label={label}
              action={
                <button
                  type="button"
                  onClick={() => setAdding(adding === key ? undefined : key)}
                  className="os-focus-ring os-meta inline-flex cursor-pointer items-center gap-1.5 rounded-md text-os-subtle transition-colors duration-150 hover:text-foreground"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Task
                </button>
              }
            >
              {adding === key ? (
                <AddTask
                  project={project}
                  section={key}
                  revision={revision}
                  onDone={() => setAdding(undefined)}
                  onReload={() => void refetch()}
                />
              ) : null}

              <SectionDropZone
                section={key}
                label={label}
                items={items}
                dragging={dragging !== undefined}
              >
                {items.map((task, index) => (
                  <TaskRow
                    key={task.id ?? `${key}-${index}`}
                    project={project}
                    task={task}
                    section={key}
                    revision={revision}
                    index={index}
                    count={items.length}
                    siblings={items}
                    delegation={task.id ? delegations.get(task.id.toUpperCase()) : undefined}
                    roadmap={task.id ? roadmapByTask.get(task.id) : undefined}
                    milestones={milestones}
                    milestoneRevision={roadmapData?.revision}
                    expanded={expanded === task.id}
                    onExpand={() => setExpanded(expanded === task.id ? undefined : task.id)}
                    selecting={selecting}
                    selected={task.id ? selected.has(task.id) : false}
                    onToggleSelected={() => task.id && toggleSelected(task.id)}
                    onReload={() => void refetch()}
                  />
                ))}
              </SectionDropZone>
            </Section>
          );
        })}

        <DragOverlay dropAnimation={null}>
          {dragging ? <DragGhost task={dragging} /> : null}
        </DragOverlay>
      </DndContext>

      {grouped.archived.length > 0 ? (
        <ArchivedSection
          project={project}
          tasks={grouped.archived}
          revision={revision}
          open={showArchived}
          onToggle={() => setShowArchived((value) => !value)}
          onReload={() => void refetch()}
        />
      ) : null}

      {(tasks?.length ?? 0) === 0 && adding === undefined ? (
        <EmptyState
          label="No tasks"
          description="Nothing is listed in TASKS.md yet. Add one above."
        />
      ) : null}

      {selecting && selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          busy={bulk.isPending}
          onMove={(section) => runBulk("move", section, `moved to ${section}`)}
          onComplete={() => runBulk("complete", undefined, "completed")}
          onArchive={() => runBulk("archive", undefined, "archived")}
          onClear={clearSelection}
        />
      ) : null}
    </div>
  );
}

/**
 * A section's list, as a drop target.
 *
 * Empty sections still need somewhere to drop onto, and a list with rows needs
 * an "after the last row" target — the droppable covers both by wrapping the
 * whole card, with the sortable context inside it.
 */
function SectionDropZone({
  section,
  label,
  items,
  dragging,
  children,
}: {
  section: SectionKey;
  label: string;
  items: TaskRecord[];
  dragging: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(section) });
  const ids = items.map((task) => task.id).filter((id): id is string => !!id);

  return (
    <SortableContext id={dropId(section)} items={ids} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className="rounded-lg transition-colors duration-150">
        {items.length === 0 ? (
          <p
            className={cn(
              "rounded-lg border border-dashed px-4 py-3 text-[14px] leading-5 transition-colors duration-150",
              isOver
                ? "border-os-amber/60 bg-os-surface-raised text-foreground"
                : dragging
                  ? "border-os-border text-os-subtle"
                  : "border-transparent px-0 text-os-subtle",
            )}
          >
            {dragging ? `Drop into ${label}` : `Nothing in ${label.toLowerCase()}.`}
          </p>
        ) : (
          <HairlineCard
            className={cn(
              "overflow-hidden transition-colors duration-150",
              isOver && "border-os-amber/60",
            )}
          >
            <ul className="divide-y divide-os-border">{children}</ul>
          </HairlineCard>
        )}
      </div>
    </SortableContext>
  );
}

function DragGhost({ task }: { task: TaskRecord }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-os-border-strong bg-os-surface-raised px-4 py-3">
      <GripVertical className="size-3.5 text-os-subtle" strokeWidth={1.5} aria-hidden="true" />
      {task.id ? <span className="os-meta text-os-subtle">{task.id}</span> : null}
      <span className="text-[15px] leading-6 text-foreground">{task.title}</span>
    </div>
  );
}

function AddTask({
  project,
  section,
  revision,
  onDone,
  onReload,
}: {
  project: string;
  section: SectionKey;
  revision?: string;
  onDone: () => void;
  onReload: () => void;
}) {
  const [title, setTitle] = useState("");
  const create = useCreateTask(project);
  const feedback = useWorkspaceFeedback();

  return (
    <form
      className="mb-4 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length === 0) return;

        create.mutate(
          { title, section, expectedRevision: revision },
          {
            onSuccess: (result) => {
              feedback.recordEdit(`${result.taskId} created.`, result.undoId);
              setTitle("");
              onDone();
            },
            onError: (error) => feedback.reportFailure(error, onReload),
          },
        );
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone();
        }}
        placeholder="What needs doing"
        className="os-focus-ring min-w-0 flex-1 rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
      />

      <CommandButton type="submit" variant="primary" loading={create.isPending} loadingLabel="Adding">
        Add
      </CommandButton>
      <CommandButton variant="quiet" onClick={onDone}>
        Cancel
      </CommandButton>
    </form>
  );
}

function TaskRow({
  project,
  task,
  section,
  revision,
  index,
  count,
  siblings,
  delegation,
  roadmap,
  milestones,
  milestoneRevision,
  expanded,
  onExpand,
  selecting,
  selected,
  onToggleSelected,
  onReload,
}: {
  project: string;
  task: TaskRecord;
  section: SectionKey;
  revision?: string;
  index: number;
  count: number;
  siblings: TaskRecord[];
  delegation?: TaskDelegationState;
  roadmap?: RoadmapTask;
  milestones: RoadmapMilestone[];
  milestoneRevision?: string;
  expanded: boolean;
  onExpand: () => void;
  selecting: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onReload: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [afterDraft, setAfterDraft] = useState((task.after ?? []).join(", "));

  const patch = usePatchTask(project);
  const remove = useDeleteTask(project);
  const archive = useArchiveTask(project);
  const reorder = useReorderTasks(project);
  const feedback = useWorkspaceFeedback();

  const busy = patch.isPending || remove.isPending || reorder.isPending || archive.isPending;

  // A task with no id cannot be addressed in the file, so it can be read but
  // not changed. Saying so is better than offering controls that would fail.
  const editable = task.id !== undefined;

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id ?? `unaddressable-${section}-${index}`, disabled: !editable || selecting });

  const run = <T,>(
    mutate: (handlers: {
      onSuccess: (result: T) => void;
      onError: (error: unknown) => void;
    }) => void,
    describe: (result: T) => string,
  ) =>
    mutate({
      onSuccess: (result) => {
        const undoId = (result as { undoId?: string }).undoId;
        feedback.recordEdit(describe(result), undoId);
      },
      onError: (error) => feedback.reportFailure(error, onReload),
    });

  const move = (direction: -1 | 1) => {
    const order = siblings.map((sibling) => sibling.id).filter((id): id is string => id !== undefined);
    const from = order.indexOf(task.id ?? "");
    const to = from + direction;
    if (from === -1 || to < 0 || to >= order.length) return;

    [order[from], order[to]] = [order[to], order[from]];

    run(
      (handlers) => reorder.mutate({ section, taskIds: order, expectedRevision: revision }, handlers),
      () => `${task.id} moved.`,
    );
  };

  const moveTo = (next: SectionKey) =>
    run(
      (handlers) =>
        patch.mutate({ taskId: task.id ?? "", section: next, expectedRevision: revision }, handlers),
      () => `${task.id} moved to ${next}.`,
    );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "bg-os-surface px-3 py-3 transition-colors duration-150",
        isDragging && "opacity-30",
        selected && "bg-os-surface-raised",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {/* Left rail: the drag handle, or in selection mode the selection box.
            One slot, two meanings, so the row does not widen when the mode
            changes. */}
        {selecting ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select ${task.id ?? "task"}`}
            disabled={!editable}
            onClick={onToggleSelected}
            className="os-focus-ring mt-0.5 shrink-0 cursor-pointer rounded-md p-0.5 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {selected ? (
              <SquareCheck className="size-4 text-os-amber" strokeWidth={1.5} />
            ) : (
              <Square className="size-4 text-os-subtle hover:text-foreground" strokeWidth={1.5} />
            )}
          </button>
        ) : (
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label={`Drag ${task.id ?? "task"}`}
            disabled={!editable || busy}
            {...attributes}
            {...listeners}
            className="os-focus-ring mt-1 shrink-0 cursor-grab touch-none rounded-md p-0.5 text-os-subtle/70 transition-colors duration-150 hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-20"
          >
            <GripVertical className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          disabled={!editable || busy || selecting}
          aria-label={task.completed ? `Reopen ${task.id}` : `Complete ${task.id}`}
          onClick={() =>
            run(
              (handlers) =>
                patch.mutate(
                  { taskId: task.id ?? "", completed: !task.completed, expectedRevision: revision },
                  handlers,
                ),
              () => `${task.id} ${task.completed ? "reopened" : "completed"}.`,
            )
          }
          className="os-focus-ring mt-0.5 shrink-0 cursor-pointer rounded-md p-0.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {task.completed ? (
            <SquareCheck className="size-4 text-os-success" strokeWidth={1.5} />
          ) : (
            <Square className="size-4 text-os-subtle hover:text-foreground" strokeWidth={1.5} />
          )}
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  (handlers) =>
                    patch.mutate({ taskId: task.id ?? "", title: draft, expectedRevision: revision }, handlers),
                  () => `${task.id} renamed.`,
                );
                setEditing(false);
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setDraft(task.title);
                    setEditing(false);
                  }
                }}
                className="os-focus-ring min-w-0 flex-1 rounded-md border border-os-border bg-transparent px-2.5 py-1.5 text-[15px] leading-6 text-foreground"
              />
              <CommandButton type="submit" variant="secondary" className="min-h-8">
                Save
              </CommandButton>
            </form>
          ) : (
            <button
              type="button"
              onClick={selecting ? onToggleSelected : onExpand}
              disabled={!editable}
              className="os-focus-ring -mx-1 flex min-w-0 max-w-full cursor-pointer items-baseline gap-2.5 rounded-md px-1 text-left disabled:cursor-default"
            >
              {task.id ? <span className="os-meta shrink-0 text-os-subtle">{task.id}</span> : null}
              <span
                className={cn(
                  "min-w-0 text-[15px] leading-6",
                  task.completed ? "text-os-subtle line-through decoration-os-border" : "text-foreground",
                )}
              >
                {task.title}
              </span>
              {delegation?.active && delegation.status ? (
                <span className="os-meta shrink-0 text-os-amber">
                  · {delegation.status.replace(/_/g, " ")}
                </span>
              ) : null}
              {/* Where it stands, when that is more than "open": blocked, ready,
                  in review. Backlog and done say nothing the row does not. */}
              {roadmap && roadmap.status !== "backlog" && roadmap.status !== "done" && !task.completed ? (
                <span className="inline-flex shrink-0 items-center gap-1.5">
                  <StatusDot status={roadmap.status} />
                  <span className={cn("os-meta", roadmap.status === "blocked" ? "text-os-danger" : "text-os-subtle")}>
                    {roadmap.status === "blocked" ? `Blocked by ${roadmap.blockedBy.join(", ")}` : EXECUTION_LABELS[roadmap.status]}
                  </span>
                </span>
              ) : null}
              {roadmap?.milestoneId ? (
                <span className="os-meta shrink-0 rounded-sm border border-os-border px-1.5 text-os-subtle">
                  {milestones.find((entry) => entry.id === roadmap.milestoneId)?.title ?? roadmap.milestoneId}
                </span>
              ) : null}
            </button>
          )}

          {confirming ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-[13px] leading-5 text-os-warning">
                Delete {task.id}? Worker jobs and costs recorded against it stay, but the task is
                gone. Archive keeps the line.
              </p>
              <CommandButton
                variant="danger"
                className="min-h-8"
                loading={remove.isPending}
                loadingLabel="Deleting"
                onClick={() =>
                  run(
                    (handlers) => remove.mutate({ taskId: task.id ?? "", expectedRevision: revision }, handlers),
                    () => `${task.id} deleted.`,
                  )
                }
              >
                Delete
              </CommandButton>
              <CommandButton variant="quiet" className="min-h-8" onClick={() => setConfirming(false)}>
                Keep
              </CommandButton>
            </div>
          ) : null}

          {menu && !confirming && !selecting ? (
            <div className="mt-3 space-y-2.5">
            {/* Planning: is it ready, which milestone does it serve, what must
                land first. These write the readable tail on the task line and
                the Tasks list in MILESTONES.md. */}
            {!task.completed ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <MenuAction
                  icon={Zap}
                  label={task.ready ? "Ready" : "Mark ready"}
                  active={task.ready}
                  disabled={busy}
                  onClick={() =>
                    run(
                      (handlers) =>
                        patch.mutate({ taskId: task.id ?? "", ready: !task.ready, expectedRevision: revision }, handlers),
                      () => `${task.id} ${task.ready ? "back to backlog" : "marked ready"}.`,
                    )
                  }
                />
                <label className="flex items-center gap-2">
                  <span className="os-meta text-os-subtle">Milestone</span>
                  <select
                    value={roadmap?.milestoneId ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      run(
                        (handlers) =>
                          patch.mutate(
                            { taskId: task.id ?? "", milestone: event.target.value, milestoneRevision },
                            {
                              ...handlers,
                              onSuccess: (result) => handlers.onSuccess({ undoId: result.milestone?.undoId }),
                            },
                          ),
                        () => `${task.id} ${event.target.value ? "assigned" : "unassigned"}.`,
                      )
                    }
                    className="os-focus-ring os-meta cursor-pointer rounded-md border border-os-border bg-os-surface px-2 py-1 text-os-muted"
                  >
                    <option value="">None</option>
                    {milestones.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title}
                      </option>
                    ))}
                  </select>
                </label>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const ids = afterDraft
                      .split(/[,\s]+/)
                      .map((id) => id.trim().toUpperCase())
                      .filter(Boolean);
                    run(
                      (handlers) => patch.mutate({ taskId: task.id ?? "", after: ids, expectedRevision: revision }, handlers),
                      () => (ids.length > 0 ? `${task.id} now waits on ${ids.join(", ")}.` : `${task.id} no longer waits on anything.`),
                    );
                  }}
                >
                  <span className="os-meta text-os-subtle">After</span>
                  <input
                    value={afterDraft}
                    onChange={(event) => setAfterDraft(event.target.value)}
                    placeholder="PP-021, PP-022"
                    aria-label={`Tasks ${task.id} waits on`}
                    className="os-focus-ring w-40 rounded-md border border-os-border bg-transparent px-2 py-1 font-mono text-[12px] uppercase tracking-[0.06em] text-foreground placeholder:text-os-subtle"
                  />
                  <button type="submit" disabled={busy} className="os-focus-ring os-meta cursor-pointer rounded-md px-1.5 py-1 text-os-muted hover:text-foreground disabled:opacity-30">
                    Set
                  </button>
                </form>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="os-meta text-os-subtle">Move to</span>
              {SECTIONS.filter(({ key }) => key !== section).map(({ key, label }) => (
                <MenuAction key={key} label={label} disabled={busy} onClick={() => moveTo(key)} />
              ))}
              <span className="h-3 w-px bg-os-border" aria-hidden="true" />
              <MenuAction
                icon={ChevronUp}
                label="Up"
                disabled={index === 0 || busy}
                onClick={() => move(-1)}
              />
              <MenuAction
                icon={ChevronDown}
                label="Down"
                disabled={index === count - 1 || busy}
                onClick={() => move(1)}
              />
              <span className="h-3 w-px bg-os-border" aria-hidden="true" />
              <MenuAction
                icon={Archive}
                label="Archive"
                disabled={busy}
                onClick={() =>
                  run(
                    (handlers) => archive.mutate({ taskId: task.id ?? "", expectedRevision: revision }, handlers),
                    () => `${task.id} archived.`,
                  )
                }
              />
              <MenuAction
                icon={Trash2}
                label="Delete"
                danger
                disabled={busy}
                onClick={() => {
                  setMenu(false);
                  setConfirming(true);
                }}
              />
            </div>
            </div>
          ) : null}
        </div>

        {editable && !editing && !confirming && !selecting ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {/* Delegation lives where the task is. Editing a task and handing
                it to a worker are the same screen's business. */}
            <RowButton icon={Send} label={`Delegate ${task.id}`} active={expanded} disabled={busy} onClick={onExpand} />
            <RowButton
              icon={Pencil}
              label={`Edit ${task.id}`}
              disabled={busy}
              onClick={() => {
                setDraft(task.title);
                setEditing(true);
              }}
            />
            <RowButton
              icon={MoreHorizontal}
              label={`More actions for ${task.id}`}
              active={menu}
              disabled={busy}
              onClick={() => setMenu((value) => !value)}
            />
          </div>
        ) : null}
      </div>

      {expanded && task.id && !selecting ? (
        <TaskPanel
          project={project}
          task={{
            id: task.id,
            title: task.title,
            completed: task.completed,
            // `Done` is not a delegation horizon; a finished task reads as
            // whichever list it would return to.
            section: section === "done" ? "now" : section,
          }}
          delegation={delegation}
          className="mt-4 ml-12"
        />
      ) : null}
    </li>
  );
}

function ArchivedSection({
  project,
  tasks,
  revision,
  open,
  onToggle,
  onReload,
}: {
  project: string;
  tasks: TaskRecord[];
  revision?: string;
  open: boolean;
  onToggle: () => void;
  onReload: () => void;
}) {
  const restore = useRestoreTask(project);
  const remove = useDeleteTask(project);
  const feedback = useWorkspaceFeedback();
  const [confirming, setConfirming] = useState<string>();

  return (
    <section className="border-t border-os-border pt-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="os-focus-ring os-meta -mx-1 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 text-os-subtle transition-colors duration-150 hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
        Archived
        <span className="tabular-nums">{tasks.length}</span>
      </button>

      {open ? (
        <HairlineCard className="mt-4 overflow-hidden">
          <ul className="divide-y divide-os-border">
            {tasks.map((task, index) => (
              <li key={task.id ?? `archived-${index}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
                  {task.id ? <span className="os-meta shrink-0 text-os-subtle">{task.id}</span> : null}
                  <span className="min-w-0 text-[15px] leading-6 text-os-muted">{task.title}</span>
                </div>

                {task.id ? (
                  confirming === task.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-os-warning">Delete permanently?</span>
                      <CommandButton
                        variant="danger"
                        className="min-h-8"
                        loading={remove.isPending}
                        loadingLabel="Deleting"
                        onClick={() =>
                          remove.mutate(
                            { taskId: task.id ?? "", expectedRevision: revision },
                            {
                              onSuccess: (result) => {
                                feedback.recordEdit(`${task.id} deleted.`, result.undoId);
                                setConfirming(undefined);
                              },
                              onError: (error) => feedback.reportFailure(error, onReload),
                            },
                          )
                        }
                      >
                        Delete
                      </CommandButton>
                      <CommandButton variant="quiet" className="min-h-8" onClick={() => setConfirming(undefined)}>
                        Keep
                      </CommandButton>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0.5">
                      <RowButton
                        icon={RotateCcw}
                        label={`Restore ${task.id}`}
                        disabled={restore.isPending}
                        onClick={() =>
                          restore.mutate(
                            { taskId: task.id ?? "", expectedRevision: revision },
                            {
                              onSuccess: (result) => feedback.recordEdit(`${task.id} restored to later.`, result.undoId),
                              onError: (error) => feedback.reportFailure(error, onReload),
                            },
                          )
                        }
                      />
                      <RowButton icon={Trash2} label={`Delete ${task.id}`} danger onClick={() => setConfirming(task.id)} />
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </HairlineCard>
      ) : null}
    </section>
  );
}

/**
 * The bulk action bar. Sticks to the bottom of the viewport while anything is
 * selected, so the action is where the eye goes after the last checkbox.
 */
function BulkBar({
  count,
  busy,
  onMove,
  onComplete,
  onArchive,
  onClear,
}: {
  count: number;
  busy: boolean;
  onMove: (section: OpenSectionKey) => void;
  onComplete: () => void;
  onArchive: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-os-border-strong bg-os-surface-raised px-4 py-3">
      <span className="os-meta text-foreground">
        <span className="tabular-nums">{count}</span> selected
      </span>

      <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="os-meta text-os-subtle">Move to</span>
        {OPEN_SECTIONS.map(({ key, label }) => (
          <MenuAction key={key} label={label} disabled={busy} onClick={() => onMove(key)} />
        ))}
      </span>

      <span className="h-3 w-px bg-os-border" aria-hidden="true" />
      <MenuAction icon={SquareCheck} label="Mark complete" disabled={busy} onClick={onComplete} />
      <MenuAction icon={Archive} label="Archive" disabled={busy} onClick={onArchive} />

      <button
        type="button"
        onClick={onClear}
        className="os-focus-ring os-meta ml-auto inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden="true" />
        Clear
      </button>
    </div>
  );
}

function MenuAction({
  icon: Icon,
  label,
  disabled,
  danger,
  active,
  onClick,
}: {
  icon?: typeof Pencil;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "os-focus-ring os-meta inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 transition-colors duration-150",
        danger ? "text-os-subtle hover:text-os-danger" : active ? "text-os-amber" : "text-os-muted hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-30",
      )}
    >
      {Icon ? <Icon className="size-3.5" strokeWidth={1.5} aria-hidden="true" /> : null}
      {label}
    </button>
  );
}

function RowButton({
  icon: Icon,
  label,
  disabled,
  danger,
  active,
  onClick,
}: {
  icon: typeof Pencil;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "os-focus-ring cursor-pointer rounded-md p-1.5 transition-colors duration-150",
        active ? "text-os-amber" : "text-os-subtle",
        danger ? "hover:text-os-danger" : "hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-30",
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

