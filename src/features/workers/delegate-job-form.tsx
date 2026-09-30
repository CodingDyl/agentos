import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  WorkerPerformance,
  WorkerRoutingDecision,
} from "@shared/worker-routing-types";
import type { RoutePolicyRecord, RoutingMode } from "@shared/route-policy-types";
import type { VisualAcceptanceContext } from "@shared/visual-verification-types";
import type { WorkerId, WorkerSummary } from "@shared/worker-types";
import {
  CommandButton,
  FilterBar,
  HairlineCard,
  SectionLabel,
} from "@/components/os";
import {
  useExecutionOptions,
  usePreviewRoute,
  useProjects,
  useRouteWorkerJob,
  useStartWorkerJob,
} from "@/lib/agentos/queries";
import { RoutePolicyPanel } from "./route-policy-panel";
import { optionLabel, parseSchemaInput } from "./route-policy-model";
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

  // Route policy. `auto` and `local_only` are ways of choosing; `manual` is the
  // operator naming a worker (and, for Ollama, the exact model) themselves.
  const [mode, setMode] = useState<RoutingMode>("auto");
  const [inputText, setInputText] = useState("");
  const [outputFormat, setOutputFormat] = useState<"text" | "json">("text");
  const [schemaText, setSchemaText] = useState("");
  const [manualId, setManualId] = useState<string>();
  const [record, setRecord] = useState<RoutePolicyRecord>();
  const preview = usePreviewRoute();
  const executionOptions = useExecutionOptions();
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
  /** Anything the route was reasoned about has changed, so it no longer applies. */
  const resetRoute = () => {
    setRecord(undefined);
    setDecision(undefined);
    setCandidates(undefined);
    setOverride(undefined);
    setChanging(false);
  };

  const editObjective = (next: string) => {
    setObjective(next);
    resetRoute();
  };

  const chooseMode = (next: RoutingMode) => {
    setMode(next);
    setManualId(undefined);
    setSelection("auto");
    resetRoute();
  };

  const schema = outputFormat === "json" ? parseSchemaInput(schemaText) : {};
  const expectedOutput =
    outputFormat === "json" ? { format: "json" as const, schema: schema.schema } : undefined;

  const previewInput = (optionId?: string) => ({
    project,
    objective: objective.trim(),
    inputText: inputText.trim() || undefined,
    repoPath: repoPath.trim() || undefined,
    expectedOutput,
    routingMode: mode,
    manualOptionId: optionId,
    routingHints: mode === "local_only" ? { localOnly: true } : undefined,
  });

  /** Options the policy does not know (a rehearsal worker) keep the legacy path. */
  const optionIds = new Set((executionOptions.data?.options ?? []).map((option) => option.id));
  const legacyWorkers = workers.filter((worker) => worker.id !== "ollama" && !optionIds.has(worker.id));
  const isLegacyChoice = mode === "manual" && legacyWorkers.some((worker) => worker.id === manualId);

  const pickManual = (id: string) => {
    setManualId(id);
    resetRoute();

    const legacy = legacyWorkers.some((worker) => worker.id === id);
    setSelection(legacy ? (id as WorkerId) : "auto");
    if (legacy || !hasObjective) return;

    preview.mutate(previewInput(id), {
      onSuccess: (result) => {
        if (!result.legacy) setRecord(result.record);
      },
    });
  };

  const hasObjective = objective.trim().length > 0;

  /** Who would actually run, as the form currently stands. */
  const resolved: WorkerId | undefined =
    selection === "auto" ? (override ?? decision?.selectedWorker) : selection;

  const askForRecommendation = () => {
    if (!hasObjective || route.isPending || preview.isPending || schema.error) return;

    // The route policy goes first. When it has nothing to add (no local model
    // is enabled and the task may use the cloud) the existing Hermes
    // recommendation applies exactly as before.
    preview.mutate(previewInput(), {
      onSuccess: (result) => {
        if (result.legacy) askHermes();
        else setRecord(result.record);
      },
    });
  };

  const askHermes = () => {
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

  const policySelected = record?.status === "selected" ? record.selected : undefined;

  const submitPolicy = () => {
    if (!policySelected || visualProblem || startJob.isPending) return;

    startJob.mutate(
      {
        // The server plans again at dispatch and records what actually ran;
        // it never trusts a route sent from here.
        worker: mode === "manual" ? policySelected.workerId : "auto",
        requestedWorker: mode === "manual" ? policySelected.workerId : "auto",
        routingMode: mode,
        manualOptionId: mode === "manual" ? manualId : undefined,
        routingHints: mode === "local_only" ? { localOnly: true } : undefined,
        inputText: inputText.trim() || undefined,
        expectedOutput,
        project,
        objective: objective.trim(),
        repoPath: repoPath.trim() || undefined,
        visualAcceptance: visualAcceptance?.enabled ? visualAcceptance : undefined,
      },
      { onSuccess: (job) => navigate(`/workers/jobs/${job.id}`) },
    );
  };

  const submit = () => {
    if (!hasObjective || !resolved || visualProblem || startJob.isPending) return;

    startJob.mutate(
      {
        inputText: inputText.trim() || undefined,
        expectedOutput,
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

  const failure = preview.isError
    ? preview.error instanceof Error
      ? preview.error.message
      : "The route could not be previewed."
    : schema.error
      ? schema.error
    : route.isError
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

        <label className="mt-6 block">
          <SectionLabel>Supplied text (optional)</SectionLabel>
          <textarea
            value={inputText}
            onChange={(event) => {
              setInputText(event.target.value);
              resetRoute();
            }}
            rows={4}
            placeholder="Paste the notes, message or snippet the task works on"
            className="os-focus-ring mt-3 w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 font-mono text-[13px] leading-5 text-foreground placeholder:text-os-subtle"
          />
          <span className="os-meta mt-2 block text-os-subtle">
            Sent whole. If it is too long for a local model, the task is routed elsewhere or blocked, never cut short
          </span>
        </label>

        <div className="mt-6">
          <SectionLabel>Expected output</SectionLabel>
          <FilterBar<"text" | "json">
            label="Expected output"
            className="mt-3"
            value={outputFormat}
            onChange={(next) => {
              setOutputFormat(next);
              resetRoute();
            }}
            options={[
              { value: "text", label: "Text" },
              { value: "json", label: "JSON" },
            ]}
          />
          {outputFormat === "json" ? (
            <label className="mt-3 block">
              <textarea
                value={schemaText}
                onChange={(event) => {
                  setSchemaText(event.target.value);
                  resetRoute();
                }}
                rows={3}
                aria-label="JSON Schema (optional)"
                placeholder='Optional JSON Schema, e.g. {"type":"object","required":["date"]}'
                className="os-focus-ring w-full resize-y rounded-md border border-os-border bg-transparent px-3 py-2.5 font-mono text-[13px] leading-5 text-foreground placeholder:text-os-subtle"
              />
              <span className="os-meta mt-2 block text-os-subtle">
                The result must parse as JSON{schema.schema ? " and match this schema" : ""} before it can count as done
              </span>
            </label>
          ) : null}
        </div>

        <div className="mt-6">
          <SectionLabel>Routing</SectionLabel>
          <FilterBar<RoutingMode>
            label="Choose how this task is routed"
            className="mt-3"
            value={mode}
            onChange={chooseMode}
            options={[
              { value: "auto", label: "Auto" },
              { value: "local_only", label: "Local only" },
              { value: "manual", label: "Manual" },
            ]}
          />
          <span className="os-meta mt-2 block text-os-subtle">
            {mode === "auto"
              ? "Small bounded text tasks go to an enabled local model; the rest go to a capable worker. You see the reason before anything runs"
              : mode === "local_only"
                ? "Nothing leaves this machine: no cloud provider, including on failure. If no local model can take it, it is blocked"
                : "You choose the worker (and model). The choice is checked and recorded as an override"}
          </span>
        </div>

        {mode === "manual" ? (
          <div className="mt-4">
            <SectionLabel>Run it with</SectionLabel>
            <FilterBar<string>
              label="Choose a worker or model"
              className="mt-3"
              value={manualId ?? ""}
              onChange={pickManual}
              options={[
                ...(executionOptions.data?.options ?? []).map((option) => ({
                  value: option.id,
                  label: optionLabel(option, (id) => workers.find((w) => w.id === id)?.name ?? id),
                })),
                ...legacyWorkers.map((worker) => ({ value: worker.id, label: worker.name })),
              ]}
            />
            {!hasObjective ? (
              <span className="os-meta mt-2 block text-os-subtle">Write the objective first so the choice can be checked</span>
            ) : null}
          </div>
        ) : null}

        {record ? <RoutePolicyPanel className="mt-5" record={record} workers={workers} /> : null}

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
          {record ? (
            <CommandButton
              variant="primary"
              onClick={submitPolicy}
              disabled={!policySelected || Boolean(visualProblem) || startJob.isPending}
              loading={startJob.isPending}
              loadingLabel="Starting"
            >
              {policySelected
                ? `Delegate to ${optionLabel(policySelected, workerName)}`
                : "Blocked"}
            </CommandButton>
          ) : mode === "manual" ? (
            <CommandButton
              variant="primary"
              onClick={submit}
              disabled={
                !isLegacyChoice || !hasObjective || Boolean(visualProblem) || startJob.isPending
              }
              loading={startJob.isPending || preview.isPending}
              loadingLabel={preview.isPending ? "Checking" : "Starting"}
            >
              {isLegacyChoice && manualId ? `Delegate to ${workerName(manualId as WorkerId)}` : "Pick a worker"}
            </CommandButton>
          ) : !decision ? (
            <CommandButton
              variant="primary"
              onClick={askForRecommendation}
              disabled={!hasObjective || route.isPending || preview.isPending || Boolean(schema.error)}
              loading={route.isPending || preview.isPending}
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

          {decision && !changing && !record ? (
            <CommandButton variant="quiet" onClick={() => setChanging(true)}>
              Change worker
            </CommandButton>
          ) : null}

          {record && mode !== "manual" ? (
            <CommandButton variant="quiet" onClick={() => chooseMode("manual")}>
              Choose manually
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
