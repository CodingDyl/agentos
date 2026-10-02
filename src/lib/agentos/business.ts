import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BusinessDataSchema, type BusinessData, type FollowUpAction } from "@shared/business-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Business's client and queries. One read, small writes; every write returns
 * the re-derived read, so the numbers on screen are always the server's.
 */

export const businessKey = () => [...agentosKeys.all, "business"] as const;

async function request(path: string, init?: RequestInit): Promise<BusinessData> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(failure?.error ?? "Business could not be updated.", response.status);
  }

  const parsed = BusinessDataSchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("Business returned data in an unexpected shape.");
  return parsed.data;
}

export function useBusiness() {
  return useQuery({ queryKey: businessKey(), queryFn: () => request("/api/business"), staleTime: 30_000, retry: 1 });
}

/** Reads Virtec again now, instead of waiting out its five-minute cache. */
export function useRefreshBusiness() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => request("/api/business?fresh=1"),
    onSuccess: (data) => client.setQueryData(businessKey(), data),
  });
}

function usePut<T>(path: (value: T) => string, body: (value: T) => unknown) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (value: T) =>
      request(path(value), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(value)) }),
    onSuccess: (data) => client.setQueryData(businessKey(), data),
  });
}

export function useLinkClientWorkspace() {
  return usePut<{ clientId: string; workspace: string | null }>(
    ({ clientId }) => `/api/business/clients/${encodeURIComponent(clientId)}/workspace`,
    ({ workspace }) => ({ workspace }),
  );
}

export function useSetEntityWorkspaces() {
  return usePut<{ entityId: string; workspaces: string[] }>(
    ({ entityId }) => `/api/business/entities/${encodeURIComponent(entityId)}/workspaces`,
    ({ workspaces }) => ({ workspaces }),
  );
}

export function useFollowUpAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...action }: { id: string } & Partial<FollowUpAction> & Pick<FollowUpAction, "action">) =>
      request(`/api/business/follow-ups/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }),
    onSuccess: (data) => client.setQueryData(businessKey(), data),
  });
}
