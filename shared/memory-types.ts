import { z } from "zod";

/**
 * Memory: the Obsidian vault read as AgentOS's shared knowledge.
 *
 * Markdown on disk is the only source of truth. Everything here is derived
 * from it — an index the server can rebuild at any time — and every note is
 * addressed by its vault-relative path, so two `NOTES.md` in different folders
 * are two different notes.
 */

export type VaultState = "connected" | "indexing" | "unavailable" | "unconfigured";

export interface VaultStatus {
  state: VaultState;
  /** Absolute vault path as configured. */
  root?: string;
  /** Why the vault cannot be read, in words an operator can act on. */
  reason?: string;
  checkedAt: string;
  lastIndexedAt?: string;
  /** Bumped on every change to the index, so a screen knows when to refetch. */
  version: number;
  notes: number;
  links: number;
  unresolved: number;
  ambiguous: number;
  attachments: number;
  errors: number;
  /** True when what is served is the last index from before the vault went away. */
  stale: boolean;
}

export type MemoryLinkSyntax = "wikilink" | "markdown" | "embed";

export type MemoryLinkResolution =
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "attachment"
  | "self";

export interface MemoryLink {
  syntax: MemoryLinkSyntax;
  /** What was written, e.g. `folder/Note#Heading|Label`. */
  raw: string;
  /** The target part only, e.g. `folder/Note`. Empty for same-note anchors. */
  target: string;
  heading?: string;
  blockId?: string;
  label?: string;
  line: number;
  resolution: MemoryLinkResolution;
  /** Note id when resolved (or `self`). */
  targetId?: string;
  /** Attachment path when the link points at a file that is not a note. */
  attachment?: string;
  /** Candidates when ambiguous. */
  candidates?: string[];
}

export interface MemoryHeading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface MemoryNoteSummary {
  /** Vault-relative path with forward slashes. */
  id: string;
  title: string;
  folder: string;
  tags: string[];
  aliases: string[];
  modifiedAt: string;
  size: number;
  outgoingCount: number;
  backlinkCount: number;
  hasErrors: boolean;
}

export interface MemoryBacklink {
  sourceId: string;
  sourceTitle: string;
  count: number;
  /** The link texts as written in the source. */
  raws: string[];
}

export interface MemoryNoteDetail extends MemoryNoteSummary {
  hash: string;
  headings: MemoryHeading[];
  frontmatter: Record<string, unknown>;
  links: MemoryLink[];
  backlinks: MemoryBacklink[];
  errors: string[];
  /** The note body without front matter. */
  content: string;
  truncated: boolean;
  /** Served from the cache while the vault is unavailable. */
  stale: boolean;
}

export interface MemoryNotesPage {
  notes: MemoryNoteSummary[];
  total: number;
  /** Notes in the vault before any filter. */
  vaultTotal: number;
  offset: number;
  limit: number;
}

export interface MemoryFacets {
  folders: Array<{ folder: string; count: number }>;
  tags: Array<{ tag: string; count: number }>;
}

export interface MemoryGraphNode {
  id: string;
  title: string;
  folder: string;
  tags: string[];
  degree: number;
  /** Ghost node for a link target that does not exist. */
  unresolved?: boolean;
  /** Hops from the focus note in a local graph. */
  depth?: number;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  count: number;
  /** Original link targets, deduplicated. */
  targets: string[];
  unresolved?: boolean;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  /** Totals for the whole vault, so filtered counts are never mistaken for them. */
  totalNotes: number;
  totalEdges: number;
  /** Set when nodes were left out because of the rendering cap. */
  capped?: { limit: number; omitted: number };
  focus?: string;
  depth?: number;
}

export interface MemorySearchHit {
  id: string;
  title: string;
  score: number;
  /** Where the best match was: title, alias, heading, tag, path or content. */
  matchedIn: string[];
  heading?: string;
  snippet?: string;
}

export interface MemoryDiagnostics {
  unresolved: Array<{ sourceId: string; raw: string; line: number }>;
  ambiguous: Array<{ sourceId: string; raw: string; line: number; candidates: string[] }>;
  errors: Array<{ id: string; errors: string[] }>;
  skipped: Array<{ path: string; reason: string }>;
}

/** One excerpt handed to Hermes or a worker, and exactly where it came from. */
export const MemoryContextSourceSchema = z.object({
  path: z.string(),
  heading: z.string().optional(),
  /** sha256 of the whole note when it was read. */
  hash: z.string(),
  modifiedAt: z.string(),
  reason: z.enum(["required", "search", "linked"]),
  chars: z.number(),
  truncated: z.boolean(),
});

export const MemoryContextStatusSchema = z.enum(["ok", "insufficient", "unavailable", "disabled"]);

/**
 * The vault context captured for one job. Kept on the job record verbatim, so
 * editing a note later changes the *next* job's brief, never this one's.
 */
export const MemoryContextSchema = z.object({
  status: MemoryContextStatusSchema,
  retrievedAt: z.string(),
  vaultRoot: z.string().optional(),
  budgetTokens: z.number(),
  usedTokens: z.number(),
  query: z.string(),
  sources: z.array(MemoryContextSourceSchema),
  /** Required notes that could not be found. */
  missing: z.array(z.string()),
  warnings: z.array(z.string()),
  /** The exact text given to the worker, so the brief is reproducible. */
  text: z.string(),
});

export type MemoryContextSource = z.infer<typeof MemoryContextSourceSchema>;
export type MemoryContextStatus = z.infer<typeof MemoryContextStatusSchema>;
export type MemoryContext = z.infer<typeof MemoryContextSchema>;
