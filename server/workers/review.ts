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
  previousIssuesFor,
  buildVisualRevisionRequest,
} from "./review-builder";
import { removeMetadataFiles } from "../agentos/metadata-files";
import { markTaskDone } from "./task-done";
import { runValidation } from "./validation";
import { git, uncommittedFiles } from "../agentos/git";
import { createWorkerEvent } from "./worker";
import {
  commitWorktree,
  currentBranch,
  fastForward,
  headCommit,
  projectDirIn,
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
/**
 * Re-runs the validation commands in the source repository for a job whose work
 * has already landed there, and completes the job when they pass.
 *
 * The job was marked failed because the check after landing did not pass. That
 * check can be wrong about the work (a missing install, a flaky build), and the
 * work is already on the branch, so the honest way out is to run it again, not
 * to leave a landed job looking failed or to land it twice.
 */
async function recheckLandedJob(job: WorkerJob): Promise<ActionResult> {
  const source = job.sourceRepoPath!;
  const commands = (job.validationCommands ?? []).filter((command) => command.trim().length > 0);

  await removeMetadataFiles(source);
  await record(job.id, "validation.started", `Re-running ${commands.length} command${commands.length === 1 ? "" : "s"} in the source repository`);

  const outcome = await runValidation(
    commands,
    source,
    (type, message, metadata) => void record(job.id, type, message, metadata),
    new AbortController().signal,
  );

  if (!outcome.passed) {
    const failed = await update(job, { result: { ...(job.result ?? { summary: "" }), tests: outcome.results } });
    return { ok: false, error: "Validation still fails in the source repository.", job: failed };
  }

  const completed = await update(job, {
    status: "completed",
    completedAt: new Date().toISOString(),
    error: undefined,
    result: { ...(job.result ?? { summary: "" }), tests: outcome.results },
  });

  await removeWorktree(source, job.id);
  await record(job.id, "job.completed", "Integrated and validated");
  await settleTask(job);

  return { ok: true, job: completed };
}

export async function validateJob(jobId: string): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };

  if (isRunning(jobId)) {
    return { ok: false, error: "That job is still running." };
  }

  // Work that already landed but failed its check in the source repository:
  // the check is what is re-run, there, and a pass finishes the job.
  if (job.status === "failed" && job.integratedCommit && job.sourceRepoPath) {
    return recheckLandedJob(job);
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
    await projectDirIn(job.worktreePath, job.sourceRepoPath),
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

/**
 * Brings a job's work up to date with its branch, then makes it re-reviewable.
 *
 * The branch moved while the job waited (another job landed). Rebasing is
 * still refused: it rewrites work nobody reviewed. A merge does not: the
 * worker's change stays exactly as reviewed, the branch's newer commits come
 * in beside it, and the combined tree is what gets validated and reviewed
 * again before anything lands. A fast-forward of the result is then possible
 * because it contains the branch's head.
 *
 * A conflict is not resolved here. The merge is abandoned, the checkout is as
 * it was, and the answer is a fresh run on the new base.
 */
/**
 * Merges the source branch's head into a job's checkout, when the branch has
 * moved past the job's base. The worker's edits are committed on its own
 * branch first. A conflict is abandoned, leaving the checkout as it was.
 */
async function mergeBranchHead(
  job: WorkerJob,
): Promise<{ status: "current" } | { status: "merged"; head: string } | { status: "failed"; error: string }> {
  const source = job.sourceRepoPath!;
  const worktree = job.worktreePath!;
  const head = await headCommit(source);
  if (!head) return { status: "failed", error: "The source repository's branch could not be read." };
  // The branch has not moved, or the job already contains its head (a retry built on kept work).
  if (head === job.baseCommit || (job.baseCommit && (await isAncestor(source, head, job.baseCommit)))) return { status: "current" };

  await record(job.id, "job.progress", `Merging the latest ${job.targetBranch ?? "branch"} work (${head.slice(0, 8)}) into this job`);
  await commitWorktree(worktree, `AgentOS: work from ${job.id}, before bringing it up to date`);

  try {
    await git(worktree, ["-c", "user.name=AgentOS", "-c", "user.email=agentos@localhost", "merge", "--no-edit", head]);
    return { status: "merged", head };
  } catch (error) {
    const { stdout } = await git(worktree, ["diff", "--name-only", "--diff-filter=U"]).catch(() => ({ stdout: "" }));
    const conflicts = stdout.split("\n").filter(Boolean);
    await git(worktree, ["merge", "--abort"]).catch(() => undefined);

    const reason = conflicts.length > 0
      ? `The newer work conflicts with this job in ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : ""}. Run the job again on the new base instead.`
      : `The newer work could not be merged: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`;
    await record(job.id, "job.progress", reason);
    return { status: "failed", error: reason };
  }
}

/** An issue's title without the "Still open:" a follow-up adds. */
function issueKey(title: string): string {
  return title.replace(/^(still open:\s*)+/i, "").trim().toLowerCase();
}

/** How many times one finding has been sent back and come back unresolved before it stops being sent. */
export const MAX_SEND_BACKS = 2;

/**
 * Findings that have already been sent back the most times and are still open.
 * Sending them again is the loop that wastes a worker's runs: it has shown it
 * cannot fix them, so a person decides instead.
 */
export function stuckIssues(job: WorkerJob): Set<string> {
  const counts = new Map<string, number>();
  for (const review of [...(job.reviewHistory ?? []), ...(job.review ? [job.review] : [])]) {
    for (const key of new Set(review.issues.map((issue) => issueKey(issue.title)))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Raised once, then still open after each send-back.
  return new Set([...counts].filter(([, count]) => count > MAX_SEND_BACKS).map(([key]) => key));
}

export async function updateJobToLatest(jobId: string): Promise<ActionResult> {
  const job = await readJob(jobId);
  if (!job) return { ok: false, error: "There is no such job." };
  if (isRunning(jobId)) return { ok: false, error: "That job is still running." };

  if (job.status !== "awaiting_review" && job.status !== "changes_required") {
    return { ok: false, error: `Only work waiting for review can be brought up to date. This job is ${job.status}.` };
  }
  if (!job.worktreePath || !job.sourceRepoPath) return { ok: false, error: "That job has no checkout to update." };

  const merged = await mergeBranchHead(job);
  if (merged.status === "current") return { ok: false, error: "This job is already on the branch's latest work." };
  if (merged.status === "failed") return { ok: false, error: merged.error };
  const head = merged.head;

  // The tree changed, so what was reviewed and checked no longer describes it.
  const commands = (job.validationCommands ?? []).filter((command) => command.trim().length > 0);
  const outcome = commands.length > 0
    ? await runValidation(
        commands,
        await projectDirIn(job.worktreePath, job.sourceRepoPath),
        (type, message, metadata) => void record(jobId, type, message, metadata),
        new AbortController().signal,
      )
    : undefined;

  const updated = await update(job, {
    baseCommit: head,
    // Kept in the history: a follow-up review has to know what was already said.
    ...(job.review ? { reviewHistory: [...(job.reviewHistory ?? []), job.review] } : {}),
    review: undefined,
    visualVerification: undefined,
    result: { ...(job.result ?? { summary: "" }), ...(outcome ? { tests: outcome.results } : {}) },
  });

  await record(jobId, "job.progress", `Brought up to date with ${job.targetBranch ?? "the branch"}. ${outcome && !outcome.passed ? "Validation failed on the combined work. " : ""}Review it again before it lands.`);

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

    review = await requestReview(jobId, packet, job.revision, job.project, previousIssuesFor(job));
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

  // The review being replaced is kept when it was of an earlier revision: the
  // next follow-up has to know what was already raised. A re-run of the same
  // revision's review just replaces it.
  const replaced = reviewing.review;
  const history =
    replaced && (replaced.revision ?? 1) < (reviewing.revision ?? 1)
      ? [...(reviewing.reviewHistory ?? []), replaced]
      : reviewing.reviewHistory;

  const next = await update(reviewing, {
    review,
    reviewHistory: history,
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

  const issues = job.review?.issues ?? [];
  const stuck = stuckIssues(job);
  // Only what the worker can fix, and has not already failed to fix twice, goes back.
  const sendable = issues.filter((issue) => issue.fixable !== false && !stuck.has(issueKey(issue.title)));
  const held = issues.filter((issue) => !sendable.includes(issue));

  if (issues.length > 0 && sendable.length === 0) {
    const reasons = held.map((issue) => `${issueKey(issue.title)} (${issue.fixable === false ? "needs something the worker cannot do" : `sent back ${MAX_SEND_BACKS} times and still open`})`);
    return {
      ok: false,
      error: `Sending this back would repeat the same round: ${reasons.join("; ")}. Re-run it with acceptance criteria the worker can meet here, or reject it.`,
    };
  }

  const findings = sendable.map((issue) =>
    [
      `[${issue.severity}] ${issue.title}`,
      issue.file ? `File: ${issue.file}` : undefined,
      issue.detail,
    ]
      .filter(Boolean)
      .join("\n   "),
  );

  // A revision on a base the branch has moved past fixes old code: bring it up to date first.
  let current = job;
  if (job.worktreePath && job.sourceRepoPath) {
    const merged = await mergeBranchHead(job);
    if (merged.status === "failed") return { ok: false, error: merged.error };
    if (merged.status === "merged") {
      current = await update(job, { baseCommit: merged.head });
      await record(jobId, "job.progress", `Brought up to date with ${job.targetBranch ?? "the branch"} before sending it back`);
    }
  }

  if (held.length > 0) {
    await record(jobId, "job.progress", `Not sent back (a person decides these): ${held.map((issue) => issueKey(issue.title)).join("; ")}`);
  }

  const brief = buildRevisionRequest(current, findings);
  const started = await rerunJob(current, brief);

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
 * What AgentOS itself leaves in the source repository, which is no reason to
 * refuse an integration.
 *
 * When the repository is the vault (a workspace whose code lives inside it),
 * the job's own documents are saved under `projects/<slug>/artifacts/` the
 * moment it finishes, before anyone reviews it. Counting them as "uncommitted
 * changes" meant a job could never be approved: it dirtied the repository
 * itself, and stashing them hid the very documents it had just registered.
 * macOS `._*` sidecars are the same: the drive's doing, never the project's.
 *
 * Nothing here weakens the safety it stands in for. The merge is `--ff-only`,
 * and git refuses it outright if it would overwrite any of these files.
 */
export function isAgentOSOwnedChange(file: string, project: string): boolean {
  const name = file.split("/").at(-1) ?? file;
  if (name.startsWith("._") || name === ".DS_Store") return true;
  return file.startsWith(`projects/${project}/artifacts/`) || file.includes(`/projects/${project}/artifacts/`);
}

/**
 * The files an integration would write in the source repository: everything
 * that differs between the source's current commit and the job's checkout,
 * committed or not, new files included. `undefined` when it cannot be read.
 */
async function filesTheJobWrites(job: WorkerJob): Promise<Set<string> | undefined> {
  try {
    const head = await headCommit(job.sourceRepoPath!);
    if (!head) return undefined;

    const { stdout } = await git(job.worktreePath!, ["diff", "--name-only", "-z", head]);
    const tracked = stdout.split("\0").filter(Boolean);
    const untracked = (await uncommittedFiles(job.worktreePath!)).filter((entry) => entry.untracked).map((entry) => entry.path);

    return new Set([...tracked, ...untracked]);
  } catch {
    return undefined;
  }
}

/** The uncommitted paths that do block an integration, or `unreadable` when git cannot say. */
async function blockingChanges(job: WorkerJob): Promise<string[] | "unreadable"> {
  try {
    const files = await uncommittedFiles(job.sourceRepoPath!);
    return files.map((entry) => entry.path).filter((file) => !isAgentOSOwnedChange(file, job.project));
  } catch {
    // A repository that cannot be read is not known to be clean, and this answer gates an integration.
    return "unreadable";
  }
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

  const dirty = await blockingChanges(job);

  if (dirty === "unreadable") {
    blockers.push({ message: "The source repository could not be read, so it is not known to be clean." });
  } else if (dirty.length > 0) {
    const touched = await filesTheJobWrites(job);

    if (!touched) {
      // The job's checkout cannot be read, so which files it would write is
      // not known, and every uncommitted file has to count.
      const named = dirty.slice(0, 5).join(", ");
      blockers.push({
        message: `The source repository has uncommitted changes (${named}${dirty.length > 5 ? ` and ${dirty.length - 5} more` : ""}). Commit or stash them first.`,
        cure: { kind: "stash" },
      });
    } else {
      // Uncommitted work in files the job does not touch is no obstacle: the
      // fast-forward leaves it exactly where it is. Only a file both sides
      // changed is a problem, and git would refuse to overwrite it.
      const overlap = dirty.filter((file) => touched.has(file));

      if (overlap.length > 0) {
        const named = overlap.slice(0, 5).join(", ");
        blockers.push({
          message: `You have uncommitted changes in files this work also changes (${named}${overlap.length > 5 ? ` and ${overlap.length - 5} more` : ""}). Applying it would overwrite them.`,
          cure: { kind: "apply-around" },
        });
      }
    }
  }

  const head = await headCommit(job.sourceRepoPath);

  if (job.baseCommit && head !== job.baseCommit && !(await isAncestor(job.sourceRepoPath, head, job.baseCommit))) {
    // The reviewed tree and the integrated tree would no longer be the same
    // thing. Rebasing would produce code nobody reviewed, so it is refused
    // rather than resolved.
    blockers.push({
      message: `${job.targetBranch ?? "The branch"} has advanced since this job started. The reviewed work can no longer be fast-forwarded, and rebasing it would produce a result nobody reviewed.`,
      // Merging the newer work in and checking it again produces a tree that
      // can be reviewed against what is there now; running the job from
      // scratch is the fallback when the merge conflicts.
      cure: { kind: "update" },
    });
  }

  return blockers;
}

/**
 * Whether `ancestor` is in `commit`'s history.
 *
 * A retry that continues a dead attempt starts from that attempt's saved work,
 * which sits ahead of the branch rather than on it. The branch has not moved,
 * the fast-forward still lands exactly the reviewed tree, so it is no blocker.
 */
async function isAncestor(repoPath: string, ancestor: string | undefined, commit: string): Promise<boolean> {
  if (!ancestor) return false;
  try {
    await git(repoPath, ["merge-base", "--is-ancestor", ancestor, commit]);
    return true;
  } catch {
    return false;
  }
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
  // A file-bridge reply is text too: Grok Bot hands back an answer, not a checkout.
  return !job.worktreePath && (Boolean(job.routing?.policy) || Boolean(job.bridge)) && Boolean(job.result);
}

/**
 * Whether a text result may be approved. A routed job must show a last
 * attempt that succeeded and was not failed by validation. A file-bridge job
 * (Grok Bot) finished before bridge attempts were recorded has none at all:
 * its result was checked against the schema when it was imported, so an
 * imported, non-empty answer is enough. A failed Grok answer never gets here,
 * because it fails the job instead of putting it up for review.
 */
export function textResultApprovable(job: WorkerJob): { ok: true } | { ok: false; error: string } {
  if (!job.result?.summary?.trim()) {
    return { ok: false, error: "The result is empty, so there is nothing to approve." };
  }
  const last = job.attempts?.at(-1);
  const importedBridgeAnswer = !last && Boolean(job.bridge?.importedAt);

  if (!importedBridgeAnswer && (last?.outcome !== "succeeded" || last.validation?.passed === false)) {
    return { ok: false, error: "The last attempt did not produce a validated result, so there is nothing to approve." };
  }
  return { ok: true };
}

/**
 * Starts the next task waiting on this job, now that it has landed. Imported
 * when needed: the queue starts jobs, and jobs import this module.
 */
/**
 * What follows a job landing: its task is marked done, then the next queued
 * task starts. In that order, so a task that waits on this one sees it done.
 */
async function settleTask(job: WorkerJob): Promise<void> {
  const done = await markTaskDone(job);
  if (done.marked) await record(job.id, "job.progress", `Marked ${done.taskId} done`);
  else if (done.error) await record(job.id, "job.progress", `Could not mark the task done: ${done.error}`);

  await releaseQueuedTask(job);
}

async function releaseQueuedTask(job: WorkerJob): Promise<void> {
  try {
    const { releaseNextTask } = await import("../agentos/milestone-queue");
    const next = await releaseNextTask(job.project, job.id);
    if (next) await record(job.id, "job.progress", `Started the next queued task, ${next.taskId}`);
  } catch (error) {
    console.error("[agentos] could not release the next queued task:", error);
  }
}

async function approveTextResult(job: WorkerJob): Promise<ActionResult> {
  const approvable = textResultApprovable(job);
  if (!approvable.ok) return approvable;

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

  await settleTask(job);

  return { ok: true, job: completed };
}

export async function approveJob(
  jobId: string,
  options: { aroundLocalChanges?: boolean } = {},
): Promise<ActionResult> {
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

  // "Apply around my changes" is the operator's answer to the one blocker it
  // names, so that blocker is the only one it clears.
  const blockers = (await integrationBlockerDetails(job))
    .filter((entry) => !(options.aroundLocalChanges && entry.cure?.kind === "apply-around"))
    .map((entry) => entry.message);

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

  return integrate(approved, Boolean(options.aroundLocalChanges));
}

/**
 * Sets the operator's own uncommitted edits aside for the length of one
 * fast-forward: only the files the job also writes, stashed with their
 * untracked siblings. Nothing is discarded; `restoreSetAside` puts them back.
 */
async function setAsideOverlap(job: WorkerJob, source: string): Promise<boolean> {
  const dirty = await blockingChanges(job);
  const touched = await filesTheJobWrites(job);
  if (dirty === "unreadable" || !touched) return false;

  const overlap = dirty.filter((file) => touched.has(file));
  if (overlap.length === 0) return false;

  await git(source, ["stash", "push", "-u", "-m", `AgentOS: set aside for ${job.id}`, "--", ...overlap]);
  await record(job.id, "integration.started", `Set aside your edits to ${overlap.length} file${overlap.length === 1 ? "" : "s"} while this lands`);
  return true;
}

/**
 * Puts the set-aside edits back. A clean pop is the normal case. When both
 * sides changed the same lines git stops with conflict markers in the file and
 * keeps the stash, so the edits are still recoverable either way.
 */
async function restoreSetAside(job: WorkerJob, source: string): Promise<void> {
  try {
    await git(source, ["stash", "pop"]);
    await record(job.id, "integration.completed", "Put your edits back on top of the landed work");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message =
      "Your edits conflict with the work that just landed. Conflict markers are in the files and your edits are kept in `git stash`. Resolve the markers, then `git stash drop`.";

    await record(job.id, "integration.completed", `${message} (${detail.split("\n")[0]})`);
    await recordActivity({
      type: "worker.integration.failed",
      description: message,
      project: job.project,
      metadata: { jobId: job.id },
    });
  }
}

/**
 * Carries approved work onto the real branch.
 *
 * The commit is made here rather than by the worker — workers are denied
 * `git commit` outright — and the merge is `--ff-only`, so the tree that lands
 * is bit-for-bit the tree that was reviewed. Git refuses rather than resolving
 * anything, which is the property that makes this safe to automate.
 */
async function integrate(job: WorkerJob, aroundLocalChanges = false): Promise<ActionResult> {
  const source = job.sourceRepoPath!;
  const branch = job.workerBranch!;

  const integrating = await update(job, { status: "integrating" });

  await record(job.id, "integration.started", `Fast-forwarding ${job.targetBranch}`);

  let commit: string;
  let setAside = false;

  try {
    commit = await commitWorktree(
      job.worktreePath!,
      `worker: ${job.objective.split("\n")[0].slice(0, 72)}`,
    );

    if (aroundLocalChanges) setAside = await setAsideOverlap(job, source);

    await fastForward(source, branch);
  } catch (error) {
    // The operator's changes go back whatever happened to the integration.
    if (setAside) await restoreSetAside(job, source);

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

  if (setAside) await restoreSetAside(job, source);

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
    // An exFAT or network drive gets a `._name` sidecar beside every file macOS
    // writes, and linters and test runners read those as source. They hold
    // nothing the project needs, and they are not part of what was reviewed.
    const sidecars = await removeMetadataFiles(source);
    if (sidecars > 0) {
      await record(job.id, "validation.started", `Removed ${sidecars} macOS ._ sidecar file${sidecars === 1 ? "" : "s"} before validating`);
    }

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

  await settleTask(job);

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
