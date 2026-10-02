import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FocusTodaySchema, type CheckIn, type FocusToday } from "@shared/focus-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/** Today's focus: the check-in, your three, swaps and done-marks. */

const focusKey = () => [...agentosKeys.all, "focus", "today"] as const;

async function call(path: string, init?: RequestInit): Promise<FocusToday> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Today's focus could not be reached.", response.status);
  const parsed = FocusTodaySchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("Today's focus came back in an unexpected shape.");
  return parsed.data;
}

const post = (body?: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export function useFocusToday() {
  return useQuery({
    queryKey: focusKey(),
    queryFn: () => call("/api/focus/today"),
    staleTime: 30_000,
    networkMode: "always",
    retry: 0,
  });
}

function useFocusChange<V>(fn: (variables: V) => Promise<FocusToday>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (today) => {
      queryClient.setQueryData(focusKey(), today);
      // A done-mark ticks the task in its workspace too.
      void queryClient.invalidateQueries({ queryKey: agentosKeys.projects() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export const useCheckIn = () => useFocusChange((input: CheckIn) => call("/api/focus/check-in", post(input)));
export const useSkipCheckIn = () => useFocusChange(() => call("/api/focus/skip", post()));
export const useSwapPick = () => useFocusChange(({ slot, candidateId }: { slot: number; candidateId: string }) => call("/api/focus/swap", post({ slot, candidateId })));
export const useMarkDone = () => useFocusChange(({ candidateId, done }: { candidateId: string; done: boolean }) => call("/api/focus/done", post({ candidateId, done })));
