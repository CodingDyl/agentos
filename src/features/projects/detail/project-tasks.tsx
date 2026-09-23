import { useState } from "react";
import { ChevronDown, ChevronRight, Square, SquareCheck } from "lucide-react";
import type { ProjectTask, ProjectTaskGroup } from "@shared/agentos-types";
import type { TaskDelegationState } from "@shared/delegation-types";
import { EmptyState, HairlineCard, Section, StatusPill } from "@/components/os";
import { useTaskDelegations } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { TaskPanel } from "./task-panel";
import { taskJobState } from "./task-job-state";

export interface ProjectTasksProps {
  project: string;
  tasks: ProjectTaskGroup;
}

const HORIZONS = [
  { key: "now", label: "Now" },
  { key: "next", label: "Next" },
  { key: "later", label: "Later" },
] as const satisfies readonly { key: keyof ProjectTaskGroup; label: string }[];

/**
 * Work by horizon, and what is happening to it.
 *
 * Still read-only as a list: the checkboxes are drawn, not interactive. A task
 * closes when the work behind it is integrated and a person approves that,
 * which is a decision made inside the task rather than a box anyone can tick
 * in passing.
 *
 * What is new is that a row now carries its job. A task that has been handed
 * to a worker says so where the task is, rather than only on the workers
 * screen — which is the difference between a project you can run from and a
 * list you have to cross-reference.
 */
export function ProjectTasks({ project, tasks }: ProjectTasksProps) {
  const { data } = useTaskDelegations(project);
  const [open, setOpen] = useState<string>();

  const delegations = new Map<string, TaskDelegationState>(
    (data?.delegations ?? []).map((entry) => [
      entry.taskId.toUpperCase(),
      entry,
    ]),
  );

  const isEmpty = HORIZONS.every(({ key }) => tasks[key].length === 0);

  if (isEmpty) {
    return (
      <EmptyState
        label="No tasks"
        description="Nothing is listed in TASKS.md for this project."
      />
    );
  }

  return (
    <div className="space-y-10">
      {HORIZONS.map(({ key, label }) => {
        const items = tasks[key];
        if (items.length === 0) return null;

        return (
          <Section key={key} label={label} action={`${items.length}`}>
            <HairlineCard className="overflow-hidden">
              <ul className="divide-y divide-os-border">
                {items.map((task, index) => (
                  <TaskRow
                    key={task.id ?? `${key}-${index}`}
                    project={project}
                    task={task}
                    delegation={
                      task.id
                        ? delegations.get(task.id.toUpperCase())
                        : undefined
                    }
                    open={open === (task.id ?? `${key}-${index}`)}
                    onToggle={() =>
                      setOpen((current) => {
                        const id = task.id ?? `${key}-${index}`;
                        return current === id ? undefined : id;
                      })
                    }
                  />
                ))}
              </ul>
            </HairlineCard>
          </Section>
        );
      })}
    </div>
  );
}

function TaskRow({
  project,
  task,
  delegation,
  open,
  onToggle,
}: {
  project: string;
  task: ProjectTask;
  delegation?: TaskDelegationState;
  open: boolean;
  onToggle: () => void;
}) {
  const state = taskJobState(delegation?.status);
  const Box = task.completed ? SquareCheck : Square;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="os-focus-ring flex w-full min-h-14 items-start gap-3 px-5 py-4 text-left transition-colors duration-150 hover:bg-os-surface-raised md:px-6"
      >
        <Box
          className={cn(
            "mt-0.5 size-4 shrink-0",
            task.completed ? "text-os-success" : "text-os-subtle",
          )}
          strokeWidth={1.5}
          aria-hidden="true"
        />

        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* The id, where it is the thing that makes a task delegatable. A
              task without one is shown plainly rather than hidden. */}
          {task.id ? (
            <span className="os-meta shrink-0 font-mono text-os-subtle">
              {task.id}
            </span>
          ) : null}

          <span
            className={cn(
              "min-w-0 text-[15px] leading-6",
              task.completed ? "text-os-subtle line-through" : "text-os-muted",
            )}
          >
            {task.title}
          </span>

          {state ? (
            <StatusPill
              status={state.tone}
              label={
                delegation?.worker
                  ? `${delegation.worker} · ${state.label}`
                  : state.label
              }
              className="shrink-0"
            />
          ) : null}
        </span>

        <Chevron
          className="mt-0.5 size-4 shrink-0 text-os-subtle"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <TaskPanel project={project} task={task} delegation={delegation} />
      ) : null}
    </li>
  );
}
