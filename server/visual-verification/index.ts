import path from "node:path";
import type { VisualVerificationResult } from "../../shared/visual-verification-types";
import type { WorkerJob } from "../../shared/worker-types";
import type { EmitWorkerEvent } from "../workers/worker";
import { captureRoutes } from "./capture";
import { startPreview } from "./preview";
import { buildVisualContext, type VisualContext } from "./references";
import { revisionDir, saveScreenshot, saveVerification } from "./storage";
import {
  buildVisualReviewPacket,
  requestVisualVerification,
} from "./verifier";

/**
 * Visual verification, end to end.
 *
 * Run the implementation, photograph it, and ask Hermes whether it looks like
 * what was designed:
 *
 *     worktree → preview → screenshots → Hermes → verdict
 *
 * Every step can fail, and none of those failures is allowed to become a pass.
 * When the preview will not start, a route will not load, or there is nothing
 * approved to compare against, the result is `unverifiable` with the reason
 * written down — a real outcome an operator can act on, and one this system
 * never rounds up.
 *
 * The other rule this module keeps: **a visual verdict is not a technical
 * one.** Nothing here fails a job. A wrong margin does not mean the build is
 * broken, and the caller decides what a `changes_required` verdict means for
 * the job's status.
 */

export { readVerification, readVerificationHistory } from "./storage";

/** Whether this job asked to be looked at. Everything else skips entirely. */
export function wantsVisualVerification(
  job: Pick<WorkerJob, "visualAcceptance">,
): boolean {
  return job.visualAcceptance?.enabled === true;
}

function result(
  job: WorkerJob,
  revision: number,
  fields: Partial<VisualVerificationResult> & { verdict: VisualVerificationResult["verdict"]; summary: string },
): VisualVerificationResult {
  return {
    jobId: job.id,
    revision,
    strengths: [],
    issues: [],
    criteria: [],
    screenshots: [],
    references: [],
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

/** What the console should show as the approved direction, alongside a verdict. */
function referenceRecord(context: VisualContext) {
  return context.references.map((reference) => ({
    assetId: reference.assetId,
    filename: reference.filename,
    tags: reference.tags,
    notes: reference.notes,
  }));
}

/**
 * Whether there is anything to compare the implementation against.
 *
 * References, a brief, or the repository's own design system will each do. A
 * review with none of the three would be a model inventing a standard and then
 * marking the work against it, which is worse than admitting the question
 * cannot be answered.
 */
function hasSomethingToCompareAgainst(context: VisualContext): boolean {
  return (
    context.references.length > 0 ||
    context.designBrief !== undefined ||
    context.designSystem !== undefined
  );
}

/**
 * Verifies one job's implementation visually and records the verdict.
 *
 * Always returns a result and never throws: this runs inside the job
 * lifecycle, and an exception escaping here would fail a job for a reason that
 * has nothing to do with whether its code works.
 */
export async function verifyJobVisually(
  job: WorkerJob,
  emit: EmitWorkerEvent,
): Promise<VisualVerificationResult> {
  const revision = job.revision ?? 1;
  const acceptance = job.visualAcceptance;

  emit("visual.started", "Verifying the implementation visually", {
    revision,
    routes: acceptance?.routes.length ?? 0,
  });

  const record = async (
    verification: VisualVerificationResult,
  ): Promise<VisualVerificationResult> => {
    await saveVerification(verification).catch((error: unknown) => {
      // Recording never throws into the run it observes.
      console.error("[agentos] could not store a visual verification:", error);
    });

    emit(
      "visual.completed",
      `Visual verification: ${verification.verdict.replace(/_/g, " ")}. ${verification.summary}`,
      {
        revision,
        verdict: verification.verdict,
        issues: verification.issues.length,
        screenshots: verification.screenshots.length,
      },
    );

    return verification;
  };

  if (!acceptance?.enabled) {
    return record(
      result(job, revision, {
        verdict: "unverifiable",
        summary: "This job did not ask for visual verification.",
        unverifiableReason: "Visual acceptance is not enabled on this job.",
      }),
    );
  }

  if (!job.worktreePath) {
    return record(
      result(job, revision, {
        verdict: "unverifiable",
        summary: "There was no isolated checkout to run, so nothing could be photographed.",
        unverifiableReason: "The job has no worktree.",
      }),
    );
  }

  if (acceptance.routes.length === 0) {
    return record(
      result(job, revision, {
        verdict: "unverifiable",
        summary:
          "No routes were listed for verification, so there was nothing to look at.",
        unverifiableReason:
          "Visual acceptance was enabled without any routes. Add at least one route and a viewport.",
      }),
    );
  }

  const context = await buildVisualContext(acceptance, job.worktreePath).catch(
    () => undefined,
  );

  if (!context) {
    return record(
      result(job, revision, {
        verdict: "unverifiable",
        summary: "The approved design context could not be read.",
        unverifiableReason:
          "The references, brief, or design system could not be resolved for this job.",
      }),
    );
  }

  if (!hasSomethingToCompareAgainst(context)) {
    return record(
      result(job, revision, {
        verdict: "unverifiable",
        summary:
          "There was nothing approved to compare the implementation against.",
        unverifiableReason:
          "No references resolved, no design brief was attached, and the repository states no design system. Attach a board, a brief, or both.",
        references: referenceRecord(context),
      }),
    );
  }

  // Settled rather than caught, so the handle below is a value the compiler
  // knows exists — a `stop` that might not have been assigned is exactly the
  // bug that leaves a dev server running on a port nobody remembers.
  const started = await startPreview(job.worktreePath, {
    sourceRepoPath: job.sourceRepoPath,
    onProgress: (message) => emit("job.progress", message, { revision }),
  }).then(
    (preview) => ({ ok: true as const, preview }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  if (!started.ok) {
    const detail =
      started.error instanceof Error
        ? started.error.message
        : "The implementation could not be started.";

    return record(
      result(job, revision, {
        verdict: "unverifiable",
        summary: "The implementation could not be run, so it could not be seen.",
        unverifiableReason: detail,
        references: referenceRecord(context),
      }),
    );
  }

  const preview = started.preview;

  try {
    const { captures, failures, mismatch } = await captureRoutes(
      preview.url,
      acceptance.routes,
    );

    // A route that rendered the wrong screen ends the whole verification, even
    // if every other route captured cleanly. The routes are the specification;
    // if one of them is wrong, a verdict drawn from the rest would be a
    // confident statement about pages nobody asked to check.
    if (mismatch) {
      return record(
        result(job, revision, {
          verdict: "unverifiable",
          summary: "A route did not render the page it was supposed to.",
          unverifiableReason: mismatch,
          references: referenceRecord(context),
        }),
      );
    }

    for (const capture of captures) {
      await saveScreenshot(job.id, revision, capture.filename, capture.data);
    }

    emit(
      "job.progress",
      captures.length === 1
        ? "Captured 1 implementation screenshot"
        : `Captured ${captures.length} implementation screenshots`,
      { revision, captured: captures.length, failed: failures.length },
    );

    const screenshots = captures.map((capture) => ({
      route: capture.route,
      viewport: capture.viewport,
      width: capture.width,
      height: capture.height,
      filename: capture.filename,
    }));

    if (captures.length === 0) {
      return record(
        result(job, revision, {
          verdict: "unverifiable",
          summary: "None of the routes could be captured.",
          unverifiableReason:
            failures.join(" ") || "No screenshots were produced.",
          references: referenceRecord(context),
        }),
      );
    }

    const packet = buildVisualReviewPacket({
      project: job.project,
      objective: job.objective,
      revision,
      acceptanceCriteria: job.acceptanceCriteria ?? [],
      screenshots: captures.map((capture) => ({
        route: capture.route,
        viewport: capture.viewport,
        // The only place a screenshot path is produced, and only from a name
        // this system generated.
        path: path.join(revisionDir(job.id, revision), capture.filename),
      })),
      context,
      captureFailures: failures,
    });

    const review = await requestVisualVerification(packet, {
      jobId: job.id,
      project: job.project,
    });

    return record(
      result(job, revision, {
        verdict: review.verdict,
        summary: review.summary,
        strengths: review.strengths,
        issues: review.issues,
        criteria: review.criteria,
        unverifiableReason: review.unverifiableReason,
        screenshots,
        references: referenceRecord(context),
        raw: review.raw,
      }),
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The visual review could not be run.";

    // A reviewer that could not be reached has not passed anything. The
    // screenshots that were taken are kept either way — they are evidence, and
    // an operator can look at them without Hermes.
    return record(
      result(job, revision, {
        verdict: "unverifiable",
        summary: "The implementation was photographed, but it could not be reviewed.",
        unverifiableReason: detail,
        references: referenceRecord(context),
      }),
    );
  } finally {
    // Whatever happened, the server does not outlive the verification.
    await preview.stop().catch(() => undefined);
  }
}
