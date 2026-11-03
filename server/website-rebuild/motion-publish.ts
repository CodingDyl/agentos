import fs from "node:fs/promises";
import type { MotionRun } from "../../shared/motion-design-types";
import type { RebuildRun } from "../../shared/website-rebuild-types";
import type { WorkerJob } from "../../shared/worker-types";
import { git } from "../agentos/git";
import { currentAttempt } from "../motion-design/progress";
import { runForWorkspace as motionForWorkspace } from "../motion-design/store";
import { approvedCommit } from "./stages";
import { readRun, RebuildError, reopenPreview, setRunField } from "./store";
import { integrateJob } from "./workers";

/**
 * Puts a finished motion pass on the client's preview: the motion job's work
 * becomes one tagged commit in the client repo, on top of the approved site,
 * and the preview stage publishes it as it would any approved revision.
 */

export interface MotionPublishDeps {
  motionRunFor: (slug: string) => Promise<MotionRun | undefined>;
  latestJob: (run: MotionRun) => Promise<WorkerJob | undefined>;
  integrate: (job: WorkerJob, repo: string, message: string, tag: string) => Promise<string>;
  /** Whether `ancestor` is in the history of `commit` in `repo`. */
  isAncestor: (repo: string, ancestor: string, commit: string) => Promise<boolean>;
  advance: (runId: string) => void;
}

export const defaultMotionPublishDeps: Omit<MotionPublishDeps, "advance"> = {
  motionRunFor: motionForWorkspace,
  latestJob: currentAttempt,
  integrate: integrateJob,
  isAncestor: async (repo, ancestor, commit) => {
    try {
      await git(repo, ["merge-base", "--is-ancestor", ancestor, commit]);
      return true;
    } catch {
      return false;
    }
  },
};

const same = async (a: string, b: string) => (await fs.realpath(a).catch(() => a)) === (await fs.realpath(b).catch(() => b));

/** Why this run's motion pass cannot be published now, or the job to publish. */
export async function publishableMotion(run: RebuildRun, deps: Pick<MotionPublishDeps, "motionRunFor" | "latestJob">): Promise<{ motion: MotionRun; job: WorkerJob }> {
  if (!run.workspaceSlug) throw new RebuildError("This rebuild has no workspace yet.");
  const preview = run.stages.find((stage) => stage.id === "preview");
  if (preview?.status !== "complete" && preview?.status !== "blocked") throw new RebuildError("Publish the rebuild's preview first; motion goes on top of it.");
  const motion = await deps.motionRunFor(run.workspaceSlug);
  if (!motion?.enhanceExisting) throw new RebuildError("This workspace has no motion pass to publish.", 404);
  const job = await deps.latestJob(motion);
  if (!job) throw new RebuildError("The motion pass has not started a build yet.");
  if (job.integratedCommit) return { motion, job };
  if (job.status !== "awaiting_review") throw new RebuildError(`The motion pass is ${job.status.replace(/_/g, " ")}. Publish it once its build has finished.`);
  const failed = (job.result?.tests ?? []).filter((test) => !test.success).map((test) => test.command);
  if (failed.length > 0) throw new RebuildError(`The motion pass did not pass ${failed.join(", ")}. Send it notes to fix that first.`);
  return { motion, job };
}

export async function publishMotionPass(runId: string, deps: MotionPublishDeps): Promise<RebuildRun> {
  const run = readRun(runId);
  const approved = approvedCommit(run);
  if (!approved) throw new RebuildError("There is no approved site to add the motion pass to.");
  if (!run.repoPath) throw new RebuildError("The client repository is missing for this rebuild.");
  const { motion, job } = await publishableMotion(run, deps);
  if (!motion.siteRepoPath || !(await same(motion.siteRepoPath, run.repoPath))) throw new RebuildError("The motion pass was built in another repository, so it cannot go on this preview.");

  const commit = job.integratedCommit ?? (await deps.integrate(job, run.repoPath, "Motion pass", `rebuild/motion-${job.id}`));
  // Built on anything but the approved site, it would publish work nobody approved.
  if (!(await deps.isAncestor(run.repoPath, approved, commit))) throw new RebuildError("The motion pass is not built on the approved site, so it was not published. Start a new motion pass from the current site.");
  setRunField(run.id, "motion_ref", commit);
  setRunField(run.id, "motion_base", approved);
  reopenPreview(run.id, `Publishing the motion pass ${commit.slice(0, 7)} to the preview.`);
  deps.advance(run.id);
  return readRun(run.id);
}
