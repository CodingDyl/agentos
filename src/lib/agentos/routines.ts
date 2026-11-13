import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { RoutinePreviewSchema, RoutinesResponseSchema, type AutomationDelivery, type RoutineId } from "@shared/routine-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Routines: messages AgentOS writes and Hermes sends to the phone on a
 * schedule. Installing one creates a Hermes scheduled job, so the job list is
 * refreshed with it.
 */

const routinesKey = [...agentosKeys.all, "routines"] as const;

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Hermes didn't accept that.", response.status);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("Routines answered in an unexpected shape.");
  return parsed.data;
}

const Done = z.object({ ok: z.literal(true) });

export function useRoutines() {
  return useQuery({
    queryKey: routinesKey,
    queryFn: () => call("/api/routines", RoutinesResponseSchema),
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

export function useInstallRoutine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: RoutineId) => call(`/api/routines/${id}/install`, Done, { method: "POST" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: routinesKey });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.automations() });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** The message a routine would send right now. Asked for on demand, never cached: the point is to see it fresh. */
export function usePreviewRoutine() {
  return useMutation({
    mutationFn: (id: RoutineId) => call(`/api/routines/${id}/preview`, RoutinePreviewSchema).then((preview) => preview.message),
    networkMode: "always",
    retry: 0,
  });
}

/** Send a scheduled job's result to the phone, or back to its file only. */
export function useSetAutomationDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: AutomationDelivery["target"] }) =>
      call(`/api/automations/${encodeURIComponent(id)}/deliver`, Done, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      }),
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.automations() });
      void queryClient.invalidateQueries({ queryKey: agentosKeys.automation(id) });
    },
    networkMode: "always",
    retry: 0,
  });
}
