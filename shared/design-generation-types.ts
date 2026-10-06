import { z } from "zod";

/**
 * Generating design concepts.
 *
 * The last step of the design loop: references come in, a direction is read
 * out of them, and now concepts can be made from that direction rather than
 * from a prompt typed into a void.
 *
 * Three things are fixed in these shapes:
 *
 * - **A generated image is a concept, not a decision.** Everything lands in
 *   the library as `generated`, with the prompt and the references that made
 *   it. Promoting one into a project's design direction is a separate act.
 * - **The browser names assets, never files.** Reference ids are resolved to
 *   paths on the server, exactly as in a visual review.
 * - **Provenance survives.** A generated asset without its prompt and parents
 *   is an orphan: you can see it, and never learn how to get another like it.
 */

export const AspectRatioSchema = z.enum(["1:1", "4:3", "16:9", "9:16"]);

/**
 * How many concepts one request may ask for.
 *
 * Low on purpose. Each variation is a separate paid job, so a generous default
 * spends real money on a click — and four near-identical images are rarely
 * four times as useful as one.
 */
export const MAX_VARIATIONS = 4;

/** Reference images one generation can take: Higgsfield's own limit. */
export const MAX_REFERENCE_IMAGES = 6;

export const DesignGenerationRequestSchema = z.object({
  /** Optional on purpose: not every image belongs to a project. */
  project: z.string().optional(),
  /** A product or area within the project, e.g. `chef`. Free text. */
  product: z.string().max(60).optional(),
  /** Higgsfield job type. The configured default when absent. */
  model: z.string().max(80).optional(),
  prompt: z.string().min(1),
  /** Library assets to generate from. Resolved to paths server-side. */
  referenceAssetIds: z.array(z.string()).max(MAX_REFERENCE_IMAGES).optional(),
  aspectRatio: AspectRatioSchema.optional(),
  count: z.number().int().min(1).max(MAX_VARIATIONS).default(1),
  /**
   * Whether Hermes rewrites the prompt using project context first.
   *
   * On by default: it is the difference between an image model rendering a
   * sentence and one rendering this project's intent. Off when the operator
   * has written the prompt they actually want.
   */
  refinePrompt: z.boolean().default(true),
});

/** One image that came back, once it is in the library. */
export const GeneratedDesignSchema = z.object({
  assetId: z.string(),
  prompt: z.string(),
  project: z.string().optional(),
  referenceAssetIds: z.array(z.string()),
  createdAt: z.string(),
});

export const DesignGenerationStatusSchema = z.enum([
  "queued",
  "generating",
  "completed",
  "failed",
]);

/**
 * One generation, kept so the history can be reopened.
 *
 * `finalPrompt` is stored beside the request because it is what was actually
 * rendered: when Hermes refines a prompt, the sentence the operator typed and
 * the sentence the model received are different things, and only one of them
 * explains the picture.
 */
export const DesignGenerationSchema = z.object({
  id: z.string(),
  status: DesignGenerationStatusSchema,
  request: DesignGenerationRequestSchema,
  /** What was actually sent to the image model. */
  finalPrompt: z.string().optional(),
  /** Who wrote it: the operator, or Hermes refining what they asked for. */
  promptBy: z.enum(["operator", "hermes"]).optional(),
  results: z.array(GeneratedDesignSchema),
  error: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});

export const DesignGenerationResponseSchema = z.object({
  generation: DesignGenerationSchema,
});

export const DesignGenerationsResponseSchema = z.object({
  generations: z.array(DesignGenerationSchema),
});

/**
 * Whether concepts can be generated at all.
 *
 * Discovered rather than assumed, and reported with a reason — the same rule
 * the visual review follows. A Generate button that starts a job which cannot
 * run is worse than one that says why it is disabled.
 */
/** The signed-in Higgsfield account, or why there is not one. */
export const HiggsfieldAccountSchema = z.object({
  connected: z.boolean(),
  email: z.string().optional(),
  plan: z.string().optional(),
  /** Credits remaining on the plan. Absent when the CLI would not say. */
  credits: z.number().optional(),
  reason: z.string().optional(),
});

export const HiggsfieldModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["image", "video", "other"]),
});

export const HiggsfieldModelsResponseSchema = z.object({
  models: z.array(HiggsfieldModelSchema),
});

/**
 * What a generation would cost, priced by Higgsfield rather than guessed.
 *
 * `unavailable` rather than a fabricated number: a wrong estimate shown with
 * confidence is worse than an honest "could not price this".
 */
export const CostEstimateSchema = z.object({
  perJob: z.number(),
  total: z.number(),
  unavailable: z.string().optional(),
});

export const CostEstimateResponseSchema = z.object({ cost: CostEstimateSchema });

export const GenerationCapabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  /** The model concepts are rendered with, when one is configured. */
  model: z.string().optional(),
});

export const GenerationCapabilityResponseSchema = z.object({
  generation: GenerationCapabilitySchema,
});

export type HiggsfieldAccount = z.infer<typeof HiggsfieldAccountSchema>;
export type HiggsfieldModel = z.infer<typeof HiggsfieldModelSchema>;
export type HiggsfieldModelsResponse = z.infer<typeof HiggsfieldModelsResponseSchema>;
export type CostEstimate = z.infer<typeof CostEstimateSchema>;
export type CostEstimateResponse = z.infer<typeof CostEstimateResponseSchema>;
export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type DesignGenerationRequest = z.infer<
  typeof DesignGenerationRequestSchema
>;
export type GeneratedDesign = z.infer<typeof GeneratedDesignSchema>;
export type DesignGenerationStatus = z.infer<
  typeof DesignGenerationStatusSchema
>;
export type DesignGeneration = z.infer<typeof DesignGenerationSchema>;
export type DesignGenerationResponse = z.infer<
  typeof DesignGenerationResponseSchema
>;
export type DesignGenerationsResponse = z.infer<
  typeof DesignGenerationsResponseSchema
>;
export type GenerationCapability = z.infer<typeof GenerationCapabilitySchema>;
export type GenerationCapabilityResponse = z.infer<
  typeof GenerationCapabilityResponseSchema
>;
