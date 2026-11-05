import type { MotionRunView } from "@shared/motion-design-types";
import { previewCommit, type RebuildRun } from "@shared/website-rebuild-types";

/**
 * What the Motion pass card offers. A job stays publishable after it lands, so
 * the check is whether this job's work is the one on the preview, not whether
 * some motion pass is. A commit-less job has not landed, so it is always newer.
 */
export function motionPassState(
  run: Pick<RebuildRun, "stages" | "revisions" | "motionRef" | "motionBase">,
  motion: Pick<MotionRunView, "enhanceExisting" | "job"> | null | undefined,
): { published: boolean; canPublish: boolean } {
  // The preview carries the motion pass only while it was built on the commit still approved.
  const published = Boolean(run.motionRef && previewCommit(run) === run.motionRef);
  const job = motion?.enhanceExisting ? motion.job : undefined;
  const finished = job?.status === "awaiting_review" || (job?.status === "completed" && Boolean(job.integratedCommit));
  const alreadyLive = published && job?.integratedCommit === run.motionRef;
  return { published, canPublish: finished && !alreadyLive };
}
