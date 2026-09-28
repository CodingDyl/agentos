import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  WorkerPerformance,
  WorkerRoutingDecision,
} from "@shared/worker-routing-types";
import type { VisualAcceptanceContext } from "@shared/visual-verification-types";
import type { WorkerId, WorkerSummary } from "@shared/worker-types";
import {
  CommandButton,
  FilterBar,
  HairlineCard,
  SectionLabel,
} from "@/components/os";
import {
  useProjects,
  useRouteWorkerJob,
  useStartWorkerJob,
} from "@/lib/agentos/queries";
import { RoutingDecision } from "./routing-decision";
import { VisualAcceptanceFields } from "./visual-acceptance-fields";
import { visualAcceptanceProblem } from "./workers-model";

export interface DelegateJobFormProps {
  /** Only workers that reported themselves available. */
  workers: WorkerSummary[];
  onClose: () => void;
  className?: string;
}

/** `auto` is a way of choosing, not a worker. */
type Selection = WorkerId | "auto";

/**
 * Hands one scoped job to a worker.
 *
 * Deliberately short: an objective, who it goes to, and what it belongs to. The
 * repository is optional and, when given, is what triggers isolation — a job
 * with a repo gets its own worktree and never touches the live checkout.
 *
 * `Auto` asks Hermes to choose. It is two steps rather than one on purpose:
 * the recommendation is shown, with its reasoning, and only then is anything
 * delegated. Routing that dispatched on the model's say-so would be a smaller
 * screen and a system where nobody ever saw the decision being made on their
 * behalf — and the first time it chose badly, there would be nothing to read.
 */
export function DelegateJobForm({
  workers,
  onClose,
  className,
}: DelegateJobFormProps) {
  const navigate = useNavigate();
  const { data: projectsData } = useProjects();
  const startJob = useStartWorkerJob();
  const route = useRouteWorkerJob();

  const projects = projectsData?.projects ?? [];

  const [objective, setObjective] = useState("");
  const [selection, setSelection] = useState<Selection>("auto");
  const [project, setProject] = useState(projects[0]?.slug ?? "agentos");
  const [repoPath, setRepoPath] = useState("");
  const [visualAcceptance, setVisualAcceptance] =
    useState<VisualAcceptanceContext>();

  const [decision, setDecision] = useState<WorkerRoutingDecision>();
  const [candidates, setCandidates] = useState<WorkerPerformance[]>();
  /** Set when the operator takes the recommendation and picks someone else. */
  const [override, setOverride] = useState<WorkerId>();
  const [changing, setChanging] = useState(false);

  /**
   * A recommendation belongs to the objective it was made for.
   *
   * Editing the objective after routing would otherwise leave a decision on
   * screen that was reasoned about different work — and it would be sent, and
   * recorded, as though it had been about this job.
   */
  const editObjective = (next: string) => {
    setObjective(next);

    if (decision) {
      setDecision(undefined);
      setCandidates(undefined);
      setOverride(undefined);
      setChanging(false);
    }
  };

  const chooseSelection = (next: Selection) => {
    setSelection(next);
    setOverride(undefined);

    // Leaving auto discards the recommendation: what follows is the operator's
    // own choice, and recording a routing decision beside it would misdescribe
    // who decided.
    if (next !== "auto") {
      setDecision(undefined);
      setCandidates(undefined);
    }

    setChanging(false);
  };

  const hasObjective = objective.trim().length > 0;

  /** Who would actually run, as the form currently stands. */
  const resolved: WorkerId | undefined =
    selection === "auto" ? (override ?? decision?.selectedWorker) : selection;

  const askForRecommendation = () => {
    if (!hasObjective || route.isPending) return;

    route.mutate(
      { objective: objective.trim(), project, repoPath: repoPath.trim() || undefined },
      {
        onSuccess: (result) => {
          setDecision(result.decision);
          setCandidates(result.candidates);
          setOverride(undefined);
        },
      },
    );
  };

  // Refused here rather than sent: the adapter parses this strictly and drops a
  // context it cannot read, so an incomplete route would not fail loudly — it
  // would quietly turn verification off on a job that asked for it.
  const visualProblem = visualAcceptanceProblem(visualAcceptance);

  const submit = () => {
    if (!hasObjective || !resolved || visualProblem || startJob.isPending) return;

    startJob.mutate(
      {
        worker: resolved,
        // What was asked for, kept apart from what runs. An override is only
        // legible later if both halves survive.
        requestedWorker: selection,
        routing: decision,
        project,
        objective: objective.trim(),
        repoPath: repoPath.trim() || undefined,
        // Sent only when it was actually turned on: an unenabled contract is a
        // question the operator answered no to, not a setting to carry along.
        visualAcceptance: visualAcceptance?.enabled ? visualAcceptance : undefined,
      },
      { onSuccess: (job) => navigate(`/workers/jobs/${job.id}`) },
    );
  };

  const workerName = (id: WorkerId) =>
    workers.find((worker) => worker.id === id)?.name ?? id;

  const failure = route.isError
    ? route.error instanceof Error
      ? route.error.message
      : "No worker could be chosen."
    : startJob.isError
      ? startJob.error instanceof Error
        ? startJob.error.message
        : "The job could not be started."
      : undefined;

  return (
    <HairlineCard className={className}>
      <div className="p-5 md:p-6">
        <label className="block">
          <SectionLabel>Objective</SectionLabel>
          <textarea
            autoFocus
            value={objective}
            onChange={(event) => editObjective(event.target.value)}
            rows={2}
            placeholder="Implement the design library masonry grid"
            className="os-focus-ring mt-3 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
          />
        </label>

        <div className="mt-6">
          <SectionLabel>Worker</SectionLabel>
          <FilterBar<Selection>
            label="Choose a worker"
            className="mt-3"
            value={selection}
            onChange={chooseSelection}
            options={[
              { value: "auto", label: "Auto" },
              ...workers.map((entry) => ({
                value: entry.id as Selection,
                label: entry.name,
              })),
            ]}
          />
          {selection === "auto" && !decision ? (
            <span className="os-meta mt-2 block text-os-subtle">
              Hermes picks the worker, and you see the reasoning before anything
              runs
            </span>
          ) : null}
        </div>

        {decision ? (
          <>
            <RoutingDecision
              className="mt-5"
              decision={decision}
              workers={workers}
              candidates={candidates}
              overriddenTo={override}
            />

            {changing ? (
              <div className="mt-4">
                <SectionLabel>Run it with</SectionLabel>
                <FilterBar<WorkerId>
                  label="Override the recommendation"
                  className="mt-3"
                  value={resolved ?? decision.selectedWorker}
                  onChange={setOverride}
                  options={workers.map((entry) => ({
                    value: entry.id,
                    label: entry.name,
                  }))}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {projects.length > 0 ? (
          <div className="mt-6">
            <SectionLabel>Project</SectionLabel>
            <FilterBar<string>
              label="Choose a project"
              className="mt-3"
              value={project}
              onChange={setProject}
              options={projects.map((entry) => ({
                value: entry.slug,
                label: entry.name,
              }))}
            />
          </div>
        ) : null}

        <label className="mt-6 block">
          <SectionLabel>Repository (optional)</SectionLabel>
          <input
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="/Users/you/Developer/project"
            className="os-focus-ring mt-3 min-h-10 w-full rounded-md border border-os-border bg-transparent px-3 font-mono text-[13px] leading-5 text-foreground placeholder:text-os-subtle"
          />
          {/* The reassurance that makes delegating a coding job reasonable. */}
          <span className="os-meta mt-2 block text-os-subtle">
            Given a repository, the worker gets its own git worktree, never your
            working copy
          </span>
        </label>

        <VisualAcceptanceFields
          className="mt-6"
          value={visualAcceptance}
          onChange={setVisualAcceptance}
          project={project}
        />

        {failure ? (
          <p className="mt-5 text-[13px] leading-5 text-os-danger">{failure}</p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {selection === "auto" && !decision ? (
            <CommandButton
              variant="primary"
              onClick={askForRecommendation}
              disabled={!hasObjective || route.isPending}
              loading={route.isPending}
              loadingLabel="Choosing"
            >
              Choose a worker
            </CommandButton>
          ) : (
            <CommandButton
              variant="primary"
              onClick={submit}
              disabled={
                !hasObjective || !resolved || Boolean(visualProblem) || startJob.isPending
              }
              loading={startJob.isPending}
              loadingLabel="Starting"
            >
              {resolved ? `Delegate to ${workerName(resolved)}` : "Delegate"}
            </CommandButton>
          )}

          {decision && !changing ? (
            <CommandButton variant="quiet" onClick={() => setChanging(true)}>
              Change worker
            </CommandButton>
          ) : null}

          <CommandButton variant="quiet" onClick={onClose}>
            Cancel
          </CommandButton>
        </div>
      </div>
    </HairlineCard>
  );
}
