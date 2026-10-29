import { randomUUID } from "node:crypto";
import { VideoIdeaSchema, type IdeaMode, type Verdict, type VideoIdea } from "../../shared/video-ideas-types";
import { learningDatabase } from "../learning/db";

/**
 * Video ideas, kept in the learning database beside the sources they come
 * from. One idea per source: pasting the same video again finds it.
 */

export class VideoIdeaError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function parse(row: unknown): VideoIdea | undefined {
  if (!row || typeof row !== "object") return undefined;
  try {
    const result = VideoIdeaSchema.safeParse(JSON.parse(String((row as { data: unknown }).data)));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function getIdea(id: string): VideoIdea | undefined {
  return parse(learningDatabase().prepare("SELECT data FROM video_ideas WHERE id = ?").get(id));
}

export function ideaForSource(sourceId: string): VideoIdea | undefined {
  return parse(learningDatabase().prepare("SELECT data FROM video_ideas WHERE source_id = ?").get(sourceId));
}

/** Newest first. */
export function listIdeas(): VideoIdea[] {
  return learningDatabase()
    .prepare("SELECT data FROM video_ideas ORDER BY created_at DESC")
    .all()
    .flatMap((row) => parse(row) ?? []);
}

function save(idea: VideoIdea): VideoIdea {
  const checked = VideoIdeaSchema.parse(idea);
  learningDatabase()
    .prepare(
      `INSERT INTO video_ideas (id, source_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(checked.id, checked.sourceId, JSON.stringify(checked), checked.createdAt, checked.updatedAt);
  return checked;
}

/**
 * Starts an idea for a saved YouTube source, or returns the one it has.
 * Asking to assess a video that was only learned upgrades it; nothing is
 * ever downgraded, and the stage is left where it is.
 */
export function createIdea(source: { id: string; externalId: string; title: string }, mode: IdeaMode): VideoIdea {
  const existing = ideaForSource(source.id);
  if (existing) {
    return existing.mode === "learn" && mode === "assess" ? updateIdea(existing.id, { mode }) : existing;
  }
  const now = new Date().toISOString();
  return save({
    id: `vi-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    sourceId: source.id,
    videoId: source.externalId,
    title: source.title,
    mode,
    stage: "transcribing",
    stageStartedAt: now,
    taskIds: [],
    runs: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function updateIdea(id: string, changes: Partial<Omit<VideoIdea, "id" | "sourceId" | "createdAt">>): VideoIdea {
  const current = getIdea(id);
  if (!current) throw new VideoIdeaError("There is no video idea with that id.", 404);
  const now = new Date().toISOString();
  const moved = changes.stage !== undefined && changes.stage !== current.stage;
  return save({ ...current, ...(moved ? { stageStartedAt: now } : {}), ...changes, updatedAt: now });
}

export interface PastDecision {
  title: string;
  verdict?: Verdict;
  decision: "declined" | "approved";
  reason?: string;
}

/** What Dylan decided before, newest first, so assessments learn his taste. */
export function pastDecisions(limit = 20): PastDecision[] {
  const approved = new Set(["planning", "building", "built"]);
  return listIdeas()
    .filter((idea) => idea.stage === "declined" || approved.has(idea.stage) || (idea.stage === "failed" && idea.taskIds.length > 0))
    .slice(0, limit)
    .map((idea) => ({
      title: idea.title,
      verdict: idea.verdict,
      decision: idea.stage === "declined" ? "declined" : "approved",
      ...(idea.declineReason ? { reason: idea.declineReason } : {}),
    }));
}
