import { z } from "zod";

/**
 * Checking that an implementation *looks* like what was designed.
 *
 * This is a different question from the one code review answers, and it is
 * asked separately for a reason: code can be correct, tested, and reviewed
 * while the screen it produces is wrong. A diff cannot show that. A screenshot
 * can.
 *
 * Two rules hold the whole thing together:
 *
 * - **A visual failure is not a technical failure.** A margin being wrong does
 *   not mean the build is broken, so it never marks a job `failed`. It asks for
 *   changes, which is a different claim about a different thing.
 * - **A verdict that could not be reached is not a pass.** When the preview
 *   would not start, a route would not load, or there was nothing approved to
 *   compare against, the answer is `unverifiable` — said out loud, and never
 *   quietly rounded up.
 *
 * What is compared is design *intent*, not pixels. References in this system
 * are usually inspiration rather than exact mockups, so a percentage difference
 * between two images would be a precise answer to a question nobody asked.
 */

/** One size a route is looked at in. */
export const VisualViewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * A route worth looking at, the page it must turn out to be, and the sizes it
 * must hold up at.
 *
 * `expectedPageId` is what makes the capture deterministic. A single-page app
 * answers 200 for every path it has never heard of — this one redirects an
 * unknown route to the dashboard — so a typo in a route does not fail, it
 * quietly photographs a different screen. Asking a reviewer to notice that from
 * an image is asking it to catch a typo by eye.
 *
 * Instead the page says who it is, in the DOM, and the capture checks. See
 * `AppShell`, which stamps `data-agentos-page` on every screen's `<main>`.
 */
export const VisualRouteSchema = z.object({
  /** Application-relative, e.g. `/designs`. */
  path: z.string().min(1),
  /**
   * The `data-agentos-page` this route must render.
   *
   * Not derived from the path on purpose. `/projects/pantry-pilot` renders the
   * `project` screen, and a derivation that guessed `projects-pantry-pilot`
   * would fail a route that was perfectly correct.
   */
  expectedPageId: z.string().min(1),
  viewports: z.array(VisualViewportSchema).min(1),
});

/**
 * What a job is expected to look like, attached before any work starts.
 *
 * Carried on the job rather than reconstructed afterwards. By the time an
 * implementation exists, the brief that motivated it and the references it was
 * drawn from are two lookups and a guess away — so they travel with the task
 * from the moment it is created.
 *
 * `enabled` is the switch the rest of the pipeline reads. A Java API ticket
 * leaves it off and never sees a browser; a React redesign turns it on.
 */
export const VisualAcceptanceContextSchema = z.object({
  enabled: z.boolean(),
  routes: z.array(VisualRouteSchema).default([]),
  /** Approved references, by design-library id. Never paths. */
  referenceAssetIds: z.array(z.string()).optional(),
  /** A board whose assets are the approved direction. */
  boardId: z.string().optional(),
  /** Vault-relative, e.g. `projects/agentos/design/DESIGN_LIBRARY.md`. */
  designBriefPath: z.string().optional(),
});

export const VisualVerificationVerdictSchema = z.enum([
  "pass",
  "changes_required",
  /** The comparison could not honestly be made. Never a pass. */
  "unverifiable",
]);

/**
 * Severity, with only two levels.
 *
 * A visual finding is either something that has to change before this ships or
 * something worth noting. There is no `critical` here on purpose: a critical
 * visual problem is still a visual problem, and borrowing the code reviewer's
 * vocabulary would invite a wrong margin to read like a security bug.
 */
export const VisualIssueSeveritySchema = z.enum(["major", "minor"]);

export const VisualIssueCategorySchema = z.enum([
  "layout",
  "typography",
  "spacing",
  "color",
  "component",
  "responsive",
  "design-system",
  "other",
]);

export const VisualIssueSchema = z.object({
  severity: VisualIssueSeveritySchema,
  category: VisualIssueCategorySchema,
  title: z.string(),
  detail: z.string(),
  /** The route it was seen on, when the reviewer said. */
  route: z.string().optional(),
});

export const VisualCriterionSchema = z.object({
  criterion: z.string(),
  satisfied: z.boolean(),
  note: z.string().optional(),
});

/**
 * One captured screenshot.
 *
 * Richer than a filename because the console has to lay these out: a person
 * comparing an implementation against a reference needs to know which route
 * and which viewport they are looking at without reading a filename.
 */
export const VisualScreenshotSchema = z.object({
  /** The route as it was requested, e.g. `/designs`. */
  route: z.string(),
  viewport: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Name on disk within this revision's directory. Never a path. */
  filename: z.string(),
});

/**
 * An approved reference, as the console needs to show it.
 *
 * Carried on the result rather than looked up later so that a verification
 * from three revisions ago still says what it was actually compared against,
 * even if the board has since been edited.
 */
export const VisualReferenceSchema = z.object({
  assetId: z.string(),
  filename: z.string(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const VisualVerificationResultSchema = z.object({
  jobId: z.string(),
  /** Which attempt this looked at. Revisions are kept, never overwritten. */
  revision: z.number().int().positive(),
  verdict: VisualVerificationVerdictSchema,
  summary: z.string(),
  strengths: z.array(z.string()).default([]),
  issues: z.array(VisualIssueSchema).default([]),
  criteria: z.array(VisualCriterionSchema).default([]),
  screenshots: z.array(VisualScreenshotSchema).default([]),
  references: z.array(VisualReferenceSchema).default([]),
  createdAt: z.string(),
  /**
   * Why it could not be judged, when it could not.
   *
   * Kept separate from `summary` so the console can say "this was not checked"
   * differently from "this was checked and it is fine".
   */
  unverifiableReason: z.string().optional(),
  /** Hermes' reply as it arrived, because a parse is a reading. */
  raw: z.string().optional(),
});

export const VisualVerificationResponseSchema = z.object({
  jobId: z.string(),
  /** The verification for the revision that is current. */
  current: VisualVerificationResultSchema.optional(),
  /** Every revision's verification, oldest first. Revision 1 is never lost. */
  history: z.array(VisualVerificationResultSchema).default([]),
});

export type VisualViewport = z.infer<typeof VisualViewportSchema>;
export type VisualRoute = z.infer<typeof VisualRouteSchema>;
export type VisualAcceptanceContext = z.infer<
  typeof VisualAcceptanceContextSchema
>;
export type VisualVerificationVerdict = z.infer<
  typeof VisualVerificationVerdictSchema
>;
export type VisualIssueSeverity = z.infer<typeof VisualIssueSeveritySchema>;
export type VisualIssueCategory = z.infer<typeof VisualIssueCategorySchema>;
export type VisualIssue = z.infer<typeof VisualIssueSchema>;
export type VisualCriterion = z.infer<typeof VisualCriterionSchema>;
export type VisualScreenshot = z.infer<typeof VisualScreenshotSchema>;
export type VisualReference = z.infer<typeof VisualReferenceSchema>;
export type VisualVerificationResult = z.infer<
  typeof VisualVerificationResultSchema
>;
export type VisualVerificationResponse = z.infer<
  typeof VisualVerificationResponseSchema
>;
