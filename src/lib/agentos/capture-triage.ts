import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CaptureFiledSchema, CaptureTriageSchema, type CaptureDestination, type CaptureTriage } from "@shared/capture-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/** Sorting captures: the inbox with Hermes' suggestions, and filing or deleting a note. */

const triageKey = () => [...agentosKeys.captures(), "triage"] as const;

async function call(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "The capture inbox could not be reached.", response.status);
  }
  return payload;
}

function readTriage(payload: unknown): CaptureTriage {
  const parsed = CaptureTriageSchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The capture inbox came back in an unexpected shape.");
  return parsed.data;
}

export function useCaptureTriage() {
  return useQuery({
    queryKey: triageKey(),
    queryFn: async () => readTriage(await call("/api/capture/triage")),
    staleTime: 15_000,
    networkMode: "always",
    retry: 0,
  });
}

function useInboxChange<V, R>(fn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      // The strip's count, the list, and anything the note was filed into.
      void queryClient.invalidateQueries({ queryKey: agentosKeys.captures() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.missionControl() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.all });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Hermes suggests a home for every note that has none. */
export function useSuggestHomes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => readTriage(await call("/api/capture/suggest", { method: "POST" })),
    onSuccess: (triage) => queryClient.setQueryData(triageKey(), triage),
    networkMode: "always",
    retry: 0,
  });
}

export const useAcceptCapture = () =>
  useInboxChange(async ({ id, destination }: { id: string; destination: CaptureDestination }) => {
    const parsed = CaptureFiledSchema.safeParse(
      await call(`/api/capture/${encodeURIComponent(id)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination }),
      }),
    );
    if (!parsed.success) throw new AgentOSRequestError("The note was filed, but the answer could not be read.");
    return parsed.data;
  });

export const useDeleteCapture = () =>
  useInboxChange((id: string) => call(`/api/capture/${encodeURIComponent(id)}`, { method: "DELETE" }));
