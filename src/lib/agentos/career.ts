import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CareerData,
  CareerMemoryRequest,
  CareerTaskMetaPatch,
  CurrentWorkInput,
  EvidenceInput,
  GrowthProfileInput,
  LinkedInPost,
  RoutineId,
  RoutinePatch,
  SoccerDefaults,
  TimesheetRun,
  WorkLogInput,
} from "@shared/career-types";
import type { MemoryOutcome } from "@shared/task-closeout-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Career's client and queries. One read, many small writes; every write
 * re-reads Career (and Today, which shows Career's due items), so the numbers
 * on screen are always the server's.
 */

export const careerKey = () => [...agentosKeys.all, "career"] as const;

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(failure?.error ?? "Career could not be updated.", response.status);
  }
  return payload as T;
}

const json = (method: string, body: unknown = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const id = (value: string) => encodeURIComponent(value);

export function useCareer() {
  return useQuery({
    queryKey: careerKey(),
    queryFn: () => request<CareerData>("/api/career"),
    staleTime: 15_000,
    refetchInterval: 120_000,
    retry: 1,
    networkMode: "always",
  });
}

function useCareerMutation<V, R = unknown>(fn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: careerKey() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.missionControl() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export const useSaveCurrentWork = () => useCareerMutation((input: CurrentWorkInput) => request("/api/career/current-work", json("PUT", input)));

export const useSaveTaskMeta = () =>
  useCareerMutation(({ taskId, patch }: { taskId: string; patch: CareerTaskMetaPatch }) =>
    request(`/api/career/tasks/${id(taskId)}/meta`, json("PATCH", patch)),
  );

export const useAddWorkLog = () => useCareerMutation((input: WorkLogInput) => request("/api/career/work-log", json("POST", input)));
export const useDeleteWorkLog = () => useCareerMutation((entryId: string) => request(`/api/career/work-log/${id(entryId)}`, { method: "DELETE" }));

export const useSaveGrowthProfile = () => useCareerMutation((input: GrowthProfileInput) => request("/api/career/growth/profile", json("PATCH", input)));
export const useAddGoal = () => useCareerMutation((text: string) => request("/api/career/growth/goals", json("POST", { text })));
export const useSetGoalStatus = () =>
  useCareerMutation(({ goalId, status }: { goalId: string; status: "active" | "done" | "dropped" }) =>
    request(`/api/career/growth/goals/${id(goalId)}`, json("PATCH", { status })),
  );
export const useAddEvidence = () => useCareerMutation((input: EvidenceInput) => request("/api/career/growth/evidence", json("POST", input)));
export const useDeleteEvidence = () => useCareerMutation((evidenceId: string) => request(`/api/career/growth/evidence/${id(evidenceId)}`, { method: "DELETE" }));
export const useSuggestGrowth = () => useCareerMutation(() => request("/api/career/growth/suggestions", json("POST")));
export const useAcceptSuggestion = () =>
  useCareerMutation((suggestionId: string) => request(`/api/career/growth/suggestions/${id(suggestionId)}/accept`, json("POST")));
export const useDismissSuggestion = () =>
  useCareerMutation((suggestionId: string) => request(`/api/career/growth/suggestions/${id(suggestionId)}`, { method: "DELETE" }));

export const useSaveCareerMemory = () =>
  useCareerMutation((input: CareerMemoryRequest) => request<{ outcome: MemoryOutcome }>("/api/career/memory", json("POST", input)));

export const usePatchRoutine = () =>
  useCareerMutation(({ routineId, patch }: { routineId: RoutineId; patch: RoutinePatch }) =>
    request(`/api/career/routines/${id(routineId)}`, json("PATCH", patch)),
  );
export const useCompleteRoutine = () => useCareerMutation((routineId: RoutineId) => request(`/api/career/routines/${id(routineId)}/complete`, json("POST")));

export const useRunTimesheet = () =>
  useCareerMutation((weekStart?: string) => request<TimesheetRun>("/api/career/timesheet/run", json("POST", weekStart ? { weekStart } : {})));
export const useReviewTimesheet = () => useCareerMutation((runId: string) => request<TimesheetRun>(`/api/career/timesheet/${id(runId)}/review`, json("POST")));
export const useMarkTimesheetSubmitted = () =>
  useCareerMutation(({ runId, acceptUnmapped }: { runId: string; acceptUnmapped: boolean }) =>
    request<TimesheetRun>(`/api/career/timesheet/${id(runId)}/submitted`, json("POST", { acceptUnmapped })),
  );

export const useSaveSoccerDefaults = () => useCareerMutation((input: Partial<SoccerDefaults>) => request("/api/career/soccer/defaults", json("PUT", input)));
export const useRecordSoccerEvent = () =>
  useCareerMutation((input: { date: string; link: string }) => request("/api/career/soccer/events", json("POST", input)));

export const useAddPostIdea = () => useCareerMutation((input: { idea: string; source?: string }) => request<LinkedInPost>("/api/career/linkedin/posts", json("POST", input)));
export const usePatchPost = () =>
  useCareerMutation(({ postId, patch }: { postId: string; patch: { idea?: string; draft?: string; status?: "idea" | "draft" | "approved" } }) =>
    request<LinkedInPost>(`/api/career/linkedin/posts/${id(postId)}`, json("PATCH", patch)),
  );
export const useDeletePost = () => useCareerMutation((postId: string) => request(`/api/career/linkedin/posts/${id(postId)}`, { method: "DELETE" }));
export const useDraftPost = () => useCareerMutation((postId: string) => request<LinkedInPost>(`/api/career/linkedin/posts/${id(postId)}/draft`, json("POST")));
export const usePublishPost = () => useCareerMutation((postId: string) => request<LinkedInPost>(`/api/career/linkedin/posts/${id(postId)}/publish`, json("POST")));

/**
 * Opens a Career link through its capability. The window is opened before the
 * request so the browser treats it as the click's popup, then pointed at the
 * address the server returns — or closed if the capability is switched off.
 */
export async function openCareerResource(resourceId: string): Promise<void> {
  const opened = window.open("about:blank", "_blank");
  try {
    const { url } = await request<{ url: string }>(`/api/career/resources/${id(resourceId)}/open`, json("POST"));
    if (opened) {
      opened.opener = null;
      opened.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    opened?.close();
    throw error;
  }
}
