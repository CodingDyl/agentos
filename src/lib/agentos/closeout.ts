import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompleteTaskRequest, CompleteTaskResponse, TaskCloseoutDraft } from "@shared/task-closeout-types";
import { AgentOSRequestError } from "./client";
import { memoryKey, MemoryRequestError } from "./memory";
import { agentosKeys } from "./queries";

/**
 * A task's closeout, read before completion and sent with it.
 *
 * Completing invalidates the project (TASKS.md and STATUS.md moved), the
 * delegations, memory (notes were written) and activity.
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new MemoryRequestError(failure?.error ?? "The closeout could not be read.", response.status, payload as Record<string, unknown> | null);
  }
  return payload as T;
}

const closeoutPath = (slug: string, taskId: string) =>
  `/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`;

export const closeoutKey = (slug: string, taskId: string) => [...agentosKeys.all, "task-closeout", slug, taskId] as const;

export function useTaskCloseout(slug: string, taskId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: closeoutKey(slug, taskId ?? ""),
    queryFn: () => request<TaskCloseoutDraft>(`${closeoutPath(slug, taskId as string)}/closeout`),
    enabled: Boolean(taskId) && enabled,
    networkMode: "always",
    retry: false,
    // A closeout being reviewed must not be swapped out from under the person.
    refetchOnWindowFocus: false,
  });
}

export function useCompleteTaskWithCloseout(slug: string, taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CompleteTaskRequest) =>
      request<CompleteTaskResponse>(`${closeoutPath(slug, taskId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: agentosKeys.project(slug) });
      void client.invalidateQueries({ queryKey: agentosKeys.editableTasks(slug) });
      void client.invalidateQueries({ queryKey: agentosKeys.taskDelegations(slug) });
      void client.invalidateQueries({ queryKey: agentosKeys.taskCompletion(slug, taskId) });
      void client.invalidateQueries({ queryKey: closeoutKey(slug, taskId) });
      void client.invalidateQueries({ queryKey: memoryKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}
