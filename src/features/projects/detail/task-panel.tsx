import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import type { ProjectTask } from "@shared/agentos-types";
import type {
  DelegationPlan,
  TaskDelegationState,
  TaskRoutePreview,
} from "@shared/delegation-types";
import type { RoutingMode } from "@shared/route-policy-types";
import type { WorkerId } from "@shared/worker-types";
import {
  CommandButton,
  SectionLabel,
  StatusPill,
} from "@/components/os";
import {
  useExecutionOptions,
  useProjectDocuments,
  usePrepareTaskDelegation,
  useRouteTaskDelegation,
  useStartTaskDelegation,
  useTaskCompletion,
  useWorkers,
} from "@/lib/agentos/queries";
import { optionLabel } from "@/features/workers/route-policy-model";
import { RoutePolicyPanel } from "@/features/workers/route-policy-panel";
import { RoutingControls } from "@/features/workers/routing-controls";
import { RoutingDecision } from "@/features/workers/routing-decision";
import { VisualAcceptanceFields } from "@/features/workers/visual-acceptance-fields";
import { visualAcceptanceProblem } from "@/features/workers/workers-model";
import { cn } from "@/lib/utils";
import { ContextPicker } from "./context-picker";
import { DocumentList } from "./document-list";
import { TaskCloseoutPanel } from "./task-closeout-panel";
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
  const recheck = useRouteTaskDelegation(project);
  const start = useStartTaskDelegation(project);
  const executionOptions = useExecutionOptions();

  const [plan, setPlan] = useState<DelegationPlan>();
  const [editing, setEditing] = useState(false);

  // How the route policy should choose, and (for Manual) what was picked.
  const [mode, setMode] = useState<RoutingMode>("auto");
  const [manualId, setManualId] = useState<string>();
  // A route re-checked after the plan was edited or the mode changed replaces
  // the one that came with the plan.
  const [rechecked, setRechecked] = useState<TaskRoutePreview>();

  const route: TaskRoutePreview | undefined = rechecked ?? prepare.data;
  const routing = route?.routing;
  const policy = route?.policy;

  // Workers the policy does not route (the rehearsal worker) are still
  // choosable by hand, through the pre-policy path.
  const optionIds = new Set((executionOptions.data?.options ?? []).map((option) => option.id));
  const legacyWorkers = workers.filter((entry) => entry.id !== "ollama" && !optionIds.has(entry.id));
  const legacyChoice: WorkerId | undefined =
    mode === "manual" ? legacyWorkers.find((entry) => entry.id === manualId)?.id : undefined;

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
          <span className="font-mono text-os-subtle">TASKS.md</span>, for
          example{" "}
          <span className="font-mono text-os-subtle">
            - [ ] [PP-014] {task.title}
          </span>
          .
        </p>
      </div>
    );
  }

  const resolved: WorkerId | undefined = legacyChoice ?? routing?.selectedWorker;

  const manualNeedsPick = mode === "manual" && !manualId;

  /** The routing fields for a request: a legacy pick runs as named, with no policy. */
  const choice = () =>
    legacyChoice
      ? { requestedWorker: legacyChoice }
      : {
          requestedWorker: "auto" as const,
          routingMode: mode,
          manualOptionId: mode === "manual" ? manualId : undefined,
        };

  const askForPlan = () => {
    if (prepare.isPending || manualNeedsPick) return;

    prepare.mutate(
      { taskId: task.id as string, ...choice() },
      {
        onSuccess: (preview) => {
          setPlan(preview.plan);
          setRechecked(undefined);
        },
      },
    );
  };

  /**
   * Checks the route again for the plan as it now stands, without scoping it
   * again. Called when the mode or the manual pick changes, and when an edit to
   * the plan is finished, so the route on screen is always about this plan.
   */
  const recheckRoute = (
    next: { mode: RoutingMode; manualId?: string },
    currentPlan: DelegationPlan | undefined = plan,
  ) => {
    if (!currentPlan || (next.mode === "manual" && !next.manualId)) return;

    const legacy = next.mode === "manual" && legacyWorkers.some((entry) => entry.id === next.manualId);
    if (legacy) {
      setRechecked({});
      return;
    }

    recheck.mutate(
      {
        taskId: task.id as string,
        plan: currentPlan,
        requestedWorker: "auto",
        routingMode: next.mode,
        manualOptionId: next.mode === "manual" ? next.manualId : undefined,
      },
      { onSuccess: setRechecked },
    );
  };

  const changeMode = (next: RoutingMode) => {
    setMode(next);
    setManualId(undefined);
    setRechecked(next === "manual" ? {} : undefined);
    if (plan && next !== "manual") recheckRoute({ mode: next });
  };

  const pickManual = (id: string) => {
    setManualId(id);
    if (plan) recheckRoute({ mode: "manual", manualId: id });
  };

  // Refused here rather than sent: the adapter parses this strictly and drops a
  // context it cannot read, so an incomplete route would not fail loudly — it
  // would quietly turn verification off on a task that asked for it.
  const visualProblem = visualAcceptanceProblem(plan?.visualAcceptance);

  const delegate = () => {
    if (!plan || !resolved || visualProblem || start.isPending) return;

    start.mutate({
      taskId: task.id as string,
      approval: {
        plan,
        // The server plans again and records what actually ran. Auto and Local
        // only are sent as modes; a manual pick or a legacy worker by name.
        worker: legacyChoice || mode === "manual" || !policy ? resolved : "auto",
        routing,
        routingMode: legacyChoice ? undefined : mode,
        manualOptionId: !legacyChoice && mode === "manual" ? manualId : undefined,
      },
    });
  };

  const editPlan = (patch: Partial<DelegationPlan>) => {
    setPlan((current) => (current ? { ...current, ...patch } : current));
  };

  const failure =
    prepare.error instanceof Error
      ? prepare.error.message
      : recheck.error instanceof Error
        ? recheck.error.message
      : start.error instanceof Error
        ? start.error.message
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
              {delegation.worker ?? "worker"} ·{" "}
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
              <SectionLabel>{proposal.ready ? "Ready to close" : "Closeout"}</SectionLabel>

              {/* The panel owns every state: the form while it can close, the
                  record once it has, and the reason when it cannot yet. */}
              <TaskCloseoutPanel
                project={project}
                taskId={task.id}
                enabled
                line={proposal.ready ? { before: proposal.before, after: proposal.after } : undefined}
              />
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
              <RoutingControls
                className="mt-3"
                mode={mode}
                onModeChange={changeMode}
                manualId={manualId}
                onManualChange={setManualId}
                workers={allWorkers}
                legacyWorkers={legacyWorkers}
              />
              <p className="os-meta mt-3 text-os-subtle">
                Hermes scopes the task into a plan first, then the router shows
                where it would run and why. Nothing runs until you approve it
              </p>
              <div className="mt-4">
                <CommandButton
                  variant="primary"
                  onClick={askForPlan}
                  disabled={manualNeedsPick}
                  loading={prepare.isPending}
                  loadingLabel="Scoping"
                >
                  {manualNeedsPick ? "Pick a worker" : "Prepare delegation"}
                </CommandButton>
              </div>
            </>
          ) : (
            <>
              <SectionLabel>Delegation plan</SectionLabel>

              {plan.scopedBy === "agentos" ? (
                <p className="mt-2 max-w-[62ch] text-[13px] leading-5 text-os-subtle">
                  Hermes did not answer, so this is only the task restated. Edit
                  it before delegating: nothing has been scoped for you.
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
                        None. Nothing will be verified. Add a command if this
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

              {/* Where this would run, and why. The router's full finding when it
                  made the decision (including why something was ruled out, or
                  why the task is blocked); Hermes' recommendation when the
                  router had nothing to add. */}
              {policy ? (
                <RoutePolicyPanel className="mt-5" record={policy} workers={allWorkers} />
              ) : routing ? (
                <RoutingDecision
                  className="mt-5"
                  decision={routing}
                  workers={allWorkers}
                  candidates={route?.candidates}
                />
              ) : route?.routingError ? (
                <p className="mt-5 text-[13px] leading-5 text-os-danger">{route.routingError}</p>
              ) : null}

              {recheck.isPending ? (
                <p role="status" className="os-meta mt-3 text-os-subtle">
                  Checking the route…
                </p>
              ) : null}

              {/* Changing how it is routed re-checks the route for this plan;
                  it does not scope the task again. */}
              <RoutingControls
                className="mt-5"
                mode={mode}
                onModeChange={changeMode}
                manualId={manualId}
                onManualChange={pickManual}
                workers={allWorkers}
                legacyWorkers={legacyWorkers}
              />

              <div className="mt-5 flex flex-wrap gap-2">
                <CommandButton
                  variant="primary"
                  onClick={delegate}
                  disabled={
                    !resolved ||
                    recheck.isPending ||
                    Boolean(visualProblem) ||
                    plan.objective.trim().length === 0
                  }
                  loading={start.isPending}
                  loadingLabel="Delegating"
                >
                  {resolved
                    ? `Delegate to ${
                        policy?.selected
                          ? optionLabel(policy.selected, (id) => allWorkers.find((entry) => entry.id === id)?.name ?? id)
                          : (workers.find((entry) => entry.id === resolved)?.name ?? resolved)
                      }`
                    : policy?.status === "blocked"
                      ? "Blocked"
                      : "Delegate"}
                </CommandButton>
                <CommandButton
                  variant="quiet"
                  onClick={() => {
                    // Finishing an edit re-checks the route: the objective is
                    // what the router reads, so a route about the old wording
                    // would be a route about a different task.
                    if (editing) recheckRoute({ mode, manualId });
                    setEditing((value) => !value);
                  }}
                >
                  {editing ? "Done editing" : "Edit plan"}
                </CommandButton>
                <CommandButton
                  variant="quiet"
                  onClick={() => {
                    setPlan(undefined);
                    setRechecked(undefined);
                  }}
                >
                  Cancel
                </CommandButton>
              </div>
            </>
          )}
        </div>
      ) : null}

      {active ? (
        <p className="os-meta mt-4 text-os-subtle">
          Worker job active. This task cannot be delegated again until it
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
