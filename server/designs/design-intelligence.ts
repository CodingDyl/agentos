import type {
  DesignBriefProposal,
  DesignReview,
  DesignReviewRequest,
} from "../../shared/design-intelligence-types";
import { recordActivity } from "../activity/ui-events";
import { fileExists, writeAgentOSFile } from "../agentos/filesystem";
import { getCapabilities } from "../hermes/capabilities";
import { sendToHermes } from "../hermes/client";
import { buildReviewInput, readDesignReview } from "../hermes/design-review";
import { getRun, startRun } from "../hermes/runs";
import { buildReviewContext } from "./review-context";
import { createReviewId, readReview, saveReview } from "./review-store";

/**
 * Running a visual design review.
 *
 * Three refusals happen before Hermes is asked anything, and each exists
 * because the alternative is an answer that looks fine and is worthless:
 *
 * - **No vision, no review.** If Hermes cannot actually look at an image, it
 *   will still happily produce a confident design opinion — formed from the
 *   filenames and the project context alone. That is the one failure mode this
 *   feature must not have, because nothing in the output would reveal it.
 * - **No resolvable references, no review.** Ids that name nothing in the
 *   library cannot become files, and a review of zero images is not a review.
 * - **Nothing reaches the vault.** A review is exploratory and is stored in
 *   AgentOS's own state. Only a brief a person approves is written to a
 *   project, and only to the path they were shown.
 */

const PROJECTS_DIR = "projects";

/** The Hermes skill that drafts a brief from a review. */
const BRIEF_SKILL = "/review-design";

export interface StartReviewResult {
  review?: DesignReview;
  error?: string;
}

/**
 * Starts a review.
 *
 * Returns as soon as the run is submitted. The review record is written first,
 * with its run id, so a page reload during the analysis finds the review in
 * progress rather than losing it.
 */
export async function startReview(
  request: DesignReviewRequest,
): Promise<StartReviewResult> {
  const capabilities = await getCapabilities().catch(() => undefined);

  if (!capabilities?.vision) {
    return {
      error:
        capabilities?.visionReason ??
        "Hermes cannot inspect images, so a visual review would be an opinion formed without looking at anything.",
    };
  }

  const { references, missing, projectContext } = await buildReviewContext(
    request.project,
    request.assetIds,
  );

  if (references.length === 0) {
    return {
      error:
        "None of those references are in the design library any more, so there is nothing to look at.",
    };
  }

  const input = buildReviewInput({
    project: request.project,
    mode: request.mode,
    question: request.question,
    references,
    projectContext,
  });

  const review: DesignReview = {
    id: createReviewId(),
    project: request.project,
    // Recorded as what was actually reviewed, which is not always what was
    // asked for: a stale id is dropped rather than silently counted.
    assetIds: references.map((reference) => reference.assetId),
    mode: request.mode,
    question: request.question,
    status: "pending",
    summary: "",
    patterns: [],
    recommendations: [],
    createdAt: new Date().toISOString(),
  };

  try {
    const run = await startRun({ input });

    review.runId = run.runId;
    await saveReview(review);

    await recordActivity({
      type: "design.reviewed",
      description: `${request.mode} review of ${references.length} reference${
        references.length === 1 ? "" : "s"
      }${missing.length > 0 ? ` (${missing.length} no longer in the library)` : ""}`,
      project: request.project,
      metadata: {
        reviewId: review.id,
        runId: run.runId,
        mode: request.mode,
        references: references.length,
      },
    });

    return { review };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Hermes would not start the review.",
    };
  }
}

/**
 * Reads a finished run into the review.
 *
 * Called once the console sees the run end. Safe to call more than once: a
 * review that is already complete is returned as it stands rather than
 * re-parsed, so a double-submitted finalise cannot overwrite a good reading
 * with a worse one.
 */
export async function finaliseReview(
  id: string,
): Promise<{ review?: DesignReview; error?: string }> {
  const review = await readReview(id);

  if (!review) return { error: "There is no such review." };
  if (review.status !== "pending") return { review };

  if (!review.runId) {
    return { error: "That review has no run behind it." };
  }

  try {
    const run = await getRun(review.runId);

    // Still going. The console asks again when the run's stream ends, so a
    // review that is not finished is simply returned as it stands.
    if (
      run.status === "starting" ||
      run.status === "running" ||
      run.status === "waiting_for_approval" ||
      run.status === "stopping"
    ) {
      return { review };
    }

    if (!run.output) {
      const failed: DesignReview = {
        ...review,
        status: "failed",
        completedAt: new Date().toISOString(),
        error:
          run.status === "cancelled"
            ? "The review was stopped."
            : "Hermes finished without returning a review.",
      };

      await saveReview(failed);
      return { review: failed };
    }

    const complete: DesignReview = {
      ...review,
      ...readDesignReview(run.output),
      status: "complete",
      completedAt: new Date().toISOString(),
    };

    await saveReview(complete);

    return { review: complete };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "The review could not be read.",
    };
  }
}

/** A filename a person would recognise, from whatever they typed. */
function briefFilename(feature: string): string {
  const slug = feature
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  return `${slug || "DESIGN"}_BRIEF.md`;
}

/**
 * Drafts a design brief from a review.
 *
 * Proposed, with the path it would be written to and whether something is
 * already there. Nothing is written: the vault is the project's own account of
 * itself, and a document appearing in it because a model wrote one would be
 * the console editing the project's mind for it.
 */
export async function proposeBrief(
  reviewId: string,
  feature: string,
): Promise<{ proposal?: DesignBriefProposal; error?: string }> {
  const review = await readReview(reviewId);

  if (!review) return { error: "There is no such review." };

  if (review.status !== "complete") {
    return { error: "That review has not finished yet." };
  }

  const instruction = [
    `${BRIEF_SKILL}`,
    "",
    `Write a design brief for "${feature}" in the ${review.project} project,`,
    "from the design review below. Do not analyse any images again; the",
    "review is the input. Keep it to what the review actually supports.",
    "",
    "Return markdown only, with these headings:",
    "# <feature> Design Brief",
    "## Goal",
    "## Design principles",
    "## Required UX",
    "## Visual direction",
    "## Avoid",
    "",
    "--- REVIEW ---",
    review.raw ?? review.summary,
  ].join("\n");

  try {
    const markdown = await sendToHermes(instruction, {
      operation: "design-review",
      project: review.project,
    });
    const path = `${PROJECTS_DIR}/${review.project}/design/${briefFilename(feature)}`;

    return {
      proposal: {
        project: review.project,
        reviewId: review.id,
        feature,
        path,
        // The references are recorded in the brief itself, so a reader can get
        // back to what it was drawn from.
        markdown: [
          markdown.trim(),
          "",
          "## References",
          "",
          ...review.assetIds.map((assetId) => `- ${assetId}`),
          "",
          `Drawn from design review ${review.id}.`,
        ].join("\n"),
        exists: await fileExists(path),
      },
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Hermes would not draft a brief.",
    };
  }
}

/**
 * Writes an approved brief into the project.
 *
 * The second of the two places this server writes to the vault, and like the
 * first it happens only after a person has seen exactly what would be written
 * and where.
 */
export async function saveBrief(
  proposal: DesignBriefProposal,
): Promise<{ ok: boolean; error?: string }> {
  if (!proposal.path.startsWith(`${PROJECTS_DIR}/${proposal.project}/`)) {
    // The path is proposed by this server, so a mismatch means it was edited
    // in transit rather than chosen here.
    return { ok: false, error: "That brief does not belong to that project." };
  }

  if (!/^[A-Za-z0-9/_.-]+\.md$/.test(proposal.path)) {
    return { ok: false, error: "A brief must be a markdown file." };
  }

  await writeAgentOSFile(proposal.path, `${proposal.markdown.trim()}\n`);

  await recordActivity({
    type: "design.brief.saved",
    description: `${proposal.feature} design brief written to ${proposal.path}`,
    project: proposal.project,
    metadata: { reviewId: proposal.reviewId, path: proposal.path },
  });

  return { ok: true };
}
