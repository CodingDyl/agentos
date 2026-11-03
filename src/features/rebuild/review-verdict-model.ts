import type { RebuildRun, RebuildStage, ReviewVerdict } from "@shared/website-rebuild-types";

/** The reviewer's verdict on the revision under review, when a second opinion ran. */
export function revisionVerdict(run: RebuildRun, stage: RebuildStage): ReviewVerdict | undefined {
  return run.revisions.find((revision) => revision.stage === stage.id && revision.revision === stage.revision)?.review;
}

/** Whether approving needs the person to say they are overriding the reviewer. */
export const needsOverride = (verdict: ReviewVerdict | undefined) => Boolean(verdict && verdict.blockers > 0);
