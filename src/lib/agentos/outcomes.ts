import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LogOwnerHoursRequest, OutcomesResponse, OwnerHoursEntry } from "@shared/outcomes-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/** The outcomes scorecard: what agent work earned, and the hours behind it. */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "The scorecard could not be read.", response.status);
  }
  return payload as T;
}

export const outcomesKey = () => [...agentosKeys.all, "outcomes"] as const;

export function useOutcomes() {
  return useQuery({
    queryKey: outcomesKey(),
    queryFn: () => request<OutcomesResponse>("/api/outcomes"),
    networkMode: "always",
  });
}

export function useLogOwnerHours() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (entry: LogOwnerHoursRequest) =>
      request<OwnerHoursEntry>("/api/outcomes/hours", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: outcomesKey() }),
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteOwnerHours() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/api/outcomes/hours/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: outcomesKey() }),
    networkMode: "always",
    retry: 0,
  });
}
