import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateNotebookRequest,
  CreateNoteRequest,
  ImportSourceRequest,
  LearningLibrary,
  LearningNote,
  LearningSource,
  Notebook,
  PromoteNoteRequest,
  SpotifyDevice,
  SpotifyLibrary,
  SpotifyPlayback,
  SpotifyPlaylist,
  SpotifyPlayRequest,
  SpotifyStatus,
  UpdateNotebookRequest,
  UpdateNoteRequest,
  UpdateSourceRequest,
} from "@shared/learning-types";
import type { MemoryOutcome } from "@shared/task-closeout-types";
import { AgentOSRequestError } from "./client";
import { memoryKey } from "./memory";
import { agentosKeys } from "./queries";

/**
 * Learning's client: the library, notes, notebooks, and the Spotify proxy.
 *
 * Spotify is only ever reached through `/api/spotify`; the browser holds no
 * Spotify credential. The one exception is the Web Playback SDK, which asks
 * for a short-lived token through `fetchSpotifySdkToken` and keeps it nowhere.
 */

export class LearningRequestError extends AgentOSRequestError {
  constructor(
    message: string,
    status: number | undefined,
    readonly code?: string,
  ) {
    super(message, status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new LearningRequestError("The AgentOS data adapter is not responding. Is it running?", undefined);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: string; code?: string } | null;
    throw new LearningRequestError(failure?.error ?? "Learning could not be read.", response.status, failure?.code);
  }
  return payload as T;
}

function send<T>(path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const learningKey = () => [...agentosKeys.all, "learning"] as const;
export const spotifyKey = () => [...agentosKeys.all, "spotify"] as const;

export function useLearningLibrary() {
  return useQuery({
    queryKey: learningKey(),
    queryFn: () => request<LearningLibrary>("/api/learning"),
    networkMode: "always",
  });
}

function useLearningMutation<Input, Output>(run: (input: Input) => Promise<Output>, alsoMemory = false) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: learningKey() });
      // Notes show in Knowledge and search.
      void client.invalidateQueries({ queryKey: agentosKeys.knowledge() });
      if (alsoMemory) void client.invalidateQueries({ queryKey: memoryKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useImportSource() {
  return useLearningMutation((input: ImportSourceRequest) =>
    send<{ source: LearningSource; created: boolean; startSeconds?: number }>("/api/learning/sources", "POST", input),
  );
}

export function useUpdateSource() {
  return useLearningMutation(({ id, ...changes }: UpdateSourceRequest & { id: string }) =>
    send<LearningSource>(`/api/learning/sources/${encodeURIComponent(id)}`, "PATCH", changes),
  );
}

export function useDeleteSource() {
  return useLearningMutation((id: string) => send<{ ok: true }>(`/api/learning/sources/${encodeURIComponent(id)}`, "DELETE"));
}

/** Fire-and-forget progress, outside React Query so a save every few seconds doesn't refetch the page. */
export function saveProgress(id: string, positionSeconds: number, durationSeconds?: number, keepalive = false): Promise<void> {
  return fetch(`/api/learning/sources/${encodeURIComponent(id)}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positionSeconds, durationSeconds }),
    keepalive,
  }).then(
    () => undefined,
    () => undefined,
  );
}

export function useCreateLearningNote() {
  return useLearningMutation((input: CreateNoteRequest) => send<LearningNote>("/api/learning/notes", "POST", input));
}

export function useUpdateLearningNote() {
  return useLearningMutation(({ id, ...changes }: UpdateNoteRequest & { id: string }) =>
    send<LearningNote>(`/api/learning/notes/${encodeURIComponent(id)}`, "PATCH", changes),
  );
}

export function useDeleteLearningNote() {
  return useLearningMutation((id: string) => send<{ ok: true }>(`/api/learning/notes/${encodeURIComponent(id)}`, "DELETE"));
}

export function usePromoteLearningNote() {
  return useLearningMutation(
    ({ id, ...body }: PromoteNoteRequest & { id: string }) =>
      send<{ outcome: MemoryOutcome; note: LearningNote }>(`/api/learning/notes/${encodeURIComponent(id)}/promote`, "POST", body),
    true,
  );
}

export function useCreateNotebook() {
  return useLearningMutation((input: CreateNotebookRequest) => send<Notebook>("/api/learning/notebooks", "POST", input));
}

export function useUpdateNotebook() {
  return useLearningMutation(({ id, ...changes }: UpdateNotebookRequest & { id: string }) =>
    send<Notebook>(`/api/learning/notebooks/${encodeURIComponent(id)}`, "PATCH", changes),
  );
}

export function useDeleteNotebook() {
  return useLearningMutation((id: string) => send<{ ok: true }>(`/api/learning/notebooks/${encodeURIComponent(id)}`, "DELETE"));
}

// ------------------------------------------------------------------- spotify

export function useSpotifyStatus() {
  return useQuery({
    queryKey: [...spotifyKey(), "status"],
    queryFn: () => request<SpotifyStatus>("/api/spotify/status"),
    staleTime: 30_000,
    networkMode: "always",
  });
}

/** `intervalFor` is asked after each read, with whether music is playing. */
export function useSpotifyPlayback(enabled: boolean, intervalFor: (playing: boolean) => number) {
  return useQuery({
    queryKey: [...spotifyKey(), "player"],
    queryFn: () => request<{ playback: SpotifyPlayback | null }>("/api/spotify/player"),
    enabled,
    refetchInterval: (query) => (enabled ? intervalFor(Boolean(query.state.data?.playback?.isPlaying)) : false),
    networkMode: "always",
    retry: false,
  });
}

export function useSpotifyPlaylists(enabled: boolean) {
  return useQuery({
    queryKey: [...spotifyKey(), "playlists"],
    queryFn: () => request<{ playlists: SpotifyPlaylist[] }>("/api/spotify/playlists"),
    enabled,
    staleTime: 5 * 60_000,
    networkMode: "always",
    retry: false,
  });
}

export function useSpotifyMusicLibrary(enabled: boolean) {
  return useQuery({
    queryKey: [...spotifyKey(), "library"],
    queryFn: () => request<SpotifyLibrary>("/api/spotify/library"),
    enabled,
    staleTime: 60_000,
    networkMode: "always",
    retry: false,
  });
}

export function useSpotifyDevices(enabled: boolean) {
  return useQuery({
    queryKey: [...spotifyKey(), "devices"],
    queryFn: () => request<{ devices: SpotifyDevice[] }>("/api/spotify/devices"),
    enabled,
    staleTime: 10_000,
    networkMode: "always",
    retry: false,
  });
}

export type SpotifyCommand =
  | { kind: "play"; request?: SpotifyPlayRequest }
  | { kind: "pause" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "seek"; positionMs: number }
  | { kind: "volume"; percent: number }
  | { kind: "transfer"; deviceId: string; play?: boolean };

export function sendSpotifyCommand(command: SpotifyCommand): Promise<unknown> {
  switch (command.kind) {
    case "play":
      return send("/api/spotify/player/play", "POST", command.request ?? {});
    case "pause":
      return send("/api/spotify/player/pause", "POST");
    case "next":
    case "previous":
      return send(`/api/spotify/player/${command.kind}`, "POST");
    case "seek":
      return send("/api/spotify/player/seek", "PUT", { positionMs: Math.floor(command.positionMs) });
    case "volume":
      return send("/api/spotify/player/volume", "PUT", { percent: command.percent });
    case "transfer":
      return send("/api/spotify/player/transfer", "PUT", { deviceId: command.deviceId, play: command.play });
  }
}

export function useSpotifyCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: sendSpotifyCommand,
    // Spotify applies a command a beat after it answers; read again shortly after.
    onSettled: () => {
      setTimeout(() => void client.invalidateQueries({ queryKey: [...spotifyKey(), "player"] }), 400);
    },
    networkMode: "always",
    retry: 0,
  });
}

/** For the Web Playback SDK's `getOAuthToken` callback only. Never stored. */
export async function fetchSpotifySdkToken(): Promise<string> {
  const { accessToken } = await send<{ accessToken: string }>("/api/spotify/sdk-token", "POST");
  return accessToken;
}
