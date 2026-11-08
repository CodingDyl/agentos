import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssignToAgentRequest, CompleteRepairRequest, FrictionItem, FrictionResponse, FrictionStatus, ReportFrictionRequest, SetRegressionRequest } from "@shared/friction-types";
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
    mutationFn: ({ id, ...update }: { id: string; status?: FrictionStatus; reproduction?: string; project?: string; failureReason?: string }) =>
      request<FrictionItem>(`/api/friction/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: frictionKey() }),
    networkMode: "always",
    retry: 0,
  });
}

/** Says a test covers a correction, or that it can't be tested, and why. */
export function useSetRegression() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & SetRegressionRequest) =>
      request<FrictionItem>(`/api/friction/${encodeURIComponent(id)}/regression`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: frictionKey() }),
    networkMode: "always",
    retry: 0,
  });
}

/** Starts a worker job that writes the test. Only ever on the owner's press. */
export function useStartRegressionJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ item: FrictionItem; jobId: string }>(`/api/friction/${encodeURIComponent(id)}/regression-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: frictionKey() }),
    networkMode: "always",
    retry: 0,
  });
}

/** Assigns a friction item to an agent for repair. */
export function useAssignToAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & AssignToAgentRequest) =>
      request<{ item: FrictionItem; jobId: string }>(`/api/friction/${encodeURIComponent(id)}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: frictionKey() }),
    networkMode: "always",
    retry: 0,
  });
}

/** Verifies a friction item as fixed with evidence. */
export function useVerifyFriction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & CompleteRepairRequest) =>
      request<FrictionItem>(`/api/friction/${encodeURIComponent(id)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: frictionKey() }),
    networkMode: "always",
    retry: 0,
  });
}
