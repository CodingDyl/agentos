import type { LearningNote, LearningSource, LearningSourceType, Notebook } from "@shared/learning-types";

/**
 * Learning's rules, without a DOM: how the library is grouped, how notes are
 * filtered, how a typed timestamp is read, how often Spotify is asked what's
 * playing. The page renders what these return.
 */

export const LEARNING_TABS = ["discover", "youtube", "spotify", "notebooks", "saved"] as const;
export type LearningTab = (typeof LEARNING_TABS)[number];

export function isLearningTab(value: string | null): value is LearningTab {
  return (LEARNING_TABS as readonly (string | null)[]).includes(value);
}

/** `90`, `1:30`, `1:02:03` → seconds; anything else → undefined. */
export function parseTimestampInput(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d{1,2}$/.test(part))) return undefined;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part >= 60)) return undefined;
  return numbers.reduce((total, part) => total * 60 + part, 0);
}

/** Where to start a video: an explicit `t`, else where it was left, unless it was finished. */
export function resumeAt(source: Pick<LearningSource, "positionSeconds" | "finished">, requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested) && requested >= 0) return Math.floor(requested);
  if (source.finished || source.positionSeconds < 5) return 0;
  return Math.floor(source.positionSeconds);
}

export function progressShare(source: Pick<LearningSource, "positionSeconds" | "durationSeconds" | "finished">): number | undefined {
  if (source.finished) return 1;
  if (!source.durationSeconds) return undefined;
  return Math.min(1, source.positionSeconds / source.durationSeconds);
}

export interface LibraryGroups {
  continueWatching: LearningSource[];
  watchLater: LearningSource[];
  videos: LearningSource[];
  tracks: LearningSource[];
  archived: LearningSource[];
}

export function groupLibrary(sources: readonly LearningSource[]): LibraryGroups {
  const live = sources.filter((source) => !source.archived);
  return {
    continueWatching: live.filter((source) => source.kind === "youtube" && !source.finished && source.positionSeconds > 5),
    watchLater: live.filter((source) => source.watchLater && !source.finished),
    videos: live.filter((source) => source.kind === "youtube"),
    tracks: live.filter((source) => source.kind === "spotify"),
    archived: sources.filter((source) => source.archived),
  };
}

export interface NoteFilters {
  query: string;
  sourceType: LearningSourceType | "all";
  workspace: string;
  archived: boolean;
}

export function filterNotes(notes: readonly LearningNote[], filters: NoteFilters): LearningNote[] {
  const needle = filters.query.trim().toLowerCase();
  return notes.filter((note) => {
    if (note.archived !== filters.archived) return false;
    if (filters.sourceType !== "all" && note.sourceType !== filters.sourceType) return false;
    if (filters.workspace !== "all" && (note.workspaceId ?? "") !== filters.workspace) return false;
    if (!needle) return true;
    return [note.title, note.content, note.sourceTitle, note.taskId, ...note.tags]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(needle));
  });
}

/**
 * How often to ask Spotify what's playing. Often while music plays on a
 * visible screen (the mini-player shows progress), rarely otherwise: Spotify
 * rate-limits, and an idle AgentOS should not be chatty.
 */
export function playbackPollMs(input: { visible: boolean; playing: boolean; inApp: boolean }): number {
  if (!input.visible) return 30_000;
  if (input.inApp) return 10_000;
  return input.playing ? 4_000 : 15_000;
}

/** The progress to show now, moved on from when it was read while playing. */
export function interpolatedProgress(playback: { isPlaying: boolean; progressMs: number; readAt: string; track?: { durationMs: number } }, now: number): number {
  const elapsed = playback.isPlaying ? Math.max(0, now - new Date(playback.readAt).getTime()) : 0;
  const position = playback.progressMs + elapsed;
  return playback.track?.durationMs ? Math.min(position, playback.track.durationMs) : position;
}

/** `01:12:08` for a focus session. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Everything a notebook was built from, as lines to paste into the notebook tool. */
export function notebookSourceList(notebook: Notebook, sources: readonly LearningSource[], notes: readonly LearningNote[]): string {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const lines = [
    ...notebook.sourceIds.flatMap((id) => {
      const source = byId.get(id);
      return source ? [`${source.title} — ${source.url}`] : [];
    }),
    ...notebook.externalSources.map((source) => (source.url ? `${source.title} — ${source.url}` : source.title)),
    ...notebook.noteIds.flatMap((id) => {
      const note = noteById.get(id);
      return note ? [`Learning: ${note.title}${note.sourceUrl ? ` — ${note.sourceUrl}` : ""}\n${note.content}`] : [];
    }),
  ];
  return lines.join("\n\n");
}

/** Learnings related to a notebook: gathered for it, or captured from one of its sources or from it. */
export function relatedNotes(notebook: Notebook, notes: readonly LearningNote[]): LearningNote[] {
  const sourceIds = new Set(notebook.sourceIds);
  const noteIds = new Set(notebook.noteIds);
  return notes.filter(
    (note) =>
      noteIds.has(note.id) ||
      (note.sourceId !== undefined && sourceIds.has(note.sourceId)) ||
      (notebook.externalUrl !== undefined && note.sourceUrl === notebook.externalUrl),
  );
}

/** `a, #b, a` → `["a", "b"]`. */
export function tagsFromText(text: string): string[] {
  return [...new Set(text.split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 12);
}

/** Where "open the source" goes: back into the in-app player at the moment, when the video is saved here. */
export function sourceHref(note: LearningNote, sources: readonly LearningSource[]): { href: string; internal: boolean } | undefined {
  const source = note.sourceId ? sources.find((entry) => entry.id === note.sourceId) : undefined;
  if (source?.kind === "youtube") {
    const params = new URLSearchParams({ tab: "youtube", video: source.id });
    if (note.timestampSeconds !== undefined) params.set("t", String(Math.floor(note.timestampSeconds)));
    return { href: `/learning?${params.toString()}`, internal: true };
  }
  return note.sourceUrl ? { href: note.sourceUrl, internal: false } : undefined;
}

