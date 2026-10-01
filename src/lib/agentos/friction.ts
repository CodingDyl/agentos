import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FrictionItem, FrictionResponse, FrictionStatus, ReportFrictionRequest } from "@shared/friction-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/** The friction inbox: report from anywhere, review under Operations. */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Friction could not be read.", response.status);
  }
  return payload as T;
}

export const frictionKey = () => [...agentosKeys.all, "friction"] as const;

export function useFriction() {
  return useQuery({
    queryKey: frictionKey(),
    queryFn: () => request<FrictionResponse>("/api/friction"),
    networkMode: "always",
  });
}

export function useReportFriction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (report: ReportFrictionRequest) =>
      request<FrictionItem>("/api/friction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: frictionKey() }),
    networkMode: "always",
    retry: 0,
  });
}

export function useUpdateFriction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: FrictionStatus }) =>
      request<FrictionItem>(`/api/friction/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: frictionKey() }),
    networkMode: "always",
    retry: 0,
  });
}
