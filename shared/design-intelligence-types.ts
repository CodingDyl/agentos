import { z } from "zod";

/**
 * Reading design references as project context.
 *
 * The design library has been a gallery: images you keep because they are
 * good. This turns a selection of them into something Hermes can reason about
 * alongside a project — and, eventually, into work.
 *
 * Three properties are built into these shapes rather than left to the code:
 *
 * - **The browser names assets, never files.** A request carries asset ids.
 *   The server resolves those to paths through the library, so a review can
 *   only ever reach an image the library already knows about.
 * - **A review is exploratory until someone says otherwise.** It is stored in
 *   AgentOS's own state, not the vault. A design opinion is not project truth
 *   the moment a model produces one, and promoting it is a separate decision.
 * - **Observation and recommendation stay apart.** `patterns` is what is in
 *   the images; `recommendations` is what someone should do about it. Merging
 *   them is how a model's opinion quietly becomes a finding.
 */

/** What the review is for. Four questions worth asking of a set of images. */
export const DesignReviewModeSchema = z.enum([
  /** What direction do these suggest for this project? */
  "direction",
  /** What is wrong with these, as interfaces? */
  "critique",
  /** How do these differ, and what should be taken from each? */
  "compare",
  /** What system — colour, type, spacing, surfaces — do these imply? */
  "design-system",
]);

/**
 * The most references one review may carry.
 *
 * A ceiling rather than a preference. Each image is inspected individually
 * before anything is synthesised, so a moodboard of forty would be slow, dear,
 * and produce a summary too general to act on.
 */
export const MAX_REVIEW_ASSETS = 6;

export const DesignReviewRequestSchema = z.object({
  project: z.string(),
  assetIds: z.array(z.string()).min(1).max(MAX_REVIEW_ASSETS),
  mode: DesignReviewModeSchema,
  question: z.string().optional(),
});

/** One thing noticed, or one thing advised. */
export const DesignInsightSchema = z.object({
  title: z.string(),
  detail: z.string(),
});

/**
 * Where a review has got to.
 *
 * `pending` exists because the analysis runs as a Hermes run: the review
 * record is written when the run starts, so a page reload mid-analysis finds
 * the review rather than losing it.
 */
export const DesignReviewStatusSchema = z.enum([
  "pending",
  "complete",
  "failed",
]);

export const DesignReviewSchema = z.object({
  id: z.string(),
  project: z.string(),
  assetIds: z.array(z.string()),
  mode: DesignReviewModeSchema,
  question: z.string().optional(),
  status: DesignReviewStatusSchema,
  /** The Hermes run behind it, while one is in flight. */
  runId: z.string().optional(),

  summary: z.string(),
  /** What is actually in the images. */
  patterns: z.array(DesignInsightSchema),
  /** What to do about it. Kept apart from what was observed. */
  recommendations: z.array(DesignInsightSchema),
  avoid: z.array(z.string()).optional(),
  implementationNotes: z.array(z.string()).optional(),
  bestNextMove: z.string().optional(),

  createdAt: z.string(),
  completedAt: z.string().optional(),
  /** Why it failed, when it did. */
  error: z.string().optional(),
  /**
   * The reply as it arrived.
   *
   * Kept for the same reason a worker review keeps one: the structured form is
   * a reading of the answer, and when the reading is wrong this is the only
   * way to find out.
   */
  raw: z.string().optional(),
});

export const DesignReviewResponseSchema = z.object({
  review: DesignReviewSchema,
});

export const DesignReviewsResponseSchema = z.object({
  reviews: z.array(DesignReviewSchema),
});

/**
 * A design brief drafted from a review.
 *
 * Proposed with the file it would be written to, and written nowhere until a
 * person agrees. The vault is the project's own account of itself; a document
 * appearing in it because a model wrote one would be the console editing the
 * project's mind for it.
 */
export const DesignBriefProposalSchema = z.object({
  project: z.string(),
  reviewId: z.string(),
  /** What the brief is about, e.g. `AI Chef`. */
  feature: z.string(),
  /** Vault-relative, e.g. `projects/pantry-pilot/design/CHEF_BRIEF.md`. */
  path: z.string(),
  markdown: z.string(),
  /** True when a file already sits at that path. */
  exists: z.boolean(),
});

export const DesignBriefProposalResponseSchema = z.object({
  proposal: DesignBriefProposalSchema,
});

export type DesignReviewMode = z.infer<typeof DesignReviewModeSchema>;
export type DesignReviewRequest = z.infer<typeof DesignReviewRequestSchema>;
export type DesignInsight = z.infer<typeof DesignInsightSchema>;
export type DesignReviewStatus = z.infer<typeof DesignReviewStatusSchema>;
export type DesignReview = z.infer<typeof DesignReviewSchema>;
export type DesignReviewResponse = z.infer<typeof DesignReviewResponseSchema>;
export type DesignReviewsResponse = z.infer<typeof DesignReviewsResponseSchema>;
export type DesignBriefProposal = z.infer<typeof DesignBriefProposalSchema>;
export type DesignBriefProposalResponse = z.infer<
  typeof DesignBriefProposalResponseSchema
>;
