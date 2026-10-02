import type { OperatorRun, RunbookSummary } from "../../shared/operator-types";
import { getProjects } from "../agentos/projects";
import { recordActivity } from "../activity/ui-events";
import { findCapability } from "../connectors/catalog";
import { authorize, decide } from "../connectors/policy";
import { planProject } from "../hermes/project-planning";
import { readUsage } from "../usage/ledger";
import { cancelJob } from "../workers/job-manager";
import { reconcileInterrupted, type EngineDeps, type OperationRegistry } from "./engine";
import { resolveIntentRouter } from "./intent-router";
import { OPERATIONS } from "./operations";
import { RUNBOOKS } from "./runbooks";
import { configuredProjectsRoot } from "./project-folder";
import { listRuns, saveRun } from "./store";

/** Why a capability can't be exercised because the code isn't there — separate from policy. */
export function capabilityGap(capabilityId: string): string | undefined {
  const found = findCapability(capabilityId);
  if (!found) return `${capabilityId} is not a known capability.`;
  const { connector, capability } = found;
  if (!connector.integrated) return `${connector.name} isn't connected to AgentOS yet: there's no adapter.`;
  if (!capability.implementedBy) return `“${capability.name}” on ${connector.name} isn't built into AgentOS yet.`;
  return undefined;
}

let cachedDeps: EngineDeps | undefined;

export function operatorDeps(): EngineDeps {
  cachedDeps ??= {
    router: resolveIntentRouter(),
    operations: OPERATIONS,
    listWorkspaces: async () => (await getProjects()).map((project) => ({ slug: project.slug, name: project.name })),
    planWithHermes: (run, signal) => planProject(run.input, { signal, runId: run.id }).catch(() => undefined),
    // A person pressing Run or Approve is the approval an `approval` policy asks for.
    decide: (capabilityId) => decide(capabilityId, "person"),
    authorize: (capabilityId, detail) => authorize(capabilityId, { initiator: "person", detail }),
    capabilityGap,
    save: saveRun,
    cancelJob: async (jobId) => {
      await cancelJob(jobId);
    },
    usageFor: (run) => {
      try {
        const records = readUsage({ from: run.startedAt, agent: "hermes", limit: 500 }).filter((record) => record.runId === run.id);
        if (records.length === 0) return {};
        const tokens = records.reduce((sum, record) => sum + (record.tokens.total ?? (record.tokens.input ?? 0) + (record.tokens.output ?? 0)), 0);
        const priced = records.filter((record) => record.costUsd !== undefined);
        return {
          tokens,
          costUsd: priced.length > 0 ? priced.reduce((sum, record) => sum + (record.costUsd ?? 0), 0) : undefined,
        };
      } catch {
        return {};
      }
    },
    activity: (type, run) => {
      void recordActivity({
        type: `operator.${type}`,
        description: run.intent?.workspace ? `${run.intent.interpretedAs}: ${run.intent.workspace.name}` : run.input.slice(0, 120),
        project: run.workspaceId,
        metadata: { operatorRunId: run.id, mode: run.mode },
      });
    },
    projectsRoot: () => configuredProjectsRoot(),
  };
  return cachedDeps;
}

export function runbookSummaries(operations: OperationRegistry = OPERATIONS): RunbookSummary[] {
  return Object.values(RUNBOOKS).map((runbook) => ({
    id: runbook.id,
    name: runbook.name,
    description: runbook.description,
    example: runbook.example,
    mode: runbook.mode,
    steps: runbook.steps({ stack: [] }).map((step) => ({
      title: step.title,
      actor: step.actor,
      implemented: Boolean(operations[step.operation]) && (!step.capabilityId || capabilityGap(step.capabilityId) === undefined),
    })),
  }));
}

/** On start: runs a previous process was in the middle of are marked stopped, never resumed. */
export async function reconcileOperatorRuns(): Promise<void> {
  const runs = await listRuns(200);
  for (const run of runs) {
    const reconciled: OperatorRun | undefined = reconcileInterrupted(run);
    if (reconciled) await saveRun(reconciled);
  }
}
