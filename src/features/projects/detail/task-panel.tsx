import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import type { ProjectTask } from "@shared/agentos-types";
import type {
  DelegationPlan,
  TaskDelegationState,
} from "@shared/delegation-types";
import type { WorkerId } from "@shared/worker-types";
import {
  CommandButton,
  FilterBar,
  SectionLabel,
  StatusPill,
} from "@/components/os";
import {
  useCompleteTask,
  useProjectDocuments,
  usePrepareTaskDelegation,
  useStartTaskDelegation,
  useTaskCompletion,
  useWorkers,
} from "@/lib/agentos/queries";
import { RoutingDecision } from "@/features/workers/routing-decision";
import { VisualAcceptanceFields } from "@/features/workers/visual-acceptance-fields";
import { visualAcceptanceProblem } from "@/features/workers/workers-model";
import { cn } from "@/lib/utils";
import { ContextPicker } from "./context-picker";
import { DocumentList } from "./document-list";
import { taskJobState } from "./task-job-state";

/**
 * One task, opened.
 *
 * The whole delegation is here, in the order a person works through it: read
 * the task, ask for a plan, read the plan, choose who runs it, hand it over,
 * follow it, and finally close it. Every one of those is a separate beat with
 * something to read in between, because each is a decision — and the only
 * reason to build this screen at all is so those decisions are made by someone
 * rather than by a chain of automatic steps.
 *
 * What this panel deliberately does not do is review anything. Once a job
 * exists it links out to the worker's own review screen: rebuilding review
 * here would mean two places that could approve work, which is exactly one too
 * many.
 */

export interface TaskPanelProps {
  project: string;
  task: ProjectTask;
  delegation?: TaskDelegationState;
  className?: string;
}

function PlanList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-4">
      <SectionLabel>{label}</SectionLabel>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex max-w-[62ch] gap-2 text-[13px] leading-5 text-os-muted"
          >
            <Check
              className="mt-0.5 size-3.5 shrink-0 text-os-subtle"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TaskPanel({
  project,
  task,
  delegation,
  className,
}: TaskPanelProps) {
  const { data: workersData } = useWorkers();
  // Only workers that could take the job right now: switched on in AI Stack and healthy.
  const allWorkers = workersData?.workers ?? [];
  const workers = allWorkers.filter((entry) => entry.available);

  const prepare = usePrepareTaskDelegation(project);
  const start = useStartTaskDelegation(project);
  const complete = useCompleteTask(project);

  const [plan, setPlan] = useState<DelegationPlan>();
  const [worker, setWorker] = useState<WorkerId | "auto">("auto");
  const [override, setOverride] = useState<WorkerId>();
  const [editing, setEditing] = useState(false);

  const routing = prepare.data?.routing;

  const completion = useTaskCompletion(
    project,
    task.id,
    delegation?.status === "completed",
  );

  const active = delegation?.active === true;
  const jobId = delegation?.jobId;

  /**
   * A task with no id cannot be delegated.
   *
   * Said plainly rather than by a disabled button with no explanation: the fix
   * is a one-line edit in `TASKS.md`, and the operator can only make it if the
   * console says what is missing.
   */
  if (!task.id) {
    return (
      <div className={cn("border-t border-os-border px-5 py-5 md:px-6", className)}>
        <SectionLabel>Id required</SectionLabel>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-muted">
          This task has no id, so there is nothing to file a worker job under or
          to tick off afterwards. Give it one in{" "}
          <span className="font-mono text-os-subtle">TASKS.md</span> — for
          example{" "}
          <span className="font-mono text-os-subtle">
            - [ ] [PP-014] {task.title}
          </span>
          .
        </p>
      </div>
    );
  }

  const resolved: WorkerId | undefined =
    worker === "auto" ? (override ?? routing?.selectedWorker) : worker;

  const askForPlan = () => {
    if (prepare.isPending) return;

    prepare.mutate(
      { taskId: task.id as string, requestedWorker: worker },
      { onSuccess: (preview) => setPlan(preview.plan) },
    );
  };

  // Refused here rather than sent: the adapter parses this strictly and drops a
  // context it cannot read, so an incomplete route would not fail loudly — it
  // would quietly turn verification off on a task that asked for it.
  const visualProblem = visualAcceptanceProblem(plan?.visualAcceptance);

  const delegate = () => {
    if (!plan || !resolved || visualProblem || start.isPending) return;

    start.mutate({
      taskId: task.id as string,
      approval: { plan, worker: resolved, routing },
    });
  };

  const editPlan = (patch: Partial<DelegationPlan>) => {
    setPlan((current) => (current ? { ...current, ...patch } : current));
  };

  const failure =
    prepare.error instanceof Error
      ? prepare.error.message
      : start.error instanceof Error
        ? start.error.message
        : complete.error instanceof Error
          ? complete.error.message
          : undefined;

  const proposal = completion.data?.proposal;

  return (
    <div
      className={cn(
        "border-t border-os-border px-5 py-5 md:px-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="os-meta font-mono text-os-amber">{task.id}</span>
        <span className="os-meta text-os-subtle">{task.section}</span>
        {task.completed ? (
          <StatusPill status="completed" label="Complete" />
        ) : null}
      </div>

      <p className="mt-3 max-w-[62ch] text-[15px] leading-6 text-foreground">
        {task.title}
      </p>

      {/* What this task has produced so far: plans, research, reports — kept
          under the task rather than in a worktree that gets discarded. */}
      <TaskArtifacts project={project} taskId={task.id} />

      {/* Already delegated. The task follows its job rather than offering to
          start a second one, and review happens on the worker's own screen. */}
      {delegation ? (
        <div className="mt-5">
          <SectionLabel>Worker job</SectionLabel>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-[13px] leading-5 text-os-muted">
              {delegation.worker ?? "worker"} —{" "}
              {taskJobState(delegation.status)?.label ?? "unknown"}
            </span>
            {delegation.reviewVerdict ? (
              <span className="os-meta text-os-subtle">
                Review: {delegation.reviewVerdict.replace(/_/g, " ")}
              </span>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={`/workers/jobs/${jobId}`}>
              <CommandButton variant="primary">
                {delegation.status === "awaiting_review"
                  ? "Review and approve"
                  : "View job"}
                <ArrowRight className="size-3.5" strokeWidth={1.5} />
              </CommandButton>
            </Link>
          </div>

          {/* The completion proposal, which only appears once the work is in
              the repository. Shown as the exact line that would change. */}
          {proposal ? (
            <div className="mt-5 border-t border-os-border pt-4">
              <SectionLabel>Ready to close</SectionLabel>

              {proposal.ready ? (
                <>
                  <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-muted">
                    The implementation is integrated. This would change one line
                    in TASKS.md:
                  </p>
                  <div className="mt-3 space-y-1 font-mono text-[12px] leading-5">
                    <p className="text-os-subtle line-through">{proposal.before}</p>
                    <p className="text-os-success">{proposal.after}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <CommandButton
                      variant="primary"
                      onClick={() => complete.mutate(task.id as string)}
                      loading={complete.isPending}
                      loadingLabel="Updating"
                    >
                      Mark complete
                    </CommandButton>
                    <span className="os-meta self-center text-os-subtle">
                      or leave it open
                    </span>
                  </div>
                </>
              ) : (
                <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
                  {proposal.blockedReason}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Not delegated yet, and nothing running. */}
      {!delegation || (!active && delegation.status !== "completed") ? (
        <div className={cn(delegation && "mt-6 border-t border-os-border pt-5")}>
          {!plan ? (
            <>
              <SectionLabel>Delegate</SectionLabel>
              <div className="mt-3">
                <FilterBar<WorkerId | "auto">
                  label="Choose a worker"
                  value={worker}
                  onChange={(next) => {
                    setWorker(next);
                    setOverride(undefined);
                  }}
                  options={[
                    { value: "auto", label: "Auto" },
                    ...workers.map((entry) => ({
                      value: entry.id as WorkerId | "auto",
                      label: entry.name,
                    })),
                  ]}
                />
              </div>
              <p className="os-meta mt-3 text-os-subtle">
                Hermes scopes the task into a plan first — nothing runs until
                you approve it
              </p>
              <div className="mt-4">
                <CommandButton
                  variant="primary"
                  onClick={askForPlan}
                  loading={prepare.isPending}
                  loadingLabel="Scoping"
                >
                  Prepare delegation
                </CommandButton>
              </div>
            </>
          ) : (
            <>
              <SectionLabel>Delegation plan</SectionLabel>

              {plan.scopedBy === "agentos" ? (
                <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
                  Hermes did not answer, so this is only the task restated. Edit
                  it before delegating — nothing has been scoped for you.
                </p>
              ) : null}

              {editing ? (
                <div className="mt-3 space-y-4">
                  <label className="block">
                    <SectionLabel>Objective</SectionLabel>
                    <textarea
                      value={plan.objective}
                      onChange={(event) =>
                        editPlan({ objective: event.target.value })
                      }
                      rows={3}
                      className="os-focus-ring mt-2 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[14px] leading-6 text-foreground"
                    />
                  </label>
                  <label className="block">
                    <SectionLabel>Acceptance, one per line</SectionLabel>
                    <textarea
                      value={plan.acceptanceCriteria.join("\n")}
                      onChange={(event) =>
                        editPlan({
                          acceptanceCriteria: event.target.value
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                        })
                      }
                      rows={4}
                      className="os-focus-ring mt-2 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[13px] leading-6 text-foreground"
                    />
                  </label>
                  <label className="block">
                    <SectionLabel>Validation, one per line</SectionLabel>
                    <textarea
                      value={plan.validationCommands.join("\n")}
                      onChange={(event) =>
                        editPlan({
                          validationCommands: event.target.value
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                        })
                      }
                      rows={2}
                      placeholder="npm run build"
                      className="os-focus-ring mt-2 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 font-mono text-[12px] leading-6 text-foreground placeholder:text-os-subtle"
                    />
                  </label>
                </div>
              ) : (
                <>
                  <p className="mt-3 max-w-[62ch] text-[14px] leading-6 text-os-muted">
                    {plan.objective}
                  </p>

                  <PlanList label="Acceptance" items={plan.acceptanceCriteria} />
                  <PlanList label="Constraints" items={plan.constraints} />
                  {/* Always live, editing or not: what the worker reads is a
                      decision the operator makes every time, with the token
                      bill in view. */}
                  <ContextPicker
                    slug={project}
                    value={plan.contextFiles}
                    onChange={(contextFiles) => editPlan({ contextFiles })}
                  />

                  <div className="mt-4">
                    <SectionLabel>Validation</SectionLabel>
                    {plan.validationCommands.length === 0 ? (
                      // Named, because "no failures" and "nothing was checked"
                      // look identical on a screen otherwise.
                      <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
                        None. Nothing will be verified — add a command if this
                        repository has one.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {plan.validationCommands.map((command) => (
                          <li
                            key={command}
                            className="font-mono text-[12px] leading-5 text-os-muted"
                          >
                            {command}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {/* A decision about the work, not prose to correct, so it is
                  always editable rather than hidden behind "Edit plan". What
                  the project already knows — its board, its brief — arrives
                  filled in; whether this task has a screen does not. */}
              <VisualAcceptanceFields
                className="mt-6"
                value={plan.visualAcceptance}
                onChange={(next) => editPlan({ visualAcceptance: next })}
                project={plan.project}
              />

              {routing ? (
                <RoutingDecision
                  className="mt-5"
                  decision={routing}
                  workers={allWorkers}
                  candidates={prepare.data?.candidates}
                  overriddenTo={override}
                />
              ) : null}

              {routing ? (
                <div className="mt-4">
                  <SectionLabel>Run it with</SectionLabel>
                  <FilterBar<WorkerId>
                    label="Override the recommendation"
                    className="mt-2"
                    value={resolved ?? routing.selectedWorker}
                    onChange={setOverride}
                    options={workers.map((entry) => ({
                      value: entry.id,
                      label: entry.name,
                    }))}
                  />
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2">
                <CommandButton
                  variant="primary"
                  onClick={delegate}
                  disabled={
                    !resolved ||
                    Boolean(visualProblem) ||
                    plan.objective.trim().length === 0
                  }
                  loading={start.isPending}
                  loadingLabel="Delegating"
                >
                  {resolved
                    ? `Delegate to ${
                        workers.find((entry) => entry.id === resolved)?.name ??
                        resolved
                      }`
                    : "Delegate"}
                </CommandButton>
                <CommandButton
                  variant="quiet"
                  onClick={() => setEditing((value) => !value)}
                >
                  {editing ? "Done editing" : "Edit plan"}
                </CommandButton>
                <CommandButton variant="quiet" onClick={() => setPlan(undefined)}>
                  Cancel
                </CommandButton>
              </div>
            </>
          )}
        </div>
      ) : null}

      {active ? (
        <p className="os-meta mt-4 text-os-subtle">
          Worker job active — this task cannot be delegated again until it
          finishes
        </p>
      ) : null}

      {failure ? (
        <p className="mt-4 text-[13px] leading-5 text-os-danger">{failure}</p>
      ) : null}
    </div>
  );
}

/** The documents filed under one task. Nothing shown when there are none. */
function TaskArtifacts({ project, taskId }: { project: string; taskId: string }) {
  const { data } = useProjectDocuments(project);
  const artifacts = (data?.agentos ?? []).filter((document) => document.taskId === taskId);

  if (artifacts.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-4">
        <SectionLabel>Artifacts</SectionLabel>
        <span className="os-meta text-os-subtle tabular-nums">{artifacts.length}</span>
      </div>
      <DocumentList documents={artifacts} dense className="mt-2" />
    </div>
  );
}
