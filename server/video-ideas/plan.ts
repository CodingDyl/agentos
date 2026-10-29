import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MAX_TASKS, PlannedTaskSchema, type DecideRequest, type PlannedTask, type VideoIdea } from "../../shared/video-ideas-types";
import { readOptionalFile, writeAgentOSFile } from "../agentos/filesystem";
import { createTask } from "../agentos/mutations/tasks";
import { startJob } from "../workers/job-manager";
import { getIdea, updateIdea, VideoIdeaError } from "./store";
import { AGENTOS_REPO, closeFiledJob, ensureVideoStudio, outputDir, READ_TOOLS, readOnlyRoots } from "./studio";

/**
 * Approve → plan → tasks. Approving is the go-ahead for the build too: the
 * plan's tasks are created in the AgentOS workspace and start one at a time
 * (see build.ts). Each change still waits for review before it merges.
 */

/** The workspace AgentOS's own tasks live in. */
export const AGENTOS_WORKSPACE = "agentos-os";

export type LaunchPlan = (idea: VideoIdea) => Promise<VideoIdea>;

export async function decide(id: string, request: DecideRequest, launch: LaunchPlan = launchPlan): Promise<VideoIdea> {
  const idea = getIdea(id);
  if (!idea) throw new VideoIdeaError("There is no video idea with that id.", 404);
  if (idea.stage !== "awaiting_decision") throw new VideoIdeaError(`This idea is not waiting for a decision (it is ${idea.stage.replace(/_/g, " ")}).`, 409);
  if (request.decision === "decline") {
    return updateIdea(id, { stage: "declined", declineReason: request.reason || undefined });
  }
  // Claimed before anything is awaited, so a second click finds it taken.
  return launch(updateIdea(id, { stage: "planning", jobId: undefined }));
}

export function planPrompt(idea: VideoIdea, assessmentMarkdown: string): string {
  const out = `ideas/${idea.id}`;
  return [
    "Dylan approved this change to AgentOS. Write the implementation plan as tasks other Claude Code workers will build, one at a time, in order.",
    "",
    `The AgentOS code is at ${AGENTOS_REPO} (read freely, change nothing). Read the files the assessment names before planning.`,
    "",
    `Write ${out}/plan.json: {"tasks":[{"title":"short imperative title","objective":"…","acceptanceCriteria":["…"]}]}.`,
    `- 1 to ${MAX_TASKS} tasks. If it genuinely needs more, write the first ${MAX_TASKS} that deliver something usable on their own.`,
    "- Each objective is self-contained: a worker sees only its own task. Name the exact files to change, the functions and types to add, and the tests to write. Follow the patterns already in the code.",
    "- Each task leaves `npm run typecheck` and `npm test` passing.",
    "- Never propose rebuilding something AgentOS already has.",
    "",
    `Do not write anywhere except ${out}/. Stop when plan.json is written.`,
    "",
    "The approved assessment:",
    assessmentMarkdown,
  ].join("\n");
}

const PlanFileSchema = z.object({ tasks: z.array(PlannedTaskSchema).min(1) });

export function parsePlan(text: string): { tasks: PlannedTask[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Plan could not be read" };
  }
  const result = PlanFileSchema.safeParse(parsed);
  if (!result.success) return { error: "Plan could not be read" };
  if (result.data.tasks.length > MAX_TASKS) return { error: "Plan too big — split it" };
  return { tasks: result.data.tasks };
}

export async function launchPlan(idea: VideoIdea): Promise<VideoIdea> {
  const studio = await ensureVideoStudio();
  const assessment = idea.assessmentPath ? await readOptionalFile(idea.assessmentPath) : undefined;
  const started = await startJob({
    worker: "claude-code",
    requestedWorker: "claude-code",
    project: "video-ideas",
    objective: planPrompt(idea, assessment ?? "(The assessment could not be read.)"),
    repoPath: studio,
    extraAllowedTools: READ_TOOLS,
    claudeReadOnlyRoots: readOnlyRoots(),
    timeoutMs: 30 * 60 * 1000,
    agentId: "chief-of-staff",
    constraints: [`Do not edit anything outside ideas/${idea.id}/.`],
    acceptanceCriteria: [`ideas/${idea.id}/plan.json is written.`],
    validationCommands: [`test -s ideas/${idea.id}/plan.json`],
  });
  if (!started.job) {
    return updateIdea(idea.id, { stage: "failed", failedAt: "planning", error: started.error ?? "Claude Code could not be started." });
  }
  return updateIdea(idea.id, {
    stage: "planning",
    error: undefined,
    failedAt: undefined,
    jobId: started.job.id,
    runs: [...idea.runs, { step: "plan", worker: "Claude Code (Max plan)", jobId: started.job.id, startedAt: new Date().toISOString() }],
  });
}

function endRun(idea: VideoIdea, status: string): VideoIdea["runs"] {
  return idea.runs.map((run) => (run.jobId && run.jobId === idea.jobId && !run.endedAt ? { ...run, endedAt: new Date().toISOString(), status } : run));
}

export async function filePlan(idea: VideoIdea, roots: readonly string[], close: typeof closeFiledJob = closeFiledJob): Promise<VideoIdea> {
  const dir = outputDir(roots, idea.id, "plan.json");
  const plan = dir ? parsePlan(await fs.readFile(path.join(dir, "plan.json"), "utf8")) : { error: "The plan was not written." };
  if ("error" in plan) {
    // The run is over either way: it never waits in the review queue.
    await close(idea.jobId);
    return updateIdea(idea.id, { stage: "failed", failedAt: "planning", error: plan.error, runs: endRun(idea, "failed") });
  }

  // Tasks already made by an earlier, interrupted filing are kept, not made twice.
  const taskIds = [...idea.taskIds];
  for (const task of plan.tasks.slice(taskIds.length)) {
    const created = await createTask({ slug: AGENTOS_WORKSPACE, title: task.title, section: "now" });
    taskIds.push(created.taskId);
    updateIdea(idea.id, { taskIds });
  }

  if (idea.assessmentPath) {
    const current = (await readOptionalFile(idea.assessmentPath)) ?? "";
    const section = [
      "## Plan",
      "",
      ...plan.tasks.flatMap((task, index) => [`### ${taskIds[index]} — ${task.title}`, "", task.objective, "", ...task.acceptanceCriteria.map((line) => `- ${line}`), ""]),
    ].join("\n");
    await writeAgentOSFile(idea.assessmentPath, `${current.split("\n## Plan\n")[0].trimEnd()}\n\n${section}`);
  }
  await close(idea.jobId);

  return updateIdea(idea.id, {
    stage: "building",
    error: undefined,
    failedAt: undefined,
    plan: plan.tasks,
    taskIds,
    currentTask: 0,
    jobId: undefined,
    runs: endRun(idea, "completed"),
  });
}
