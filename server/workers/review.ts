import type { IntegrationBlocker } from "../../shared/worker-types";
import type {
  WorkerDiff,
  WorkerEventType,
  WorkerJob,
  WorkerReview,
} from "../../shared/worker-types";
import { recordActivity } from "../activity/ui-events";
import { requestReview } from "../hermes/worker-review";
import { readDiff } from "./diff";
import { isRunning, rerunJob } from "./job-manager";
import { appendEvent, readJob, saveJob } from "./job-store";
import {
  buildReviewPacket,
  buildRevisionRequest,
  buildVisualRevisionRequest,
} from "./review-builder";
import { runValidation } from "./validation";
import { createWorkerEvent } from "./worker";
import {
  commitWorktree,
  currentBranch,
  fastForward,
  headCommit,
  isClean,
  removeWorktree,
} from "./worktree";

/**
 * Review, approval, and integration.
 *
 * This is where a finished job becomes, or fails to become, part of the real
 * repository. The order is fixed and every step is separate on purpose:
 *
 *     worker implements → AgentOS validates → Hermes reviews
 *       → a person approves → AgentOS integrates → AgentOS validates again
 *
 * No step may stand in for another. Hermes passing is not approval. Approval is
 * not integration. Validation passing is not a review. The value of the
 * arrangement comes entirely from those being different events with different
 * actors, so nothing here collapses them for convenience.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  job?: WorkerJob;
}

/** Records one event on a job that is not currently streaming. */
async function record(
  jobId: string,
  type: WorkerEventType,
  message?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await appendEvent(createWorkerEvent(jobId, type, message, metadata));
}

async function update(
  job: WorkerJob,
  changes: Partial<WorkerJob>,
): Promise<WorkerJob> {
  const next = { ...job, ...changes };
  await saveJob(next);
  return next;
}

/** Whether AgentOS's own validation of this job passed. */
/**
 * Whether validation ran, and what it said.
 *
 * The distinction matters more than it looks. `validationPassed` is false both
 * when a command failed and when no command was ever run, and for a long time
 * both produced the sentence "AgentOS' validation did not pass" — which is
 * true of a failure and a lie about a job where nothing was verified at all.
 * An operator reading it went looking for a failure that did not exist.
 */
function validationState(job: WorkerJob): {
  ran: boolean;
  passed: boolean;
  failed: string[];
} {
  const tests = job.result?.tests ?? [];

  return {
    ran: tests.length > 0,
    passed: tests.length > 0 && tests.every((test) => test.success),
    failed: tests.filter((test) => !test.success).map((test) => test.command),
  };
}

/** The diff a review and an operator both look at. */
export async function getJobDiff(
  jobId: string,
): Promise<WorkerDiff | undefined> {
  const job = await readJob(jobId);
  if (!job?.worktreePath) return undefined;

  return readDiff(jobId, job.worktreePath, job.baseCommit);
}

/**
 * Has Hermes review the work.
 *
 * The review is independent in the sense that matters: it reads the diff from
 * git and the validation results from AgentOS, not the worker's account of
 * either. A worker cannot influence what its reviewer sees.
 *
 * Note what this does not do on a pass: it does not approve anything. The job
 * returns to `awaiting_review`, now carrying a verdict, and waits for a person.
 */
/**
 * Runs the job's validation commands again, in its own worktree.
 *
 * The blocker "validation did not pass" used to be the end of the
 * conversation: it named no command, showed no output, and offered no way to
 * try again. An operator had to find the worktree themselves to learn what
 * had failed. This runs the same commands the job was given, in the same
 * place, and records the results on the job — so the next read of the blocker
 * either clears it or says which command is still failing.
 *
 * It is deliberately only available once a job has stopped: running commands
 * in a worktree a worker is still writing to would report on a tree that no
 * longer exists by the time anyone reads it.
 */
export async function validateJob(jobId: string): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (isRunning(jobId)) {
    return { ok: false, error: "That job is still running." };
  }

  if (!job.worktreePath) {
    return { ok: false, error: "That job has no checkout to validate." };
  }

  const commands = (job.validationCommands ?? []).filter(
    (command) => command.trim().length > 0,
  );

  if (commands.length === 0) {
    return {
      ok: false,
      error:
        "This job has no validation commands. Add them under Validation in the project's Configuration.",
    };
  }

  await record(jobId, "validation.started", `Re-running ${commands.length} command${commands.length === 1 ? "" : "s"}`);

  const outcome = await runValidation(
    commands,
    job.worktreePath,
    (type, message, metadata) => void record(jobId, type, message, metadata),
    // Not cancellable from here: these are the operator's own commands, run
    // deliberately, and a half-run validation is worse than a slow one.
    new AbortController().signal,
  );

  const updated = await update(job, {
    result: { ...(job.result ?? { summary: "" }), tests: outcome.results },
  });

  return { ok: true, job: updated };
}

export async function reviewJob(jobId: string): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (isRunning(jobId)) {
    return { ok: false, error: "That job is still running." };
  }

  if (job.status !== "awaiting_review" && job.status !== "changes_required") {
    return {
      ok: false,
      error: `A job is reviewed once it is waiting for review. This one is ${job.status}.`,
    };
  }

  if (!job.worktreePath) {
    return { ok: false, error: "That job has no worktree to review." };
  }

  const reviewing = await update(job, { status: "reviewing" });

  await record(jobId, "review.started", "Hermes is reviewing the work");
  await recordActivity({
    type: "worker.review.started",
    description: job.objective,
    project: job.project,
    metadata: { jobId, revision: job.revision ?? 1 },
  });

  let review: WorkerReview;

  try {
    const diff = await readDiff(jobId, job.worktreePath, job.baseCommit);
    const packet = buildReviewPacket(reviewing, diff);

    review = await requestReview(jobId, packet, job.revision, job.project);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The review could not be run.";

    // A review that did not happen leaves the job exactly where it was. It is
    // emphatically not recorded as having passed.
    await update(reviewing, { status: "awaiting_review" });
    await record(jobId, "review.completed", `Review failed: ${detail}`);

    return { ok: false, error: detail };
  }

  const passed = review.verdict === "pass";

  const next = await update(reviewing, {
    review,
    // A pass returns the job to where it was: waiting, now on a person.
    status: passed ? "awaiting_review" : "changes_required",
  });

  await record(
    jobId,
    "review.completed",
    `Hermes: ${review.verdict.replace(/_/g, " ")}. ${review.summary}`,
    { verdict: review.verdict, issues: review.issues.length },
  );

  await recordActivity({
    type:
      review.verdict === "pass"
        ? "worker.review.passed"
        : review.verdict === "blocked"
          ? "worker.review.blocked"
          : "worker.review.changes",
    description: review.summary,
    project: job.project,
    metadata: { jobId, verdict: review.verdict, issues: review.issues.length },
  });

  return { ok: true, job: next };
}

/**
 * Sends the review's findings back to the worker.
 *
 * The same worktree, so the worker continues from the work being criticised
 * rather than starting again — and so what gets re-reviewed is the same body of
 * work, one revision on.
 */
export async function requestRevision(jobId: string): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (job.status !== "changes_required") {
    return {
      ok: false,
      error: "Only a job with review findings can be sent back.",
    };
  }

  const findings = (job.review?.issues ?? []).map((issue) =>
    [
      `[${issue.severity}] ${issue.title}`,
      issue.file ? `File: ${issue.file}` : undefined,
      issue.detail,
    ]
      .filter(Boolean)
      .join("\n   "),
  );

  if (findings.length === 0) {
    // Nothing actionable to send. Asking a worker to fix unspecified problems
    // is how scope quietly expands.
    return {
      ok: false,
      error:
        "The review recorded no specific findings, so there is nothing to send back. Read its reply and decide yourself.",
    };
  }

  const brief = buildRevisionRequest(job, findings);
  const started = await rerunJob(job, brief);

  if (!started.ok) return { ok: false, error: started.error };

  await record(jobId, "revision.requested", `Revision ${(job.revision ?? 1) + 1} requested`, {
    findings: findings.length,
  });

  await recordActivity({
    type: "worker.revision.requested",
    description: `${findings.length} finding${findings.length === 1 ? "" : "s"}: ${job.objective}`,
    project: job.project,
    metadata: { jobId, revision: (job.revision ?? 1) + 1 },
  });

  return { ok: true, job: await readJob(jobId) };
}

/**
 * Sends the *visual* findings back to the worker.
 *
 * Deliberately a separate action from `requestRevision`, not a flag on it. The
 * two send different briefs to answer different criticisms, and an operator
 * choosing between them is choosing what they are asking the worker to fix.
 *
 * Like a code revision, this reuses the same worktree — and everything
 * afterwards is the ordinary pipeline, which means the revision is validated,
 * run, photographed and reviewed again. Nothing here takes a worker's word
 * that it fixed anything.
 */
export async function requestVisualRevision(
  jobId: string,
): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (isRunning(jobId)) {
    return { ok: false, error: "That job is still running." };
  }

  if (job.status !== "changes_required" && job.status !== "awaiting_review") {
    return {
      ok: false,
      error: `Only settled work can be sent back. This job is ${job.status}.`,
    };
  }

  const issues = job.visualVerification?.issues ?? [];

  if (issues.length === 0) {
    // Nothing actionable to send. Asking a worker to fix a look nobody
    // described is how a redesign starts.
    return {
      ok: false,
      error:
        job.visualVerification?.verdict === "unverifiable"
          ? "The implementation could not be verified visually, so there are no findings to send back. Fix what stopped the verification and run it again."
          : "The visual review recorded no specific findings, so there is nothing to send back.",
    };
  }

  const started = await rerunJob(job, buildVisualRevisionRequest(job, issues));

  if (!started.ok) return { ok: false, error: started.error };

  await record(
    jobId,
    "revision.requested",
    `Visual revision ${(job.revision ?? 1) + 1} requested`,
    { findings: issues.length, kind: "visual" },
  );

  await recordActivity({
    type: "worker.visual.revision.requested",
    description: `${issues.length} visual finding${issues.length === 1 ? "" : "s"}: ${job.objective}`,
    project: job.project,
    metadata: { jobId, revision: (job.revision ?? 1) + 1 },
  });

  return { ok: true, job: await readJob(jobId) };
}

/**
 * Everything that must be true before reviewed work touches the real branch.
 *
 * Returns the reasons it must not, so the console can say exactly which
 * condition failed rather than refusing in general terms. An empty list is the
 * only thing that permits an integration.
 */
export async function integrationBlockers(job: WorkerJob): Promise<string[]> {
  return (await integrationBlockerDetails(job)).map((entry) => entry.message);
}

/**
 * The same blockers, each carrying what would resolve it.
 *
 * The cure is decided here rather than in React, because deciding it there
 * would mean matching on English prose — and a reworded sentence would
 * silently remove a button. What the console gets is a `cure` it can render
 * or not.
 *
 * Three of the five have a safe cure. The fourth — a base that has moved —
 * deliberately has none: rebasing the reviewed tree onto a new base produces
 * code nobody reviewed, so the cure offered is to run the job again on the
 * new base, and the panel says why. The fifth, a failed review, is Hermes'
 * job to redo.
 */
export async function integrationBlockerDetails(
  job: WorkerJob,
): Promise<IntegrationBlocker[]> {
  const blockers: IntegrationBlocker[] = [];

  if (!job.worktreePath || !job.workerBranch || !job.sourceRepoPath) {
    blockers.push({ message: "This job has no isolated checkout to integrate." });
    return blockers;
  }

  if (job.review?.verdict !== "pass") {
    blockers.push({
      message: job.review
        ? `Hermes' verdict is ${job.review.verdict.replace(/_/g, " ")}, not pass.`
        : "This job has not been reviewed yet.",
      cure: { kind: "review" },
    });
  }

  const validation = validationState(job);

  if (!validation.passed) {
    blockers.push({
      message: validation.ran
        ? `AgentOS' validation did not pass: ${validation.failed.join(", ")} failed.`
        : (job.validationCommands ?? []).length > 0
          ? "AgentOS' validation has not been run."
          : "Nothing was verified: this job had no validation commands.",
      // Only offer to run it when there is something to run. A job with no
      // commands needs them configured, which is a different screen.
      cure:
        (job.validationCommands ?? []).length > 0
          ? { kind: "validate" }
          : undefined,
    });
  }

  // A job that asked to be looked at is not approvable on a code review alone.
  // This is the condition that stops "never fake a pass" from being advice: an
  // unverifiable visual check blocks integration exactly as a failed one does.
  if (job.visualAcceptance?.enabled) {
    const visual = job.visualVerification;

    if (!visual) {
      blockers.push({
        message:
          "This job asked for visual verification and has not been verified visually yet.",
      });
    } else if (visual.verdict !== "pass") {
      blockers.push({
        message:
          visual.verdict === "unverifiable"
            ? `The implementation could not be verified visually. ${visual.unverifiableReason ?? visual.summary}`
            : "Visual verification asked for changes, so this does not match the approved design direction.",
      });
    }
  }

  const branch = await currentBranch(job.sourceRepoPath);

  if (!branch) {
    blockers.push({ message: "The source repository is not on a branch." });
  } else if (job.targetBranch && branch !== job.targetBranch) {
    blockers.push({
      message: `The source repository is on ${branch}, but this work was branched from ${job.targetBranch}.`,
      cure: { kind: "switch", branch: job.targetBranch },
    });
  }

  if (!(await isClean(job.sourceRepoPath))) {
    blockers.push({
      message:
        "The source repository has uncommitted changes. Commit or stash them first.",
      cure: { kind: "stash" },
    });
  }

  const head = await headCommit(job.sourceRepoPath);

  if (job.baseCommit && head !== job.baseCommit) {
    // The reviewed tree and the integrated tree would no longer be the same
    // thing. Rebasing would produce code nobody reviewed, so it is refused
    // rather than resolved.
    blockers.push({
      message: `${job.targetBranch ?? "The branch"} has advanced since this job started. The reviewed work can no longer be fast-forwarded, and rebasing it would produce a result nobody reviewed.`,
      // No safe cure exists. Running the job again on the new base produces
      // work that can actually be reviewed against what is there now.
      cure: { kind: "retry" },
    });
  }

  return blockers;
}

/**
 * Approves the work and integrates it.
 *
 * Approval is a person's act, which is why this is only ever reached from an
 * explicit request. Everything after it is deterministic: commit what was
 * reviewed, fast-forward it on, and check the result in the real repository.
 */
/**
 * A policy-routed job that produced text rather than a checkout.
 *
 * Hermes' diff review does not apply (there is no diff), and it is not run
 * here: sending a local-only task's output to a reviewing model would defeat
 * the point of keeping it local. Task rules were already checked when the run
 * finished; what remains is the person.
 */
function isTextResult(job: WorkerJob): boolean {
  return !job.worktreePath && Boolean(job.routing?.policy) && Boolean(job.result);
}

async function approveTextResult(job: WorkerJob): Promise<ActionResult> {
  const last = job.attempts?.at(-1);

  if (last?.outcome !== "succeeded" || last.validation?.passed === false) {
    return { ok: false, error: "The last attempt did not produce a validated result, so there is nothing to approve." };
  }

  if (!job.result?.summary?.trim()) {
    return { ok: false, error: "The result is empty, so there is nothing to approve." };
  }

  const now = new Date().toISOString();
  const completed = await update(job, { status: "completed", approvedAt: now, completedAt: now });

  await record(job.id, "job.approved", "Approved by the operator (text result, read by a person)");
  await record(job.id, "job.completed", "Completed. No checkout to integrate.");
  await recordActivity({
    type: "worker.approved",
    description: job.objective,
    project: job.project,
    metadata: { jobId: job.id, text: true },
  });

  return { ok: true, job: completed };
}

export async function approveJob(jobId: string): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (isRunning(jobId)) {
    return { ok: false, error: "That job is still running." };
  }

  if (job.status !== "awaiting_review") {
    return {
      ok: false,
      error: `Only work waiting for review can be approved. This job is ${job.status}.`,
    };
  }

  // A text result (a summary, an extraction) has no checkout to integrate. The
  // review is the person reading it; there is nothing to fast-forward.
  if (isTextResult(job)) return approveTextResult(job);

  const blockers = await integrationBlockers(job);

  if (blockers.length > 0) {
    return { ok: false, error: blockers.join(" ") };
  }

  const approved = await update(job, {
    status: "approved",
    approvedAt: new Date().toISOString(),
  });

  await record(jobId, "job.approved", "Approved by the operator");
  await recordActivity({
    type: "worker.approved",
    description: job.objective,
    project: job.project,
    metadata: { jobId },
  });

  return integrate(approved);
}

/**
 * Carries approved work onto the real branch.
 *
 * The commit is made here rather than by the worker — workers are denied
 * `git commit` outright — and the merge is `--ff-only`, so the tree that lands
 * is bit-for-bit the tree that was reviewed. Git refuses rather than resolving
 * anything, which is the property that makes this safe to automate.
 */
async function integrate(job: WorkerJob): Promise<ActionResult> {
  const source = job.sourceRepoPath!;
  const branch = job.workerBranch!;

  const integrating = await update(job, { status: "integrating" });

  await record(job.id, "integration.started", `Fast-forwarding ${job.targetBranch}`);

  let commit: string;

  try {
    commit = await commitWorktree(
      job.worktreePath!,
      `worker: ${job.objective.split("\n")[0].slice(0, 72)}`,
    );

    await fastForward(source, branch);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The work could not be integrated.";

    // The worktree is deliberately left alone: whatever went wrong, the work
    // itself is still there to look at.
    const failed = await update(integrating, {
      status: "awaiting_review",
      error: detail,
    });

    await record(job.id, "integration.completed", `Integration failed: ${detail}`);
    await recordActivity({
      type: "worker.integration.failed",
      description: detail,
      project: job.project,
      metadata: { jobId: job.id },
    });

    return { ok: false, error: detail, job: failed };
  }

  const integratedCommit = (await headCommit(source)) ?? commit;

  await record(job.id, "integration.completed", `Integrated as ${integratedCommit.slice(0, 8)}`);
  await recordActivity({
    type: "worker.integrated",
    description: `${job.objective} (${integratedCommit.slice(0, 8)})`,
    project: job.project,
    metadata: { jobId: job.id, commit: integratedCommit },
  });

  // The same commands, now against the real repository. Work that passed in a
  // worktree can still break the branch it lands on, and finding that out is
  // the entire reason this runs a second time.
  const commands = (job.validationCommands ?? []).filter(
    (command) => command.trim().length > 0,
  );

  let sourceTests = integrating.result?.tests ?? [];
  let sourcePassed = true;

  if (commands.length > 0) {
    const controller = new AbortController();

    const outcome = await runValidation(
      commands,
      source,
      (type, message, metadata) =>
        void record(job.id, type, message, metadata),
      controller.signal,
    );

    sourceTests = outcome.results;
    sourcePassed = outcome.passed;
  }

  if (!sourcePassed) {
    // Integrated, but the branch is not well. Said plainly, and nothing is
    // cleaned up, because the operator now has a decision to make.
    const failed = await update(integrating, {
      status: "failed",
      completedAt: new Date().toISOString(),
      integratedCommit,
      error:
        "The work was integrated, but validation failed in the source repository afterwards.",
      result: { ...integrating.result!, tests: sourceTests },
    });

    await recordActivity({
      type: "worker.failed",
      description: `Validation failed after integrating ${job.objective}`,
      project: job.project,
      metadata: { jobId: job.id, commit: integratedCommit },
    });

    return { ok: false, error: failed.error, job: failed };
  }

  // Only now — integrated and re-validated — is the job actually over.
  const completed = await update(integrating, {
    status: "completed",
    completedAt: new Date().toISOString(),
    integratedCommit,
    error: undefined,
    result: { ...integrating.result!, tests: sourceTests },
  });

  await removeWorktree(source, job.id);
  await record(job.id, "job.completed", "Integrated and validated");

  // Filed under AgentOS, not the worker: the worker's part ended long before
  // this, and a timeline that credited the integration to it would blur the
  // separation the whole design rests on.
  await recordActivity({
    type: "worker.validated",
    description: `${job.objective}. Validated in ${job.targetBranch ?? "the source repository"}`,
    project: job.project,
    metadata: { jobId: job.id, commit: integratedCommit },
  });

  return { ok: true, job: completed };
}

/**
 * Turns work down.
 *
 * Nothing is deleted. A rejected job keeps its record, its events, its review
 * and its worktree, because "this is not what I wanted" and "destroy this" are
 * different decisions and only one of them was made.
 */
export async function rejectJob(
  jobId: string,
  reason?: string,
): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (isRunning(jobId)) {
    return { ok: false, error: "That job is still running." };
  }

  if (job.status === "completed" || job.status === "rejected") {
    return { ok: false, error: `That job is already ${job.status}.` };
  }

  const next = await update(job, {
    status: "rejected",
    completedAt: new Date().toISOString(),
    error: reason?.trim() || undefined,
  });

  await record(jobId, "job.rejected", reason?.trim() || "Rejected by the operator");
  await recordActivity({
    type: "worker.rejected",
    description: reason?.trim() ? `${job.objective}: ${reason.trim()}` : job.objective,
    project: job.project,
    metadata: { jobId },
  });

  return { ok: true, job: next };
}

/**
 * Throws away a job's checkout, once someone says so.
 *
 * Separate from rejecting, and only available after a job has settled: the
 * worktree is the evidence, and discarding it is its own decision.
 */
export async function discardWorktree(jobId: string): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (isRunning(jobId)) {
    return { ok: false, error: "That job is still running." };
  }

  const discardable = ["rejected", "failed", "cancelled"];

  if (!discardable.includes(job.status)) {
    return {
      ok: false,
      error: `Work waiting for review is not discarded by accident. This job is ${job.status}.`,
    };
  }

  if (!job.worktreePath || !job.sourceRepoPath) {
    return { ok: false, error: "That job has no worktree to discard." };
  }

  await removeWorktree(job.sourceRepoPath, jobId);

  const next = await update(job, { worktreePath: undefined });

  await record(jobId, "job.progress", "Worktree discarded");

  return { ok: true, job: next };
}
