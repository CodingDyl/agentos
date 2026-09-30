import type {
  DelegationPlan,
  TaskDelegationPreview,
  TaskDelegationState,
} from "../../shared/delegation-types";
import type { ProjectConfiguration, ProjectTask } from "../../shared/agentos-types";
import type { WorkerId, WorkerJob } from "../../shared/worker-types";
import type { WorkerRoutingDecision } from "../../shared/worker-routing-types";
import type { VisualAcceptanceContext } from "../../shared/visual-verification-types";
import { recordActivity } from "../activity/ui-events";
import { getLibrary } from "../designs/library";
import { scopeTask } from "../hermes/task-scoping";
import { retrieveMemoryContext } from "../memory/retrieval";
import { memoryService } from "../memory/service";
import { startJob } from "../workers/job-manager";
import { readJob } from "../workers/job-store";
import { routeJob } from "../workers/router";
import { readOptionalFile } from "./filesystem";
import { parseConfiguration } from "./mutations/configuration";
import {
  allTasks,
  getProjectDetail,
  parseRepositoryPath,
} from "./projects";
import { projectTaskLinks, readTaskLink, saveTaskLink } from "./task-jobs";

/**
 * Delegating a project task.
 *
 * The join between the vault and the worker pipeline, and the whole of what is
 * new here is sequencing: scope, route, show, approve, start. Once a job
 * exists, everything downstream — isolation, validation, review, approval,
 * integration — is the pipeline that already existed, unchanged. Nothing in
 * this module reimplements any part of it.
 *
 * Three refusals are enforced here rather than left to the screen:
 *
 * - **A task with no id cannot be delegated.** There would be nothing to file
 *   the job under, and nothing to tick off afterwards.
 * - **A task with a live job cannot be delegated again.** Two workers
 *   implementing the same task in two worktrees is not a race anyone wins.
 * - **A plan is never started by the same call that produced it.** Preparing
 *   and delegating are separate endpoints because a person is meant to read
 *   the plan in between.
 */

const PROJECTS_DIR = "projects";

/** The brief a project keeps for its own design direction, when it keeps one. */
const PROJECT_BRIEF = "design/BRIEF.md";

/**
 * Job states that still belong to a task.
 *
 * Everything up to and including integration: a job awaiting review has not
 * finished with the task, and offering to delegate it again would put two
 * implementations of one task in front of the operator.
 *
 * `rejected`, `failed` and `cancelled` release the task deliberately — those
 * are the cases where trying again is exactly what an operator wants.
 */
const HOLDS_THE_TASK = new Set([
  "queued",
  "preparing",
  "running",
  "waiting",
  "validating",
  "awaiting_review",
  "reviewing",
  "changes_required",
  "approved",
  "integrating",
]);

export interface TaskLookup {
  task?: ProjectTask & { id: string };
  error?: string;
}

/**
 * Finds one task by id.
 *
 * Refuses a task with no id rather than matching on its title. A title is
 * prose a person edits freely; using it as an identifier would mean a task
 * silently became a different task the moment someone reworded it.
 */
export async function findTask(
  slug: string,
  taskId: string,
): Promise<TaskLookup> {
  const detail = await getProjectDetail(slug);
  if (!detail) return { error: `There is no project called ${slug}.` };

  const wanted = taskId.trim().toUpperCase();

  const task = allTasks(detail.tasks).find(
    (entry) => entry.id?.toUpperCase() === wanted,
  );

  if (!task?.id) {
    return {
      error: `${taskId} is not a task in ${slug}. Tasks need an id like [PP-014] in TASKS.md before they can be delegated.`,
    };
  }

  // A blocked task is not sent to a worker. The dependency is on the line for
  // exactly this reason: a worker building on top of work that has not landed
  // produces a diff nobody can integrate.
  const open = new Set(
    allTasks(detail.tasks)
      .filter((entry) => entry.id && !entry.completed)
      .map((entry) => entry.id as string),
  );
  const blockedBy = (task.after ?? []).filter((id) => open.has(id));

  if (blockedBy.length > 0) {
    return {
      error: `${task.id} is blocked by ${blockedBy.join(", ")}. Finish or unlink ${blockedBy.length === 1 ? "it" : "them"} before delegating.`,
    };
  }

  return { task: task as ProjectTask & { id: string } };
}

/**
 * Whether a task already has a job that has not finished with it.
 *
 * Read from the job itself rather than from the link, because the link only
 * records that a delegation happened — the job is the thing that knows whether
 * it is still going.
 */
export async function activeJobFor(
  slug: string,
  taskId: string,
): Promise<WorkerJob | undefined> {
  const link = await readTaskLink(slug, taskId);
  if (!link) return undefined;

  const job = await readJob(link.jobId);

  return job && HOLDS_THE_TASK.has(job.status) ? job : undefined;
}

/**
 * The design context this project already has, attached to the plan.
 *
 * Discovered rather than asked for, because the alternative is asking a person
 * to name a board and a brief they have already told the system about. What is
 * *not* discovered is `enabled` and `routes`: whether this particular task
 * produces a screen, and which screens, is a judgement, and guessing it would
 * either put a backend ticket through a browser or quietly verify nothing.
 *
 * A project with several boards is left blank on purpose. Picking one would be
 * choosing what the work is measured against on the operator's behalf.
 */
async function discoverVisualAcceptance(
  slug: string,
  configuration: ProjectConfiguration,
  taskType: string | undefined,
): Promise<VisualAcceptanceContext | undefined> {
  const [brief, library] = await Promise.all([
    readOptionalFile(`${PROJECTS_DIR}/${slug}/${PROJECT_BRIEF}`).catch(
      () => undefined,
    ),
    getLibrary().catch(() => undefined),
  ]);

  const boards = (library?.boards ?? []).filter(
    (board) => board.project === slug,
  );

  // The configured board wins, by id or by name; otherwise only an
  // unambiguous single board is picked up.
  const configured = configuration.designBoard?.trim().toLowerCase();
  const chosen = configured
    ? boards.find(
        (board) =>
          board.id.toLowerCase() === configured ||
          board.name.trim().toLowerCase() === configured,
      )
    : undefined;

  const boardId = chosen?.id ?? (boards.length === 1 ? boards[0].id : undefined);

  if (!brief && !boardId) return undefined;

  return {
    // Off until a person says this task has a screen worth looking at (Step
    // 49.20: a Java API ticket must not end up driving a browser) — unless the
    // project's own defaults say otherwise, and then only for the kinds of
    // work those defaults name.
    enabled: defaultVisualEnabled(configuration, taskType),
    routes: [],
    boardId,
    designBriefPath: brief
      ? `${PROJECTS_DIR}/${slug}/${PROJECT_BRIEF}`
      : undefined,
  };
}

/** The task types a `ui-tasks` default counts as UI work. */
const UI_TASK_TYPES = new Set(["design-implementation"]);

function defaultVisualEnabled(
  configuration: ProjectConfiguration,
  taskType: string | undefined,
): boolean {
  switch (configuration.visualVerification) {
    case "always":
      return true;
    case "ui-tasks":
      return taskType !== undefined && UI_TASK_TYPES.has(taskType);
    default:
      return false;
  }
}

/**
 * Scopes a task and recommends a worker, without starting anything.
 *
 * Both halves are prepared together because they are read together: what the
 * work is, and who would do it. Routing runs against Hermes' objective rather
 * than the bare task title, so the recommendation is made about the actual
 * brief.
 */
export async function prepareDelegation(
  slug: string,
  taskId: string,
  requestedWorker: WorkerId | "auto",
): Promise<{ preview?: TaskDelegationPreview; error?: string }> {
  const { task, error } = await findTask(slug, taskId);
  if (!task) return { error };

  const existing = await activeJobFor(slug, taskId);

  if (existing) {
    return {
      error: `${task.id} already has a worker job (${existing.id}) that is ${existing.status.replace(/_/g, " ")}.`,
    };
  }

  const directory = `${PROJECTS_DIR}/${slug}`;

  const [projectMarkdown, statusMarkdown, tasksMarkdown, decisionsMarkdown] =
    await Promise.all([
      readOptionalFile(`${directory}/PROJECT.md`),
      readOptionalFile(`${directory}/STATUS.md`),
      readOptionalFile(`${directory}/TASKS.md`),
      readOptionalFile(`${directory}/DECISIONS.md`),
    ]);

  // The four project files are already in the packet; memory adds what else
  // in the vault bears on this task, with where each excerpt came from.
  const memory = await retrieveMemoryContext(memoryService(), {
    project: slug,
    query: task.title,
    skipRequired: true,
    budgetTokens: 1_500,
  }).catch(() => undefined);

  const scoped = await scopeTask({
    project: slug,
    task,
    projectMarkdown,
    statusMarkdown,
    tasksMarkdown,
    decisionsMarkdown,
    memoryText: memory?.text || undefined,
  });

  const configuration = parseConfiguration(projectMarkdown);

  // Carried from here to the job, and from the job to the review. The whole
  // point is that nobody downstream has to reconstruct it. Project defaults
  // fill whatever Hermes left blank: the configured validation commands are
  // the ones this repository is known to have.
  const plan: DelegationPlan = {
    ...scoped,
    scopingMemory: memory
      ? { status: memory.status, sources: memory.sources, warnings: memory.warnings }
      : undefined,
    validationCommands:
      scoped.validationCommands.length > 0
        ? scoped.validationCommands
        : configuration.validationCommands,
    visualAcceptance:
      scoped.visualAcceptance ??
      (await discoverVisualAcceptance(slug, configuration, scoped.suggestedTaskType)),
  };

  await recordActivity({
    type: "task.scoped",
    description: `${task.id} scoped: ${plan.objective.slice(0, 120)}`,
    project: slug,
    metadata: { taskId: task.id, scopedBy: plan.scopedBy },
  });

  // A worker the operator named needs no recommendation — asking for one would
  // spend a Hermes call to be told what they already decided.
  if (requestedWorker !== "auto") {
    return { preview: { plan } };
  }

  const { decision, candidates, error: routingError } = await routeJob({
    objective: plan.objective,
    project: slug,
  });

  return { preview: { plan, routing: decision, candidates, routingError } };
}

/**
 * Starts the work, from a plan a person has approved.
 *
 * The plan becomes an ordinary `WorkerJobRequest` and goes through `startJob`
 * like any other. That is the property worth protecting: a delegated task is
 * not a special kind of job with its own execution path, it is the same job
 * with a better brief.
 */
export async function delegateTask(
  slug: string,
  taskId: string,
  approval: {
    plan: DelegationPlan;
    worker: WorkerId | "auto";
    routing?: WorkerRoutingDecision;
    repoPath?: string;
  },
): Promise<{ job?: WorkerJob; error?: string }> {
  const { task, error } = await findTask(slug, taskId);
  if (!task) return { error };

  // Checked again here, not only when the plan was prepared: a plan can sit on
  // screen for a while, and something else may have delegated it since.
  const existing = await activeJobFor(slug, taskId);

  if (existing) {
    return {
      error: `${task.id} already has a worker job (${existing.id}) that is ${existing.status.replace(/_/g, " ")}.`,
    };
  }

  const projectMarkdown = await readOptionalFile(`${PROJECTS_DIR}/${slug}/PROJECT.md`);
  const repoPath =
    approval.repoPath ?? (projectMarkdown ? parseRepositoryPath(projectMarkdown) : undefined);
  const configuration = parseConfiguration(projectMarkdown);

  const { job, error: startError } = await startJob({
    worker: approval.worker,
    requestedWorker: approval.worker,
    routing: approval.routing,
    project: slug,
    objective: approval.plan.objective,
    repoPath,
    // The project's configured branch, when it names one; the checkout otherwise.
    baseRef: configuration.defaultBranch,
    contextFiles: approval.plan.contextFiles,
    // The task's own identity travels with the job, so a worker's brief says
    // which task it is answering rather than only what to build.
    constraints: [
      `This job implements task ${task.id}: ${task.title}`,
      ...approval.plan.constraints,
    ],
    acceptanceCriteria: approval.plan.acceptanceCriteria,
    validationCommands: approval.plan.validationCommands,
    // Only when the operator turned it on. A plan carrying a board and a brief
    // is a plan that *could* be verified visually, not one that asked to be.
    visualAcceptance: approval.plan.visualAcceptance?.enabled
      ? approval.plan.visualAcceptance
      : undefined,
  });

  if (!job) return { error: startError };

  await saveTaskLink({
    project: slug,
    taskId: task.id,
    jobId: job.id,
    delegatedAt: new Date().toISOString(),
  });

  await recordActivity({
    type: "task.delegated",
    description: `${task.id} delegated to ${job.resolvedWorker ?? approval.worker}: ${task.title}`,
    project: slug,
    metadata: {
      taskId: task.id,
      jobId: job.id,
      worker: job.resolvedWorker,
      scopedBy: approval.plan.scopedBy,
    },
    // Stamped with the job's own creation time. The delegation happened before
    // the worker started; it can only be written down afterwards, because the
    // job has to exist first.
    timestamp: job.createdAt,
  });

  return { job };
}

/**
 * What has been delegated in this project, and where each job has got to.
 *
 * Reads the live job for every link so a task row can say "running" or
 * "awaiting review" without the projects screen needing to know anything about
 * how jobs work.
 */
export async function taskDelegations(
  slug: string,
): Promise<TaskDelegationState[]> {
  const links = await projectTaskLinks(slug);

  return Promise.all(
    links.map(async (link) => {
      const job = await readJob(link.jobId);

      return {
        ...link,
        status: job?.status,
        worker: job?.resolvedWorker,
        reviewVerdict: job?.review?.verdict,
        // A link whose job has vanished is not holding the task hostage.
        active: job ? HOLDS_THE_TASK.has(job.status) : false,
      };
    }),
  );
}


