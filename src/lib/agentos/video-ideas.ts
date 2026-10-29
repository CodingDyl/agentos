import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  WORKING_STAGES,
  type DecideRequest,
  type StartIdeaRequest,
  type VideoIdea,
  type VideoIdeaReadiness,
} from "@shared/video-ideas-types";
import { AgentOSRequestError } from "./client";
import { learningKey } from "./learning";
import { memoryKey } from "./memory";
import { agentosKeys } from "./queries";

/**
 * Video ideas: a saved video's note, its assessment against AgentOS, and the
 * build an approval starts. Polls while anything is working without Dylan.
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?", undefined);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Video ideas could not be read.", response.status);
  }
  return payload as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const videoIdeasKey = () => [...agentosKeys.all, "video-ideas"] as const;

const isWorking = (idea: VideoIdea) => WORKING_STAGES.includes(idea.stage) || (idea.stage === "noted" && idea.mode === "assess");

export function useVideoIdeas() {
  return useQuery({
    queryKey: videoIdeasKey(),
    queryFn: () => request<{ ideas: VideoIdea[] }>("/api/video-ideas"),
    select: (data) => data.ideas,
    refetchInterval: (query) => (query.state.data?.ideas.some(isWorking) ? 5_000 : 30_000),
    networkMode: "always",
  });
}

export function useVideoIdea(id: string) {
  return useQuery({
    queryKey: [...videoIdeasKey(), id],
    queryFn: () => request<{ idea: VideoIdea }>(`/api/video-ideas/${encodeURIComponent(id)}`),
    select: (data) => data.idea,
    refetchInterval: (query) => (query.state.data && isWorking(query.state.data.idea) ? 5_000 : false),
    networkMode: "always",
  });
}

export function useIdeaAssessment(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...videoIdeasKey(), id, "assessment"],
    queryFn: () => request<{ markdown: string; path: string }>(`/api/video-ideas/${encodeURIComponent(id)}/assessment`),
    enabled,
    networkMode: "always",
  });
}

export function useVideoIdeaReadiness() {
  return useQuery({
    queryKey: [...videoIdeasKey(), "readiness"],
    queryFn: () => request<VideoIdeaReadiness>("/api/video-ideas/readiness"),
    staleTime: 60_000,
    networkMode: "always",
  });
}

function useIdeaMutation<Input>(run: (input: Input) => Promise<{ idea: VideoIdea }>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: videoIdeasKey() });
      // A note lands in Learning and in the vault.
      void client.invalidateQueries({ queryKey: learningKey() });
      void client.invalidateQueries({ queryKey: memoryKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useStartIdea() {
  return useIdeaMutation((input: StartIdeaRequest) => post<{ idea: VideoIdea }>("/api/video-ideas", input));
}

export function useDecideIdea() {
  return useIdeaMutation(({ id, ...body }: DecideRequest & { id: string }) => post<{ idea: VideoIdea }>(`/api/video-ideas/${encodeURIComponent(id)}/decide`, body));
}

export function usePasteTranscript() {
  return useIdeaMutation(({ id, text }: { id: string; text: string }) => post<{ idea: VideoIdea }>(`/api/video-ideas/${encodeURIComponent(id)}/transcript`, { text }));
}

export function useRetryIdea() {
  return useIdeaMutation((id: string) => post<{ idea: VideoIdea }>(`/api/video-ideas/${encodeURIComponent(id)}/retry`));
}

export function transcriptDownloadUrl(sourceId: string): string {
  return `/api/video-ideas/sources/${encodeURIComponent(sourceId)}/transcript.txt`;
}
