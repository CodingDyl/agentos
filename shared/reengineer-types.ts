import { z } from "zod";

/**
 * Reengineer: take a website apart, keep what was learned.
 *
 * A teardown is one run of Claude Code with the REA skill against a target.
 * It leaves a note in the vault (`knowledge/teardowns/`) and a handful of
 * library entries (`knowledge/library/`): the components, patterns and motion
 * worth remembering, each with why it works. A person marks entries proven or
 * rejected, and that verdict is what teaches the next build which to reach for.
 *
 * The library keeps what was *learned* and our own rebuilds — descriptions,
 * measurements, and screenshots as evidence — never another product's source
 * or assets.
 */

export const REENGINEER_KINDS = ["website", "app", "source"] as const;
export const LIBRARY_KINDS = ["component", "pattern", "layout", "motion", "style", "function"] as const;
export const LibraryKindSchema = z.enum(LIBRARY_KINDS);

export const ReengineerRequestSchema = z.object({
  /** A URL, an app's name, or a path or repo to the source. */
  target: z.string().trim().min(1, "Give a URL, an app name or a source.").max(500),
  /** What to understand. Absent: how it is built and what makes it good. */
  question: z.string().trim().max(1500).optional(),
  /** Kinds of thing to look for, e.g. navigation, scroll motion. */
  focus: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  /** A workspace the learning is for, kept as a tag on what comes out. */
  workspace: z.string().trim().max(120).optional(),
});

export const ReengineerRunStatusSchema = z.enum(["running", "awaiting_review", "completed", "failed", "cancelled"]);

export const ReengineerRunSchema = z.object({
  id: z.string(),
  target: z.string(),
  kind: z.enum(REENGINEER_KINDS),
  question: z.string().optional(),
  focus: z.array(z.string()),
  workspace: z.string().optional(),
  jobId: z.string(),
  createdAt: z.string(),
  /** When its output was filed into the vault. */
  ingestedAt: z.string().optional(),
  /** Vault-relative path of the teardown note. */
  notePath: z.string().optional(),
  entryIds: z.array(z.string()).default([]),
  error: z.string().optional(),
});

export const ReengineerRunViewSchema = ReengineerRunSchema.extend({
  status: ReengineerRunStatusSchema,
  summary: z.string().optional(),
  jobHref: z.string(),
});

export const VerdictSchema = z.enum(["proven", "rejected", "used", "candidate"]);

export const LibraryEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: LibraryKindSchema,
  summary: z.string(),
  whyItWorks: z.string(),
  tags: z.array(z.string()),
  status: z.enum(["candidate", "proven", "rejected"]),
  /** Where it was learned from. */
  source: z.object({ target: z.string(), runId: z.string().optional() }),
  /** Vault-relative image, as evidence. */
  screenshot: z.string().optional(),
  screenshotUrl: z.string().optional(),
  /** Vault-relative path of our own clean rebuild, once there is one. */
  rebuild: z.string().optional(),
  verdicts: z.array(z.object({ at: z.string(), verdict: VerdictSchema, note: z.string().optional(), workspace: z.string().optional() })),
  uses: z.number(),
  createdAt: z.string(),
  /** Vault-relative path of the entry's own note. */
  path: z.string(),
});

export const VerdictInputSchema = z
  .object({
    verdict: VerdictSchema,
    note: z.string().trim().max(600).optional(),
    workspace: z.string().trim().max(120).optional(),
  })
  .strict();

export const ReengineerReadinessSchema = z.object({
  /** REA's MCP server is registered with Claude Code. */
  rea: z.boolean(),
  skill: z.boolean(),
  claude: z.boolean(),
  /** A Chrome with remote debugging answers on the CDP port. */
  browser: z.boolean(),
  missing: z.array(z.string()),
});

export type ReengineerRequest = z.infer<typeof ReengineerRequestSchema>;
export type ReengineerRequestInput = z.input<typeof ReengineerRequestSchema>;
export type ReengineerRun = z.infer<typeof ReengineerRunSchema>;
export type ReengineerRunView = z.infer<typeof ReengineerRunViewSchema>;
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;
export type LibraryKind = z.infer<typeof LibraryKindSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type VerdictInput = z.infer<typeof VerdictInputSchema>;
export type ReengineerReadiness = z.infer<typeof ReengineerReadinessSchema>;
