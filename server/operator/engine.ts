import { randomUUID } from "node:crypto";
import {
  maxRisk,
  type OperatorMode,
  type OperatorRun,
  type OperatorStep,
  type RouteDecision,
  type StepOutput,
  type TaskProposal,
} from "../../shared/operator-types";
import type { ProjectPlan } from "../../shared/agentos-types";
import type { CapabilityDecision } from "../connectors/policy";
import { runbookFor, type RunbookContext, type StepTemplate } from "./runbooks";
import { detectStack, type IntentRouter } from "./intent-router";

/**
 * The orchestration loop:
 *
 * ```text
 * INPUT → UNDERSTAND → CONTEXT → PLAN → ROUTE → EXECUTE → VERIFY → RECORD → REPORT
 * ```
 *
 * Understand is the router. Context and plan are the runbook plus Hermes'
 * refinement. Route is each step's capability, checked against Connectors.
 * Execute and verify happen per step (an operation verifies its own write
 * before it reports done). Record is the last step of every writing runbook,
 * and the report is built from what actually happened, not from the plan.
 *
 * Safety properties this file is responsible for:
 * - Ask never writes: a non-read step is refused at execution even if a plan
 *   somehow contained one.
 * - Run writes nothing until a person approves the plan it was shown.
 * - Every capability is re-checked at the moment of use, so switching a
 *   connector off between approval and execution still holds.
 * - Stop halts before the next step, aborts the current model call, cancels
 *   worker jobs the run started, and rolls nothing back: it reports exactly
 *   what had changed.
 */

// ------------------------------------------------------------------ contracts

export interface Scratch {
  workspaceSlug?: string;
  taskId?: string;
  memoryText?: string;
  workspaceText?: string;
  analysis?: string;
  /** The project folder this run created. */
  folderPath?: string;
  /** Ask's answer, as Markdown. */
  answer?: string;
  sources: StepOutput[];
  [key: string]: unknown;
}

export interface OperationContext {
  run: OperatorRun;
  step: OperatorStep;
  signal: AbortSignal;
  scratch: Scratch;
  /** Records something the run changed. What Stop and the report read. */
  change(kind: "local" | "external", description: string, href?: string): void;
  /** Counts one model call against the run. */
  modelCall(): void;
}

export interface OperationResult {
  result: string;
  outputs?: StepOutput[];
}

export interface Operation {
  /** Why it can't run for this run, decided before anything executes. */
  precheck?(run: OperatorRun): Promise<string | undefined>;
  /** Where a person fixes a failed precheck, shown beside the reason. */
  fix?: StepOutput;
  run(context: OperationContext): Promise<OperationResult>;
}

export type OperationRegistry = Readonly<Record<string, Operation>>;

export interface EngineDeps {
  router: IntentRouter;
  operations: OperationRegistry;
  listWorkspaces(): Promise<{ slug: string; name: string }[]>;
  /** Hermes' project plan, or undefined when Hermes can't be reached. */
  planWithHermes(run: OperatorRun, signal: AbortSignal): Promise<ProjectPlan | undefined>;
  /** A read-only policy check. */
  decide(capabilityId: string): CapabilityDecision;
  /** The use-time check: decides again and records the use. */
  authorize(capabilityId: string, detail: string): CapabilityDecision;
  /** Why a capability has no code path yet, or undefined when it has one. */
  capabilityGap(capabilityId: string): string | undefined;
  save(run: OperatorRun): Promise<OperatorRun>;
  cancelJob(jobId: string): Promise<void>;
  usageFor(run: OperatorRun): { tokens?: number; costUsd?: number };
  activity(type: "started" | "completed" | "blocked" | "failed" | "stopped", run: OperatorRun): void;
  /** Read per run: it can be set from Connectors without a restart. */
  projectsRoot?: () => string | undefined;
  now?: () => Date;
}

// ------------------------------------------------------------------ live state

interface Live {
  /** The one copy of the run being worked on. Reads and Stop go through it. */
  run: OperatorRun;
  controller: AbortController;
  stopRequested: boolean;
  done: Promise<void>;
}

const live = new Map<string, Live>();

export function isLive(runId: string): boolean {
  return live.has(runId);
}

/** The in-memory run, when this process is working on it: fresher than the file between saves. */
export function liveRun(runId: string): OperatorRun | undefined {
  return live.get(runId)?.run;
}

// ------------------------------------------------------------------ helpers

function stamp(deps: EngineDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

function toStep(template: StepTemplate): OperatorStep {
  return { ...template, status: "pending", outputs: [] };
}

const MODEL_OPERATIONS = /^(hermes\.|worker\.)/;

function estimate(plan: OperatorStep[]): string {
  const runnable = plan.filter((step) => step.status === "pending" || step.status === "done");
  const hermes = runnable.filter((step) => step.operation.startsWith("hermes.")).length;
  const workers = runnable.filter((step) => step.operation.startsWith("worker.")).length;
  const parts = [
    hermes > 0 ? `${hermes} Hermes call${hermes === 1 ? "" : "s"}` : undefined,
    workers > 0 ? `${workers} worker job${workers === 1 ? "" : "s"}, billed by the worker` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? `About ${parts.join(" and ")}` : "No model calls";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** The services a plan touches, by the connector part of each capability. */
function connectorsOf(plan: OperatorStep[]): string[] {
  return unique(plan.flatMap((step) => (step.capabilityId ? [step.capabilityId.split(".")[0]] : [])));
}

function agentsOf(plan: OperatorStep[]): string[] {
  const agents = new Set(["Hermes", "Claude", "Grok", "Worker"]);
  return unique(plan.filter((step) => agents.has(step.actor)).map((step) => step.actor));
}

function blank(input: string, mode: OperatorMode, deps: EngineDeps): OperatorRun {
  return {
    id: `run_${randomUUID()}`,
    input,
    mode,
    plan: [],
    risks: [],
    agents: [],
    connectors: [],
    status: "planning",
    changes: [],
    memoryProposals: [],
    taskProposals: [],
    jobIds: [],
    errors: [],
    usage: { modelCalls: 0, estimate: "Not estimated yet" },
    startedAt: stamp(deps),
  };
}

// ------------------------------------------------------------------ planning

/**
 * Checks every step against the operation registry, Connectors and its own
 * dependencies, in order. A step is blocked, never silently dropped.
 */
async function assess(run: OperatorRun, deps: EngineDeps): Promise<void> {
  const byId = new Map(run.plan.map((step) => [step.id, step]));

  for (const step of run.plan) {
    if (step.status !== "pending") continue;

    // The step's own gap first: "GitHub repositories aren't built" says more
    // than "waits on Initialise Git", though both are true.
    const gap = step.capabilityId ? deps.capabilityGap(step.capabilityId) : undefined;
    if (gap) {
      step.status = "blocked";
      step.reason = gap;
      continue;
    }

    const waitingOn = step.dependsOn.map((id) => byId.get(id)).find((dependency) => dependency && (dependency.status === "blocked" || dependency.status === "failed"));
    if (waitingOn) {
      step.status = "blocked";
      step.reason = `Waits on “${waitingOn.title}”, which can't run here.`;
      continue;
    }

    if (step.capabilityId) {
      const decision = deps.decide(step.capabilityId);
      if (!decision.allowed) {
        step.status = "blocked";
        step.reason = decision.reason;
        continue;
      }
    }

    const operation = deps.operations[step.operation];
    if (!operation) {
      step.status = "blocked";
      step.reason = "Operator can't do this step yet: there is no code for it.";
      continue;
    }

    const reason = await operation.precheck?.(run).catch((error: unknown) => (error instanceof Error ? error.message : "The step could not be checked."));
    if (reason) {
      step.status = "blocked";
      step.reason = reason;
      step.fix = operation.fix;
    }
  }
}

function deterministicRisks(run: OperatorRun): string[] {
  const risks: string[] = [];
  const external = run.plan.filter((step) => step.external && step.status === "pending");
  if (external.length > 0) risks.push(`Changes outside this machine: ${external.map((step) => step.title).join(", ")}.`);
  const blocked = run.plan.filter((step) => step.status === "blocked");
  if (blocked.length > 0) risks.push(`${blocked.length} of ${run.plan.length} steps can't run here yet; the run will stop short of them.`);
  return risks;
}

function objectiveFor(decision: RouteDecision, input: string, plan: ProjectPlan | undefined): string {
  if (plan?.goal) return plan.goal;
  const firstLine = input.trim().split(/\r?\n/)[0] ?? input;
  return `${decision.intent}: ${firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine}`;
}

/** Understand, gather, plan. Leaves the run planned and assessed; executes nothing. */
async function planRun(run: OperatorRun, deps: EngineDeps, signal: AbortSignal): Promise<void> {
  const workspaces = await deps.listWorkspaces().catch(() => []);
  let decision = await deps.router.route({ input: run.input, mode: run.mode, workspaces, projectsRoot: deps.projectsRoot?.() });

  // Hermes plans what the runbook can't know: the name, the objective, the
  // first tasks. Only for runbooks that create something, and never in Ask.
  const creates = decision.workflow === "new-code-project" || decision.workflow === "business-venture";
  let hermesPlan: ProjectPlan | undefined;
  if (creates && run.mode !== "ask") {
    hermesPlan = await deps.planWithHermes(run, signal);
    if (hermesPlan) run.usage.modelCalls += 1;

    if (!decision.workspace || (decision.workspace.action === "create" && !decision.workspace.name)) {
      const name = hermesPlan?.name ?? "New project";
      const slug = hermesPlan?.slug ?? "new-project";
      const existing = workspaces.find((workspace) => workspace.slug === slug);
      decision = {
        ...decision,
        workspace: existing ? { action: "use", ...existing } : { action: "create", slug, name },
      };
    }
  }

  const context: RunbookContext = {
    workspace: decision.workspace,
    targetUrl: decision.targetUrl,
    projectsRoot: deps.projectsRoot?.(),
    stack: detectStack(run.input),
  };

  run.intent = decision;
  run.workspaceId = decision.workspace?.slug;
  run.plan = runbookFor(decision.workflow).steps(context).map(toStep);
  run.objective = objectiveFor(decision, run.input, hermesPlan);

  // The planning step, where the runbook has one, is the refinement just done.
  const planningStep = run.plan.find((step) => step.operation === "hermes.plan");
  if (planningStep) {
    planningStep.status = "done";
    planningStep.finishedAt = stamp(deps);
    planningStep.result = hermesPlan
      ? `Planned by Hermes: ${hermesPlan.initialTasks.length} first task${hermesPlan.initialTasks.length === 1 ? "" : "s"}.`
      : "Hermes wasn't available, so the plan is the runbook as written.";
  }

  if (hermesPlan && decision.workspace) {
    const slug = decision.workspace.slug;
    run.taskProposals = hermesPlan.initialTasks.slice(0, 8).map(
      (task): TaskProposal => ({ id: randomUUID(), workspaceSlug: slug, title: task.title, section: task.section }),
    );
  }

  await assess(run, deps);

  run.risks = unique([...(hermesPlan?.risks ?? []), ...deterministicRisks(run)]).slice(0, 8);
  run.agents = agentsOf(run.plan);
  run.connectors = connectorsOf(run.plan);
  run.usage.estimate = estimate(run.plan);
  run.intent = { ...decision, risk: maxRisk(run.plan.filter((step) => step.status === "pending").map((step) => step.risk)) };
}

// ------------------------------------------------------------------ execution

function settle(run: OperatorRun, deps: EngineDeps): void {
  const failed = run.plan.filter((step) => step.status === "failed");
  const notRun = run.plan.filter((step) => step.status === "blocked" || step.status === "skipped");
  const done = run.plan.filter((step) => step.status === "done");

  if (run.status !== "stopped") {
    if (failed.length > 0) {
      run.status = "failed";
      run.statusDetail = `${failed[0].title}: ${failed[0].reason ?? "failed"}`;
    } else if (notRun.length > 0) {
      run.status = "blocked";
      run.statusDetail = `${notRun.length} step${notRun.length === 1 ? "" : "s"} couldn't run here.`;
    } else {
      run.status = "completed";
      run.statusDetail = undefined;
    }
  }

  const usage = deps.usageFor(run);
  run.usage = { ...run.usage, ...usage };
  run.completedAt = stamp(deps);

  const answer = run.report?.answer;
  const summaryParts = [
    `${done.length} of ${run.plan.length} steps done.`,
    run.changes.length > 0 ? `${run.changes.length} change${run.changes.length === 1 ? "" : "s"} made.` : "Nothing was changed.",
    run.status === "stopped" ? "Stopped by you; nothing was rolled back." : undefined,
  ].filter(Boolean);

  const firstBlocked = notRun.find((step) => step.status === "blocked");
  run.report = {
    summary: summaryParts.join(" "),
    answer,
    sources: run.report?.sources ?? [],
    nextAction:
      run.taskProposals.some((task) => !task.taskId) && run.mode === "run"
        ? "Pick the proposed tasks to add."
        : firstBlocked
          ? `Unblock “${firstBlocked.title}”: ${firstBlocked.reason}`
          : run.memoryProposals.some((proposal) => proposal.status === "proposed")
            ? "Review the proposed memory."
            : undefined,
  };
}

async function execute(run: OperatorRun, deps: EngineDeps, state: Live): Promise<void> {
  run.status = "running";
  await deps.save(run);

  const scratch: Scratch = { workspaceSlug: run.intent?.workspace?.action === "use" ? run.intent.workspace.slug : undefined, sources: [] };
  const byId = new Map(run.plan.map((step) => [step.id, step]));

  for (const step of run.plan) {
    if (step.status !== "pending") continue;

    if (state.stopRequested) {
      step.status = "stopped";
      continue;
    }

    const unfinished = step.dependsOn.map((id) => byId.get(id)).find((dependency) => dependency && dependency.status !== "done");
    if (unfinished) {
      step.status = "skipped";
      step.reason = `“${unfinished.title}” did not finish.`;
      continue;
    }

    // Ask is read-only, whatever the plan says.
    if (run.mode === "ask" && step.risk !== "read") {
      step.status = "blocked";
      step.reason = "Ask mode is read-only.";
      continue;
    }

    if (step.capabilityId) {
      const decision = deps.authorize(step.capabilityId, `Operator: ${step.title}`);
      if (!decision.allowed) {
        step.status = "blocked";
        step.reason = decision.reason;
        await deps.save(run);
        continue;
      }
    }

    const operation = deps.operations[step.operation];
    if (!operation) {
      step.status = "blocked";
      step.reason = "Operator can't do this step yet: there is no code for it.";
      continue;
    }

    step.status = "running";
    step.startedAt = stamp(deps);
    await deps.save(run);

    try {
      const outcome = await operation.run({
        run,
        step,
        signal: state.controller.signal,
        scratch,
        change: (kind, description, href) => run.changes.push({ at: stamp(deps), stepId: step.id, kind, description, href }),
        modelCall: () => {
          run.usage.modelCalls += 1;
        },
      });
      step.status = "done";
      step.result = outcome.result;
      step.outputs = outcome.outputs ?? [];
    } catch (error) {
      const message = error instanceof Error ? error.message : "The step failed.";
      step.status = state.stopRequested ? "stopped" : "failed";
      step.reason = state.stopRequested ? "Stopped while running." : message;
      if (!state.stopRequested) run.errors.push(`${step.title}: ${message}`);
    }

    step.finishedAt = stamp(deps);
    if (MODEL_OPERATIONS.test(step.operation)) run.usage.estimate = estimate(run.plan);
    await deps.save(run);
  }

  if (scratch.sources.length > 0 || scratch.answer) {
    run.report = { summary: "", answer: scratch.answer ?? run.report?.answer, sources: scratch.sources };
  }
}

// ------------------------------------------------------------------ public API

function track(run: OperatorRun, work: (state: Live) => Promise<void>): Live {
  const state: Live = { run, controller: new AbortController(), stopRequested: false, done: Promise.resolve() };
  live.set(run.id, state);
  state.done = work(state).finally(() => live.delete(run.id));
  return state;
}

async function finish(run: OperatorRun, deps: EngineDeps): Promise<void> {
  settle(run, deps);
  await deps.save(run);
  deps.activity(run.status === "completed" ? "completed" : run.status === "stopped" ? "stopped" : run.status === "failed" ? "failed" : "blocked", run);
}

/**
 * Starts a run. Returns once it is saved in `planning`; planning (and, for Ask
 * or a read-only Run, execution) continues in the background.
 */
export async function createRun(input: string, mode: OperatorMode, deps: EngineDeps): Promise<{ run: OperatorRun; done: Promise<void> }> {
  const run = blank(input, mode, deps);
  await deps.save(run);
  deps.activity("started", run);

  const state = track(run, async (state) => {
    try {
      await planRun(run, deps, state.controller.signal);
    } catch (error) {
      if (!state.stopRequested) {
        run.status = "failed";
        run.statusDetail = error instanceof Error ? error.message : "Planning failed.";
        run.errors.push(`Planning: ${run.statusDetail}`);
      }
      await finish(run, deps);
      return;
    }

    if (state.stopRequested) {
      run.status = "stopped";
      await finish(run, deps);
      return;
    }

    const runnable = run.plan.filter((step) => step.status === "pending");

    if (mode === "plan") {
      // A plan is the product. Nothing more happens to it; "Run this plan"
      // starts a new run, re-planned against Connectors as they are then.
      run.status = "completed";
      run.completedAt = stamp(deps);
      run.report = {
        summary: `Plan ready: ${runnable.length} of ${run.plan.length} steps can run here.`,
        sources: [],
        nextAction: runnable.length > 0 ? "Run it when you're happy with the plan." : run.plan.find((step) => step.status === "blocked")?.reason,
      };
      await deps.save(run);
      deps.activity("completed", run);
      return;
    }

    if (runnable.length === 0) {
      await finish(run, deps);
      return;
    }

    if (mode === "run" && runnable.some((step) => step.risk !== "read")) {
      run.status = "awaiting_approval";
      await deps.save(run);
      return;
    }

    await execute(run, deps, state);
    await finish(run, deps);
  });

  return { run, done: state.done };
}

export class RunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStateError";
  }
}

/** A person approved the plan they were shown. Re-assesses it first: Connectors may have changed. */
export async function approveRun(run: OperatorRun, deps: EngineDeps): Promise<{ run: OperatorRun; done: Promise<void> }> {
  if (run.status !== "awaiting_approval") throw new RunStateError(`This run is ${run.status.replace(/_/g, " ")}, not waiting for approval.`);
  if (live.has(run.id)) throw new RunStateError("This run is already going.");

  run.approvedAt = stamp(deps);
  const state = track(run, async (state) => {
    await execute(run, deps, state);
    await finish(run, deps);
  });
  return { run, done: state.done };
}

/**
 * The emergency stop. Stops future steps, aborts the step in flight where it
 * can, cancels worker jobs the run started, and keeps everything else as it
 * is. Never rolls back.
 */
export async function stopRun(stored: OperatorRun, deps: EngineDeps): Promise<OperatorRun> {
  const state = live.get(stored.id);
  const run = state?.run ?? stored;

  for (const jobId of run.jobIds) {
    await deps.cancelJob(jobId).catch(() => undefined);
  }

  if (state) {
    state.stopRequested = true;
    state.controller.abort();
    // The loop marks what's left and records the report.
    run.status = "stopped";
    await state.done;
    return run;
  }

  if (run.status === "awaiting_approval" || run.status === "planning" || run.status === "running") {
    run.status = "stopped";
    for (const step of run.plan) {
      if (step.status === "pending" || step.status === "running") step.status = "stopped";
    }
    await finish(run, deps);
    return run;
  }

  throw new RunStateError(`This run is already ${run.status.replace(/_/g, " ")}.`);
}

/**
 * After a restart, runs that were planning or running are not resumed: the
 * process that held their state is gone. They are marked stopped, with
 * exactly the steps that had finished.
 */
export function reconcileInterrupted(run: OperatorRun, now: Date = new Date()): OperatorRun | undefined {
  if (run.status !== "planning" && run.status !== "running") return undefined;
  if (live.has(run.id)) return undefined;

  return {
    ...run,
    status: "stopped",
    statusDetail: "AgentOS restarted during this run. It was not resumed.",
    completedAt: now.toISOString(),
    plan: run.plan.map((step) => (step.status === "pending" || step.status === "running" ? { ...step, status: "stopped" as const } : step)),
  };
}
