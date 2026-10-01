import { randomUUID } from "node:crypto";
import type { LearningSource, ProgressRequest, UpdateSourceRequest } from "../../shared/learning-types";
import { authorize, isConnectorEnabled } from "../connectors/policy";
import { cleanTags, learningDatabase, parseList } from "./db";
import { parseSpotifyUrl, spotifyOpenUrl, fetchSpotifyMetadata } from "./spotify-urls";
import { fetchYouTubeMetadata, parseYouTubeUrl, watchUrl } from "./youtube";

/**
 * The media library: what has been saved to watch or listen to, and where
 * the person left off. One row per video or track, keyed by its id at the
 * source, so saving the same thing twice finds the first.
 */

export class LearningRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

type Row = Record<string, unknown>;

function toSource(row: Row): LearningSource {
  return {
    id: String(row.id),
    kind: row.kind === "spotify" ? "spotify" : "youtube",
    externalId: String(row.external_id),
    url: String(row.url),
    title: String(row.title),
    author: typeof row.author === "string" ? row.author : undefined,
    thumbnailUrl: typeof row.thumbnail_url === "string" ? row.thumbnail_url : undefined,
    durationSeconds: typeof row.duration_seconds === "number" ? row.duration_seconds : undefined,
    positionSeconds: Number(row.position_seconds ?? 0),
    watchLater: Boolean(row.watch_later),
    finished: Boolean(row.finished),
    archived: Boolean(row.archived),
    workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    tags: parseList(row.tags),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastOpenedAt: typeof row.last_opened_at === "string" ? row.last_opened_at : undefined,
  };
}

export function listSources(): LearningSource[] {
  return (learningDatabase().prepare("SELECT * FROM sources ORDER BY COALESCE(last_opened_at, created_at) DESC").all() as Row[]).map(toSource);
}

export function getSource(id: string): LearningSource | undefined {
  const row = learningDatabase().prepare("SELECT * FROM sources WHERE id = ?").get(id) as Row | undefined;
  return row ? toSource(row) : undefined;
}

function findByExternal(kind: string, externalId: string): LearningSource | undefined {
  const row = learningDatabase().prepare("SELECT * FROM sources WHERE kind = ? AND external_id = ?").get(kind, externalId) as Row | undefined;
  return row ? toSource(row) : undefined;
}

export interface ImportResult {
  source: LearningSource;
  created: boolean;
  /** A `t=` in the pasted address, to start playback there. */
  startSeconds?: number;
}

/** Saves a YouTube or Spotify address to the library. Saving again returns the same source. */
export async function importSource(
  input: { url: string; watchLater?: boolean; workspaceId?: string; tags?: string[] },
  fetcher: typeof fetch = fetch,
): Promise<ImportResult> {
  const youtube = parseYouTubeUrl(input.url);
  const spotify = youtube ? undefined : parseSpotifyUrl(input.url);
  if (!youtube && !spotify) {
    throw new LearningRequestError("That isn't a YouTube video or a Spotify track, episode, album or playlist address.");
  }

  // Off in Connectors means AgentOS doesn't contact the service at all.
  if (youtube) {
    const decision = authorize("youtube.import_video", { initiator: "person", detail: youtube.videoId });
    if (!decision.allowed) throw new LearningRequestError(decision.reason, 409);
  }
  const contactSpotify = Boolean(spotify) && isConnectorEnabled("spotify");

  const kind = youtube ? "youtube" : "spotify";
  const externalId = youtube ? youtube.videoId : spotify!.uri;
  const existing = findByExternal(kind, externalId);
  if (existing) {
    const changes: UpdateSourceRequest = {};
    if (input.watchLater) changes.watchLater = true;
    if (input.workspaceId && !existing.workspaceId) changes.workspaceId = input.workspaceId;
    if (input.tags?.length) changes.tags = [...existing.tags, ...input.tags];
    const source = Object.keys(changes).length > 0 ? updateSource(existing.id, changes) : existing;
    return { source, created: false, startSeconds: youtube?.startSeconds };
  }

  const metadata = youtube
    ? await fetchYouTubeMetadata(youtube.videoId, fetcher)
    : contactSpotify
      ? await fetchSpotifyMetadata(spotify!, fetcher)
      : { title: `Spotify ${spotify!.type}`, author: undefined, thumbnailUrl: undefined };
  const now = new Date().toISOString();
  const id = `ls-${randomUUID().slice(0, 12)}`;
  learningDatabase()
    .prepare(
      `INSERT INTO sources (id, kind, external_id, url, title, author, thumbnail_url, position_seconds, watch_later, workspace_id, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      kind,
      externalId,
      youtube ? watchUrl(youtube.videoId) : spotifyOpenUrl(spotify!),
      metadata.title,
      metadata.author ?? null,
      metadata.thumbnailUrl ?? null,
      input.watchLater ? 1 : 0,
      input.workspaceId ?? null,
      JSON.stringify(cleanTags(input.tags)),
      now,
      now,
    );

  return { source: getSource(id)!, created: true, startSeconds: youtube?.startSeconds };
}

export function updateSource(id: string, changes: UpdateSourceRequest): LearningSource {
  const current = getSource(id);
  if (!current) throw new LearningRequestError("There is no saved source with that id.", 404);

  const next = {
    title: changes.title ?? current.title,
    watchLater: changes.watchLater ?? current.watchLater,
    finished: changes.finished ?? current.finished,
    archived: changes.archived ?? current.archived,
    workspaceId: changes.workspaceId === null ? undefined : (changes.workspaceId ?? current.workspaceId),
    tags: changes.tags ? cleanTags(changes.tags) : current.tags,
  };

  learningDatabase()
    .prepare("UPDATE sources SET title = ?, watch_later = ?, finished = ?, archived = ?, workspace_id = ?, tags = ?, updated_at = ? WHERE id = ?")
    .run(
      next.title,
      next.watchLater ? 1 : 0,
      next.finished ? 1 : 0,
      next.archived ? 1 : 0,
      next.workspaceId ?? null,
      JSON.stringify(next.tags),
      new Date().toISOString(),
      id,
    );
  return getSource(id)!;
}

/** Within this many seconds of the end, a video counts as finished. */
const FINISHED_MARGIN = 20;

/**
 * Where playback is. Called every few seconds while something plays, so it is
 * one small UPDATE. Reaching the end marks the source finished and takes it
 * off Watch later; the position is kept so it can still be resumed.
 */
export function recordProgress(id: string, progress: ProgressRequest): LearningSource {
  const current = getSource(id);
  if (!current) throw new LearningRequestError("There is no saved source with that id.", 404);

  const duration = progress.durationSeconds && progress.durationSeconds > 0 ? progress.durationSeconds : current.durationSeconds;
  const position = duration ? Math.min(progress.positionSeconds, duration) : progress.positionSeconds;
  const finished = current.finished || Boolean(duration && duration > FINISHED_MARGIN * 2 && position >= duration - FINISHED_MARGIN);
  const now = new Date().toISOString();

  learningDatabase()
    .prepare("UPDATE sources SET position_seconds = ?, duration_seconds = ?, finished = ?, watch_later = ?, last_opened_at = ?, updated_at = ? WHERE id = ?")
    .run(position, duration ?? null, finished ? 1 : 0, finished ? 0 : current.watchLater ? 1 : 0, now, now, id);
  return getSource(id)!;
}

/** Removes a source from the library. Notes captured from it keep their link back to the original. */
export function deleteSource(id: string): void {
  const result = learningDatabase().prepare("DELETE FROM sources WHERE id = ?").run(id);
  if (result.changes === 0) throw new LearningRequestError("There is no saved source with that id.", 404);
}

/** Sources that were started and not finished, most recent first. */
export function continueWatching(sources: readonly LearningSource[]): LearningSource[] {
  return sources.filter((source) => !source.archived && !source.finished && source.positionSeconds > 5).slice(0, 12);
}
