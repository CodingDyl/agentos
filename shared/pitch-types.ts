import { z } from "zod";

/**
 * The Pitch Pack: everything needed to sell one "build it first" prospect
 * whose rebuild has a preview, assembled from records that already exist
 * (the rebuild run, the outreach case, the site check, the Business ledger
 * and the outreach log). Nothing here is stored on its own.
 *
 * `status`:
 * - `none`: no rebuild for this prospect.
 * - `building`: a rebuild is running but has no preview yet.
 * - `ready`: the preview is live and no pitch has gone out.
 * - `pitched`: an email with the website-preview play was sent or recorded as sent.
 */
export const PitchStatusSchema = z.enum(["none", "building", "ready", "pitched"]);
export type PitchStatus = z.infer<typeof PitchStatusSchema>;

export const PitchShotSchema = z.object({
  artifactId: z.string(),
  title: z.string(),
  /** Served by the rebuild API, which only serves the run's own image artifacts. */
  src: z.string(),
});
export type PitchShot = z.infer<typeof PitchShotSchema>;

export const PitchQuoteSchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  id: z.string(),
  status: z.string().optional(),
  number: z.string().optional(),
  amountMinor: z.number().int().nonnegative().optional(),
});
export type PitchQuote = z.infer<typeof PitchQuoteSchema>;

export const PitchPackSchema = z.object({
  prospectId: z.string(),
  company: z.string(),
  status: PitchStatusSchema,
  rebuild: z
    .object({
      runId: z.string(),
      previewUrl: z.string().optional(),
      stagesDone: z.number().int().nonnegative(),
      stagesTotal: z.number().int().positive(),
    })
    .optional(),
  before: PitchShotSchema.optional(),
  after: PitchShotSchema.optional(),
  /** Two or three plain findings, the site's conversion leaks first. */
  findings: z.array(z.string()).max(3),
  /** The owner's own leak estimate, in one sentence, when the case has the figures. */
  leak: z.string().optional(),
  /** Whether a live site check contributed to the findings. */
  siteChecked: z.boolean(),
  prices: z.object({
    setup: z.string(),
    monthly: z.string(),
    setupMinor: z.number().int().nonnegative().optional(),
    monthlyMinor: z.number().int().nonnegative().optional(),
    /** The sending company's defaults, for the inline price form. */
    defaultSetup: z.string(),
    defaultMonthly: z.string(),
  }),
  quote: PitchQuoteSchema.optional(),
  pitchedAt: z.string().optional(),
  /** The case has a draft, and it includes the preview link. */
  draftReady: z.boolean(),
});
export type PitchPack = z.infer<typeof PitchPackSchema>;

export const PitchSummarySchema = z.object({
  prospectId: z.string(),
  status: z.enum(["ready", "pitched"]),
  pitchedAt: z.string().optional(),
});
export type PitchSummary = z.infer<typeof PitchSummarySchema>;

const Price = z.string().trim().max(80);

/** `POST /api/traction/pitch/:prospectId/quote`. Prices set here are saved on the case first. */
export const PitchQuoteRequestSchema = z
  .object({
    entityId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/).optional(),
    setupPrice: Price.optional(),
    monthlyPrice: Price.optional(),
  })
  .strict();
export type PitchQuoteRequest = z.infer<typeof PitchQuoteRequestSchema>;

/** `POST /api/traction/pitch/:prospectId/draft`. */
export const PitchDraftRequestSchema = z.object({ exampleId: z.string().max(300).optional() }).strict();

/** `POST /api/traction/pitch/:prospectId/screenshots`. */
export const PitchShotsRequestSchema = z.object({}).strict();

/** "R4 500", "R450 a month", "none" → rand amounts in cents. Undefined when there is no number. */
export function priceMinor(text: string): number | undefined {
  // The amount after an "R" first ("12 months at R450" is R450), else the first number.
  const plain = text.replace(/\u00a0/g, " ");
  const number = /\d+(?:[ ,]\d{3})*(?:\.\d{1,2})?/;
  const match = new RegExp(`R\\s?(${number.source})`, "i").exec(plain)?.[1] ?? number.exec(plain)?.[0];
  if (!match) return undefined;
  const cleaned = match.replace(/[ ,]/g, "");
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 100_000_000) return undefined;
  return Math.round(value * 100);
}

/** Pitches waiting to go out: the number Mission Control shows. */
export function pitchesReady(summaries: readonly PitchSummary[] | undefined): number | undefined {
  return summaries ? summaries.filter((entry) => entry.status === "ready").length : undefined;
}
