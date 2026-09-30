import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ConnectorDetailSchema,
  ConnectorsResponseSchema,
  CredentialResultSchema,
  type CapabilityPolicy,
  type CredentialResult,
  type ConnectorDetail,
  type ConnectorsResponse,
} from "@shared/connector-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Connectors' client and queries.
 *
 * Reading costs no network call on the server; only "Test connection"
 * reaches the service. Every write returns the connector's new detail, and
 * the list is re-read so the grid and the detail can never disagree.
 */

export const connectorsKey = () => [...agentosKeys.all, "connectors"] as const;
export const connectorKey = (id: string) => [...connectorsKey(), id] as const;

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
    throw new AgentOSRequestError(failure?.error ?? "The connector could not be updated.", response.status);
  }

  return payload as T;
}

/** Always JSON, even with no fields: the server refuses bodiless writes (see its CSRF note). */
const json = (method: string, body: unknown = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function parseDetail(payload: unknown): ConnectorDetail {
  const parsed = ConnectorDetailSchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The connector came back in an unexpected shape.");
  return parsed.data;
}

export async function getConnectors(): Promise<ConnectorsResponse> {
  const parsed = ConnectorsResponseSchema.safeParse(await request("/api/connectors"));
  if (!parsed.success) throw new AgentOSRequestError("Connectors came back in an unexpected shape.");
  return parsed.data;
}

export async function getConnector(id: string): Promise<ConnectorDetail> {
  return parseDetail(await request(`/api/connectors/${encodeURIComponent(id)}`));
}

export function useConnectors() {
  return useQuery({ queryKey: connectorsKey(), queryFn: getConnectors, staleTime: 30_000, retry: 1, networkMode: "always" });
}

export function useConnector(id: string) {
  return useQuery({ queryKey: connectorKey(id), queryFn: () => getConnector(id), staleTime: 15_000, retry: 1, networkMode: "always", enabled: id.length > 0 });
}

function useConnectorMutation<V>(fn: (variables: V) => Promise<ConnectorDetail>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(connectorKey(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: connectorsKey(), exact: true });
    },
  });
}

export function useSetConnectorEnabled() {
  return useConnectorMutation(async ({ id, enabled }: { id: string; enabled: boolean }) =>
    parseDetail(await request(`/api/connectors/${encodeURIComponent(id)}`, json("PATCH", { enabled }))),
  );
}

/** `null` restores the capability's default policy. */
export function useSetCapabilityPolicy() {
  return useConnectorMutation(async ({ id, capabilityId, policy }: { id: string; capabilityId: string; policy: CapabilityPolicy | null }) =>
    parseDetail(await request(`/api/connectors/${encodeURIComponent(id)}`, json("PATCH", { policies: { [capabilityId]: policy } }))),
  );
}

export function useTestConnector() {
  return useConnectorMutation(async (id: string) => parseDetail(await request(`/api/connectors/${encodeURIComponent(id)}/test`, json("POST"))));
}

export function useDisconnectConnector() {
  return useConnectorMutation(async (id: string) => parseDetail(await request(`/api/connectors/${encodeURIComponent(id)}/disconnect`, json("POST"))));
}

/**
 * "Save & connect": writes the values into `.env`, applies them, switches the
 * connector on and tests it. The values are sent once and never come back.
 */
export function useSaveConnectorCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Record<string, string> }): Promise<CredentialResult> => {
      const parsed = CredentialResultSchema.safeParse(await request(`/api/connectors/${encodeURIComponent(id)}/credentials`, json("POST", { values })));
      if (!parsed.success) throw new AgentOSRequestError("The connector came back in an unexpected shape.");
      return parsed.data;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(connectorKey(result.connector.id), result.connector);
      void queryClient.invalidateQueries({ queryKey: connectorsKey(), exact: true });
    },
  });
}
