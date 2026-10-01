import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryDuplicateMatch } from "../../shared/memory-types";
import type {
  CompleteTaskRequest,
  MemoryOutcome,
  MemoryProposal,
  TaskCloseout,
  TaskCloseoutDraft,
  TaskCloseoutRecord,
} from "../../shared/task-closeout-types";
import type { WorkerJob } from "../../shared/worker-types";
import { recordActivity } from "../activity/ui-events";
import { readStatus, writeStatus } from "../agentos/mutations/status";
import { assertSlug } from "../agentos/mutations/tasks";
import { uiStateDir } from "../agentos/session-store";
import { applyCompletion, proposeCompletion } from "../agentos/task-completion";
import { readTaskLink, saveTaskLink } from "../agentos/task-jobs";
import { findDuplicates } from "../memory/duplicate-detection";
import { HUMAN } from "../memory/mutations";
import { applyDecision, parseCloseoutLines, precheckDecision, toProposal } from "../memory/proposals";
import type { MemoryService } from "../memory/service";
import { readJob } from "../workers/job-store";

/**
 * A task's closeout: the moment finished work leaves something behind.
 *
 * Before a task is ticked off, the closeout answers what changed, what was
 * completed, what was learned, whether it set a pattern or settled a
 * decision, and whether the project's status should move. The parts are
 * handled differently by design:
 *
 * - **Operational facts** (worker, completion time, validation, changed files,
 *   artifacts) are recorded automatically — on the closeout record and in
 *   Activity. They are history, and never become memory on their own.
 * - **Memory proposals** come from the agent and are only proposals. The
 *   person edits, unticks or dismisses each; only what they keep is written,
 *   after a duplicate check.
 * - **A STATUS.md update** is proposed the same way and applied only when
 *   ticked, through the revision-checked writer. PROJECT.md is never touched:
 *   it is the project's identity, not its changelog.
 *
 * Everything that can refuse is checked before anything is written, so a
 * closeout that stops — a duplicate, a status edited meanwhile — stops with
 * the task still open and nothing half-done.
 */

export class CloseoutError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function closeoutsDir(): string {
  return path.join(uiStateDir(), "closeouts");
}

function closeoutFile(project: string, taskId: string): string {
  return path.join(closeoutsDir(), `${assertSlug(project)}__${taskId.toUpperCase().replace(/[^A-Z0-9-]/g, "")}.json`);
}

export async function readCloseoutRecord(project: string, taskId: string): Promise<TaskCloseoutRecord | undefined> {
  try {
    return JSON.parse(await fs.readFile(closeoutFile(project, taskId), "utf8")) as TaskCloseoutRecord;
  } catch {
    return undefined;
  }
}

async function saveCloseoutRecord(record: TaskCloseoutRecord): Promise<void> {
  const file = closeoutFile(record.project, record.taskId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

/** The worker that ran a job, in the words proposals are attributed with. */
function agentOf(job: WorkerJob | undefined): string {
  const worker = job?.resolvedWorker ?? (job?.worker !== "auto" ? job?.worker : undefined);
  return worker ? `agent:${worker}` : "agent";
}

/**
 * The closeout a job's result implies. Pure: everything comes from the job
 * record, so the same job always closes out the same way.
 */
export function buildCloseout(project: string, taskId: string, job: WorkerJob | undefined, fallbackSummary?: string): Omit<TaskCloseout, "completedAt"> {
  const result = job?.result;
  const parsed = parseCloseoutLines(result?.summary ?? "");
  const artifacts = (result?.artifacts ?? []).map((artifact) => artifact.registeredPath ?? artifact.path);

  const memoryProposals: MemoryProposal[] = parsed.proposals.map((raw) =>
    toProposal(raw, {
      project,
      taskId,
      proposedBy: agentOf(job),
      sourceRun: job?.id,
      sourceArtifact: artifacts[0],
    }),
  );

  return {
    taskId,
    project,
    summary: parsed.summary || fallbackSummary || `${taskId} is complete.`,
    changedFiles: result?.changedFiles?.length ? result.changedFiles : undefined,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    memoryProposals,
    suggestedStatusUpdate: parsed.statusUpdate,
    worker: job?.resolvedWorker ?? (job?.worker !== "auto" ? job?.worker : undefined),
    jobId: job?.id,
    validation: result?.tests?.map((test) => ({ command: test.command, success: test.success })),
  };
}

async function jobFor(project: string, taskId: string) {
  const link = await readTaskLink(project, taskId);
  const job = link ? await readJob(link.jobId) : undefined;
  return { link, job };
}

/** What the closeout screen shows before the task is completed. */
export async function draftCloseout(service: MemoryService, project: string, taskId: string): Promise<TaskCloseoutDraft | undefined> {
  assertSlug(project);
  const { job } = await jobFor(project, taskId);
  const proposal = await proposeCompletion(project, taskId, job);
  if (!proposal) return undefined;

  const closeout = buildCloseout(project, taskId, job);
  const record = await readCloseoutRecord(project, taskId);
  const status = await readStatus(project).catch(() => undefined);

  const proposals = await Promise.all(
    closeout.memoryProposals.map(async (entry) => ({
      ...entry,
      duplicates: await findDuplicates(service, project, entry).catch(() => [] as MemoryDuplicateMatch[]),
    })),
  );

  return {
    ready: proposal.ready,
    blockedReason: proposal.blockedReason,
    closeout,
    proposals,
    currentStatus: status ? { heading: status.heading, body: status.body, revision: status.revision } : undefined,
    record,
  };
}

/** Proposals may only write into the project and for the task being closed. */
function checkScope(project: string, taskId: string, request: CompleteTaskRequest, service: MemoryService) {
  for (const decision of request.memory ?? []) {
    const { proposal } = decision;
    if (proposal.project !== project || (proposal.sourceTask ?? "").toUpperCase() !== taskId.toUpperCase()) {
      throw new CloseoutError("A memory proposal does not belong to this task.", 400);
    }
    if (decision.action === "update") {
      if (!decision.targetId || !decision.targetRevision) throw new CloseoutError(`“${proposal.title}” needs the memory it updates.`, 400);
      if (proposal.type !== "decision" && (!decision.targetId.startsWith(`projects/${project}/`) || !service.index.notes.has(decision.targetId))) {
        throw new CloseoutError(`“${proposal.title}” can only update memory in this project.`, 400);
      }
    }
  }
}

/**
 * Completes a task with its closeout.
 *
 * Called with an empty request it behaves exactly as completion always has —
 * the task is ticked and the operational facts recorded — so nothing that
 * completed tasks before has to know about closeouts.
 */
export async function completeTaskWithCloseout(
  service: MemoryService,
  project: string,
  taskId: string,
  request: CompleteTaskRequest,
): Promise<TaskCloseoutRecord> {
  assertSlug(project);
  const { link, job } = await jobFor(project, taskId);
  const completion = await proposeCompletion(project, taskId, job);
  if (!completion) throw new CloseoutError("That task is not in TASKS.md.", 404);
  // Re-checked at the moment of writing rather than trusted from the screen.
  if (!completion.ready) throw new CloseoutError(completion.blockedReason ?? "That task cannot be closed yet.", 409);

  checkScope(project, taskId, request, service);

  // 1. Everything that can refuse, before anything is written.
  const conflicts: Array<{ proposalId: string; duplicates: MemoryDuplicateMatch[] }> = [];
  for (const decision of request.memory ?? []) {
    const duplicates = await precheckDecision(service, decision);
    if (duplicates) conflicts.push({ proposalId: decision.proposal.id, duplicates });
  }
  if (conflicts.length > 0) {
    throw new CloseoutError("Some proposed memory looks like memory that already exists. Choose to update it or create a new note.", 409, {
      code: "possible_duplicates",
      proposals: conflicts,
    });
  }

  if (request.statusUpdate) {
    const current = await readStatus(project);
    if (current.revision !== request.statusUpdate.expectedRevision) {
      throw new CloseoutError("STATUS.md changed since the closeout was opened. Reopen it to see the current status.", 409, {
        code: "revision_conflict",
        currentRevision: current.revision,
      });
    }
  }

  // 2. The task itself.
  const ticked = await applyCompletion(project, taskId);
  if (!ticked.ok) throw new CloseoutError(ticked.error ?? "TASKS.md could not be updated.", 409);
  const completedAt = new Date().toISOString();
  if (link) await saveTaskLink({ ...link, completedAt });

  // 3. What the person chose to remember.
  const memoryOutcomes: MemoryOutcome[] = [];
  for (const decision of request.memory ?? []) {
    memoryOutcomes.push(await applyDecision(service, decision, HUMAN));
  }

  // 4. Status, when ticked.
  let statusApplied = false;
  let statusError: string | undefined;
  if (request.statusUpdate) {
    try {
      await writeStatus({ slug: project, body: request.statusUpdate.body, expectedRevision: request.statusUpdate.expectedRevision });
      statusApplied = true;
      await service.reindex(new Set([`projects/${project}/STATUS.md`]));
    } catch (error) {
      statusError = (error as Error).message || "STATUS.md could not be updated.";
    }
  }

  const closeout = buildCloseout(project, taskId, job);
  const decided = (request.memory ?? []).map((decision) => decision.proposal);
  const record: TaskCloseoutRecord = {
    ...closeout,
    summary: request.summary?.trim() || closeout.summary,
    memoryProposals: decided.length > 0 ? decided : closeout.memoryProposals,
    suggestedStatusUpdate: request.statusUpdate?.body ?? closeout.suggestedStatusUpdate,
    completedAt,
    memoryOutcomes,
    statusApplied,
    statusError,
  };

  await saveCloseoutRecord(record).catch((error) => console.error("[closeout] could not save the record:", error));

  // 5. Operational facts, to Activity. Recorded, never turned into memory.
  await recordActivity({
    type: "task.completed",
    description: `${taskId} marked complete in TASKS.md`,
    project,
    metadata: {
      taskId,
      jobId: link?.jobId,
      worker: record.worker,
      completedAt,
      validation: record.validation,
      changedFiles: record.changedFiles?.slice(0, 50),
      changedFileCount: record.changedFiles?.length ?? 0,
      artifacts: record.artifacts,
      remembered: memoryOutcomes.filter((outcome) => outcome.outcome === "created" || outcome.outcome === "updated").length,
    },
  });
  for (const outcome of memoryOutcomes) {
    if (outcome.outcome === "created" || outcome.outcome === "updated") {
      await recordActivity({
        type: "memory.proposal_saved",
        description: `${outcome.title} → ${outcome.target ?? "memory"}`,
        project,
        metadata: { taskId, proposalId: outcome.proposalId, target: outcome.target, outcome: outcome.outcome },
      });
    } else if (outcome.outcome === "dismissed") {
      await recordActivity({
        type: "memory.proposal_dismissed",
        description: outcome.title,
        project,
        metadata: { taskId, proposalId: outcome.proposalId },
      });
    }
  }
  if (statusApplied) {
    await recordActivity({ type: "status.updated", description: `STATUS.md updated at ${taskId} closeout`, project, metadata: { taskId } });
  }

  return record;
}
