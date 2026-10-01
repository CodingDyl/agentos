import { randomUUID } from "node:crypto";
import type { KnowledgeItem, ProjectSummary, SearchHit } from "../../shared/agentos-types";
import {
  formatTimestamp,
  LEARNING_SOURCE_LABELS,
  sourceUrlAt,
  type CreateNoteRequest,
  type LearningNote,
  type PromoteNoteRequest,
  type UpdateNoteRequest,
} from "../../shared/learning-types";
import type { MemoryOutcome } from "../../shared/task-closeout-types";
import { HUMAN } from "../memory/mutations";
import { applyDecision, proposalId } from "../memory/proposals";
import type { MemoryService } from "../memory/service";
import { cleanTags, learningDatabase, parseList } from "./db";
import { getSource, LearningRequestError } from "./library";

/**
 * Learning notes: what a person took away from a video, a track, a notebook
 * or a page, captured at the moment it happened.
 *
 * A note is knowledge, not memory. It shows in Knowledge and in search, it
 * can be linked to a workspace and a task, and it stays the person's own.
 * Only when they choose to promote one — through the same duplicate check and
 * provenance as any proposal — does it become durable memory agents are told.
 */

type Row = Record<string, unknown>;

function toNote(row: Row): LearningNote {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    sourceType: (["youtube", "spotify", "notebook", "manual"] as const).find((type) => type === row.source_type) ?? "manual",
    sourceUrl: typeof row.source_url === "string" ? row.source_url : undefined,
    sourceId: typeof row.source_id === "string" ? row.source_id : undefined,
    sourceTitle: typeof row.source_title === "string" ? row.source_title : undefined,
    timestampSeconds: typeof row.timestamp_seconds === "number" ? row.timestamp_seconds : undefined,
    workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    taskId: typeof row.task_id === "string" ? row.task_id : undefined,
    tags: parseList(row.tags),
    archived: Boolean(row.archived),
    promotedTo: parseList(row.promoted_to),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listNotes(): LearningNote[] {
  return (learningDatabase().prepare("SELECT * FROM notes ORDER BY created_at DESC").all() as Row[]).map(toNote);
}

export function getNote(id: string): LearningNote | undefined {
  const row = learningDatabase().prepare("SELECT * FROM notes WHERE id = ?").get(id) as Row | undefined;
  return row ? toNote(row) : undefined;
}

/** Only http(s) addresses are kept as a source link: never `javascript:` or a file path. */
function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function createNote(request: CreateNoteRequest): LearningNote {
  const source = request.sourceId ? getSource(request.sourceId) : undefined;
  if (request.sourceId && !source) throw new LearningRequestError("That source is not in the library.", 404);

  const sourceType = source ? source.kind : request.sourceType;
  const sourceUrl = sourceUrlAt(sourceType, source?.url ?? safeUrl(request.sourceUrl), request.timestampSeconds);
  const now = new Date().toISOString();
  const id = `ln-${randomUUID().slice(0, 12)}`;

  learningDatabase()
    .prepare(
      `INSERT INTO notes (id, title, content, source_type, source_url, source_id, source_title, timestamp_seconds, workspace_id, task_id, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      request.title.trim(),
      request.content,
      sourceType,
      sourceUrl ?? null,
      source?.id ?? null,
      source?.title ?? null,
      request.timestampSeconds ?? null,
      request.workspaceId ?? source?.workspaceId ?? null,
      request.taskId?.toUpperCase() ?? null,
      JSON.stringify(cleanTags(request.tags)),
      now,
      now,
    );
  return getNote(id)!;
}

export function updateNote(id: string, changes: UpdateNoteRequest): LearningNote {
  const current = getNote(id);
  if (!current) throw new LearningRequestError("There is no learning note with that id.", 404);

  learningDatabase()
    .prepare("UPDATE notes SET title = ?, content = ?, workspace_id = ?, task_id = ?, tags = ?, archived = ?, updated_at = ? WHERE id = ?")
    .run(
      changes.title ?? current.title,
      changes.content ?? current.content,
      changes.workspaceId === null ? null : (changes.workspaceId ?? current.workspaceId ?? null),
      changes.taskId === null ? null : (changes.taskId?.toUpperCase() ?? current.taskId ?? null),
      JSON.stringify(changes.tags ? cleanTags(changes.tags) : current.tags),
      (changes.archived ?? current.archived) ? 1 : 0,
      new Date().toISOString(),
      id,
    );
  return getNote(id)!;
}

export function deleteNote(id: string): void {
  const result = learningDatabase().prepare("DELETE FROM notes WHERE id = ?").run(id);
  if (result.changes === 0) throw new LearningRequestError("There is no learning note with that id.", 404);
}

function where(note: LearningNote): string {
  const label = LEARNING_SOURCE_LABELS[note.sourceType];
  return note.timestampSeconds !== undefined ? `${label} · ${formatTimestamp(note.timestampSeconds)}` : label;
}

export function learningHref(note: LearningNote): string {
  return `/learning?tab=saved&note=${encodeURIComponent(note.id)}`;
}

/**
 * Learnings as Knowledge items. A note linked to a workspace sits under it; one
 * that isn't sits under "Learning", so the workspace filter still reads.
 */
export function knowledgeItems(notes: readonly LearningNote[], projects: readonly ProjectSummary[]): KnowledgeItem[] {
  const names = new Map(projects.map((project) => [project.slug, project]));
  return notes
    .filter((note) => !note.archived)
    .map((note) => {
      const project = note.workspaceId ? names.get(note.workspaceId) : undefined;
      return {
        id: `learning:${note.id}`,
        kind: "learning" as const,
        title: note.title,
        project: project?.slug ?? "learning",
        projectName: project?.name ?? "Learning",
        workspaceType: project?.workspaceType,
        type: "learning" as const,
        taskId: note.taskId,
        updatedAt: note.updatedAt,
        detail: [where(note), note.sourceTitle, note.content.replace(/\s+/g, " ").slice(0, 160)].filter(Boolean).join(" · "),
        href: learningHref(note),
      };
    });
}

/** Learnings as search hits: title, source, tags and the note's text. */
export function searchHits(notes: readonly LearningNote[]): SearchHit[] {
  return notes
    .filter((note) => !note.archived)
    .map((note) => ({
      kind: "learning" as const,
      id: note.id,
      title: note.title,
      detail: [where(note), note.sourceTitle, note.tags.map((tag) => `#${tag}`).join(" "), note.content.replace(/\s+/g, " ").slice(0, 2_000)]
        .filter(Boolean)
        .join(" · "),
      project: note.workspaceId,
      href: learningHref(note),
    }));
}

/**
 * Promotes a learning to memory, with the person's approval — the request
 * *is* that approval, made from the proposal they saw and edited.
 *
 * Goes through the same path as a closeout proposal: duplicate check,
 * provenance (the learning, its source and the moment), re-index. Nothing
 * else turns a note into memory.
 */
export async function promoteNote(service: MemoryService, id: string, request: PromoteNoteRequest): Promise<MemoryOutcome> {
  const note = getNote(id);
  if (!note) throw new LearningRequestError("There is no learning note with that id.", 404);

  const outcome = await applyDecision(
    service,
    {
      proposal: {
        id: proposalId(request.workspaceId, `learning:${note.id}`, request.title),
        type: request.type,
        title: request.title,
        body: request.body,
        project: request.workspaceId,
        sourceTask: note.taskId,
        sourceLearning: note.id,
        sourceUrl: note.sourceUrl,
        proposedBy: HUMAN,
        selected: true,
      },
      action: request.action,
      targetId: request.targetId,
      targetRevision: request.targetRevision,
      acknowledgedDuplicates: request.acknowledgedDuplicates,
    },
    HUMAN,
  );

  if ((outcome.outcome === "created" || outcome.outcome === "updated") && outcome.target) {
    const promotedTo = [...new Set([...note.promotedTo, outcome.target])];
    learningDatabase().prepare("UPDATE notes SET promoted_to = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(promotedTo), new Date().toISOString(), id);
  }
  return outcome;
}
