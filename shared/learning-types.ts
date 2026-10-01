import { z } from "zod";

/**
 * Learning: what was watched, listened to and researched, and what was
 * learned from it.
 *
 * The media itself is never stored. A source is a reference — a video id, a
 * Spotify URI, a notebook link — with the person's own progress and notes
 * around it. What matters is the note: a learning captured at a moment, linked
 * to the work it bears on, that can later be promoted to memory when a person
 * decides it is durable.
 *
 * ```text
 * WATCH / LISTEN / RESEARCH → CAPTURE → KNOWLEDGE → MEMORY PROPOSAL → FUTURE AGENTS
 * ```
 */

export const LEARNING_SOURCE_TYPES = ["youtube", "spotify", "notebook", "manual"] as const;
export const LearningSourceTypeSchema = z.enum(LEARNING_SOURCE_TYPES);
export type LearningSourceType = z.infer<typeof LearningSourceTypeSchema>;

export const LEARNING_SOURCE_LABELS: Record<LearningSourceType, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  notebook: "Notebook",
  manual: "Note",
};

/** Media that can be saved to the library and resumed. */
export const MediaKindSchema = z.enum(["youtube", "spotify"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

const Tags = z.array(z.string().trim().min(1).max(40)).max(12);

export const LearningSourceSchema = z.object({
  id: z.string(),
  kind: MediaKindSchema,
  /** A YouTube video id, or a Spotify URI. */
  externalId: z.string(),
  /** The canonical public URL. Opening the source goes here (or plays in AgentOS). */
  url: z.string(),
  title: z.string(),
  author: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  /** Where the person left off. */
  positionSeconds: z.number().nonnegative(),
  watchLater: z.boolean(),
  finished: z.boolean(),
  archived: z.boolean(),
  workspaceId: z.string().optional(),
  tags: Tags,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().optional(),
});

export type LearningSource = z.infer<typeof LearningSourceSchema>;

export const LearningNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  sourceType: LearningSourceTypeSchema,
  sourceUrl: z.string().optional(),
  /** The library source it was captured from, when there is one. */
  sourceId: z.string().optional(),
  /** The source's title at capture time, so the note reads on its own. */
  sourceTitle: z.string().optional(),
  timestampSeconds: z.number().nonnegative().optional(),
  workspaceId: z.string().optional(),
  taskId: z.string().optional(),
  tags: Tags,
  archived: z.boolean(),
  /** Memory notes this learning was promoted to. */
  promotedTo: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type LearningNote = z.infer<typeof LearningNoteSchema>;

export const NotebookProviderIdSchema = z.enum(["manual", "notebooklm"]);
export type NotebookProviderId = z.infer<typeof NotebookProviderIdSchema>;

/** A research notebook kept beside AgentOS. AgentOS holds the link, not the notebook. */
export const NotebookSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: NotebookProviderIdSchema,
  externalUrl: z.string().optional(),
  description: z.string().optional(),
  workspaceId: z.string().optional(),
  /** Library sources and learning notes gathered for it. */
  sourceIds: z.array(z.string()),
  noteIds: z.array(z.string()),
  /** Anything else named as a source: a document path, an external URL. */
  externalSources: z.array(z.object({ title: z.string(), url: z.string().optional() })),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Notebook = z.infer<typeof NotebookSchema>;

// ------------------------------------------------------------------ requests

const OptionalSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .optional();
const OptionalTaskId = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/i)
  .optional();

export const ImportSourceRequestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  watchLater: z.boolean().optional(),
  workspaceId: OptionalSlug,
  tags: Tags.optional(),
});

export const UpdateSourceRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    watchLater: z.boolean().optional(),
    finished: z.boolean().optional(),
    archived: z.boolean().optional(),
    workspaceId: OptionalSlug.nullable(),
    tags: Tags.optional(),
  })
  .strict();

export const ProgressRequestSchema = z.object({
  positionSeconds: z.number().nonnegative().max(86_400 * 2),
  durationSeconds: z.number().nonnegative().max(86_400 * 2).optional(),
});

export const CreateNoteRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(20_000),
  sourceType: LearningSourceTypeSchema,
  sourceId: z.string().max(80).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  timestampSeconds: z.number().nonnegative().max(86_400 * 2).optional(),
  workspaceId: OptionalSlug,
  taskId: OptionalTaskId,
  tags: Tags.optional(),
});

export const UpdateNoteRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(20_000).optional(),
    workspaceId: OptionalSlug.nullable(),
    taskId: OptionalTaskId.nullable(),
    tags: Tags.optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const CreateNotebookRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  externalUrl: z.string().url().max(2000).optional(),
  description: z.string().max(2000).optional(),
  workspaceId: OptionalSlug,
  sourceIds: z.array(z.string()).max(100).optional(),
  noteIds: z.array(z.string()).max(200).optional(),
  externalSources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(2000).optional() })).max(100).optional(),
});

export const UpdateNotebookRequestSchema = CreateNotebookRequestSchema.partial().strict();

export const PromoteNoteRequestSchema = z.object({
  /** The workspace the memory belongs to. Memory is always scoped to one. */
  workspaceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  type: z.enum(["pattern", "lesson", "decision", "constraint", "business-rule", "fact"]),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(1).max(4000),
  action: z.enum(["create", "update"]),
  targetId: z.string().optional(),
  targetRevision: z.string().optional(),
  acknowledgedDuplicates: z.boolean().optional(),
});

export type ImportSourceRequest = z.infer<typeof ImportSourceRequestSchema>;
export type UpdateSourceRequest = z.infer<typeof UpdateSourceRequestSchema>;
export type ProgressRequest = z.infer<typeof ProgressRequestSchema>;
export type CreateNoteRequest = z.infer<typeof CreateNoteRequestSchema>;
export type UpdateNoteRequest = z.infer<typeof UpdateNoteRequestSchema>;
export type CreateNotebookRequest = z.infer<typeof CreateNotebookRequestSchema>;
export type UpdateNotebookRequest = z.infer<typeof UpdateNotebookRequestSchema>;
export type PromoteNoteRequest = z.infer<typeof PromoteNoteRequestSchema>;

export interface LearningLibrary {
  sources: LearningSource[];
  notes: LearningNote[];
  notebooks: Notebook[];
}

// ------------------------------------------------------------------- spotify

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  /** Display name of the signed-in account. */
  account?: string;
  /** Premium is required for playback control and in-app playback. */
  premium?: boolean;
  /** Why it isn't usable, in words that point at the fix. */
  detail?: string;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: string[];
  album?: string;
  imageUrl?: string;
  durationMs: number;
  /** "track" or "episode". */
  type: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  active: boolean;
  volumePercent?: number;
}

export interface SpotifyPlayback {
  isPlaying: boolean;
  progressMs: number;
  track?: SpotifyTrack;
  device?: SpotifyDevice;
  /** The playlist or album being played, when there is one. */
  contextUri?: string;
  /** When this was read, so the client can interpolate the progress. */
  readAt: string;
}

export interface SpotifyPlaylist {
  id: string;
  uri: string;
  name: string;
  imageUrl?: string;
  trackCount?: number;
  owner?: string;
}

export interface SpotifyLibrary {
  saved: SpotifyTrack[];
  recent: Array<SpotifyTrack & { playedAt: string }>;
}

export const SpotifyPlayRequestSchema = z.object({
  contextUri: z.string().regex(/^spotify:(playlist|album|artist|show):[A-Za-z0-9]{1,64}$/).optional(),
  uris: z.array(z.string().regex(/^spotify:(track|episode):[A-Za-z0-9]{1,64}$/)).max(50).optional(),
  deviceId: z.string().max(100).optional(),
  positionMs: z.number().int().nonnegative().optional(),
});

export type SpotifyPlayRequest = z.infer<typeof SpotifyPlayRequestSchema>;

/** `12:05` or `1:02:03`. */
export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The public URL that opens a source at a moment: YouTube honours `t=`. */
export function sourceUrlAt(kind: LearningSourceType, url: string | undefined, seconds: number | undefined): string | undefined {
  if (!url) return undefined;
  if (kind !== "youtube" || seconds === undefined) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("t", `${Math.floor(seconds)}s`);
    return parsed.toString();
  } catch {
    return url;
  }
}
