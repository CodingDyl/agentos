import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CleanupCandidateSchema,
  CleanupPreviewSchema,
  CleanupResultSchema,
  type CleanupCandidate,
  type CleanupPreview,
  type CleanupRequest,
  type CleanupResult,
} from "@shared/client-cleanup";
import { AgentOSRequestError } from "./client";
import { json, outreachKey, request } from "./outreach";
import { agentosKeys } from "./queries";
import { tractionKey } from "./traction";

/**
 * Cleaning up the work built for businesses that never showed interest.
 * Previewing deletes nothing; only the mutation does, and only with `confirm`.
 */

const cleanupKey = () => [...agentosKeys.all, "cleanup"] as const;
const id = (value: string) => encodeURIComponent(value);

/** Who could be cleaned up. No sizes, so it is cheap to keep fresh. */
export function useCleanupCandidates() {
  return useQuery({
    queryKey: [...cleanupKey(), "candidates"],
    queryFn: async (): Promise<CleanupCandidate[]> => {
      const parsed = z.object({ candidates: z.array(CleanupCandidateSchema) }).safeParse(await request("/api/cleanup/candidates"));
      if (!parsed.success) throw new AgentOSRequestError("The clean-up list came back in an unexpected shape.");
      return parsed.data.candidates;
    },
    staleTime: 30_000,
    networkMode: "always",
  });
}

/** What would go, with sizes. Measured when asked for, because measuring a big folder takes a moment. */
export function useCleanupPreview(prospectId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...cleanupKey(), "preview", prospectId],
    queryFn: async (): Promise<CleanupPreview> => {
      const parsed = CleanupPreviewSchema.safeParse(await request(`/api/cleanup/${id(prospectId)}`));
      if (!parsed.success) throw new AgentOSRequestError("The clean-up preview came back in an unexpected shape.");
      return parsed.data;
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
    networkMode: "always",
  });
}

/** Deletes the chosen items. Not recoverable. */
export function useRunCleanup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ prospectId, ...body }: CleanupRequest & { prospectId: string }): Promise<CleanupResult> => {
      const parsed = CleanupResultSchema.safeParse(await request(`/api/cleanup/${id(prospectId)}`, json("POST", body)));
      if (!parsed.success) throw new AgentOSRequestError("The clean-up result came back in an unexpected shape.");
      return parsed.data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cleanupKey() });
      void queryClient.invalidateQueries({ queryKey: tractionKey() });
      void queryClient.invalidateQueries({ queryKey: outreachKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}
