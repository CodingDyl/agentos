import { z } from "zod";

/**
 * Sorting captures: where each note in `inbox/CAPTURE.md` belongs.
 *
 * Hermes suggests a home for each capture; a person accepts, changes or
 * deletes it on Today. Accepting files it in its real home and takes it out
 * of the inbox, so the inbox empties instead of piling up.
 */

export const CaptureKindSchema = z.enum(["task", "decision", "idea", "goal", "reference"]);
export type CaptureKind = z.infer<typeof CaptureKindSchema>;

export const CAPTURE_KIND_LABEL: Record<CaptureKind, string> = {
  task: "Task",
  decision: "Decision",
  idea: "Idea",
  goal: "Goal",
  reference: "Reference",
};

/**
 * Where a capture goes. A workspace (by slug) or a life area (by folder
 * name). Neither means "personal, no workspace": your personal area.
 */
export const CaptureDestinationSchema = z
  .object({
    kind: CaptureKindSchema,
    /** The line as it will be filed, cleaned up. */
    title: z.string().trim().min(1).max(300),
    workspace: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
    area: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  })
  .strict();
export type CaptureDestination = z.infer<typeof CaptureDestinationSchema>;

export const CaptureSuggestionSchema = CaptureDestinationSchema.extend({
  /** One short line on why, from Hermes. */
  why: z.string().max(200).default(""),
}).strip();
export type CaptureSuggestion = z.infer<typeof CaptureSuggestionSchema>;

export const CaptureEntrySchema = z.object({
  /** Stable for the line's text: what accept and delete refer to. */
  id: z.string(),
  /** The bullet exactly as written in CAPTURE.md. */
  raw: z.string(),
  text: z.string(),
  kind: z.string().optional(),
  workspace: z.string().optional(),
  suggestion: CaptureSuggestionSchema.optional(),
});
export type CaptureEntry = z.infer<typeof CaptureEntrySchema>;

export const CaptureTriageSchema = z.object({
  items: z.array(CaptureEntrySchema),
  workspaces: z.array(z.object({ slug: z.string(), name: z.string() })),
  areas: z.array(z.string()),
});
export type CaptureTriage = z.infer<typeof CaptureTriageSchema>;

export const CaptureAcceptSchema = z
  .object({ id: z.string().min(1).max(40), destination: CaptureDestinationSchema })
  .strict();

/** Where an accepted capture landed, in words, for the screen. */
export const CaptureFiledSchema = z.object({ filedTo: z.string() });
