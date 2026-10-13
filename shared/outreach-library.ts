import { z } from "zod";
import { OutreachPathSchema } from "./outreach-case";

/**
 * The email library: outreach emails worth reusing as examples.
 *
 * Each one is a plain Markdown note in the memory vault (Obsidian), under
 * `Outreach/Email library/`, so it can be read, edited and tagged outside
 * AgentOS. AgentOS shows the drafting model two or three of them as examples
 * of tone and shape. They are examples, never templates: the facts in a new
 * email always come from that business's own case file.
 */

export const LIBRARY_FOLDER = "Outreach/Email library";

/** 1 = first email, 2 = first follow-up, 3 = last follow-up. */
export const TouchSchema = z.number().int().min(1).max(3);
export type Touch = z.infer<typeof TouchSchema>;

export const TOUCH_LABELS: Record<Touch, string> = {
  1: "First email",
  2: "First follow-up",
  3: "Last follow-up",
};

export const LibraryEmailSchema = z.object({
  /** The note's path in the vault. */
  id: z.string(),
  title: z.string(),
  subject: z.string(),
  body: z.string(),
  touch: TouchSchema,
  path: OutreachPathSchema.optional(),
  /** Marked by you: this one got a reply. Such examples are shown to the drafter first. */
  gotReply: z.boolean(),
  note: z.string(),
  savedAt: z.string(),
});
export type LibraryEmail = z.infer<typeof LibraryEmailSchema>;

/** What the screen sends to save a draft. The business is named by id, never described. */
export const LibrarySaveRequestSchema = z
  .object({
    prospectId: z.string().min(1).max(200),
    subject: z.string().trim().min(1).max(150),
    body: z.string().trim().min(1).max(6000),
    touch: TouchSchema,
    gotReply: z.boolean().default(false),
    note: z.string().trim().max(600).default(""),
  })
  .strict();
export type LibrarySaveRequest = z.infer<typeof LibrarySaveRequestSchema>;
