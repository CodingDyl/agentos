import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { PitchPackSchema, PitchQuoteSchema, PitchSummarySchema, type PitchPack, type PitchQuoteRequest, type PitchSummary } from "@shared/pitch-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";
import { json, outreachKey, request } from "./outreach";

/**
 * The Pitch Pack. Kept under the outreach key, so a send or an "I sent it"
 * (which refresh outreach) refresh the pitch's status too.
 */
const pitchKey = () => [...outreachKey(), "pitch"] as const;
const id = (value: string) => encodeURIComponent(value);

function readPack(payload: unknown): PitchPack {
  const parsed = z.object({ pitch: PitchPackSchema }).safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The pitch came back in an unexpected shape.");
  return parsed.data.pitch;
}

/** Every prospect with a live preview: ready to pitch, or pitched. */
export function usePitches() {
  return useQuery({
    queryKey: [...pitchKey(), "list"],
    queryFn: async (): Promise<PitchSummary[]> => {
      const parsed = z.object({ pitches: z.array(PitchSummarySchema) }).safeParse(await request("/api/traction/pitch"));
      if (!parsed.success) throw new AgentOSRequestError("The pitches came back in an unexpected shape.");
      return parsed.data.pitches;
    },
    staleTime: 30_000,
    networkMode: "always",
  });
}

/** One prospect's pitch, with a check of their current site for the findings. */
export function usePitch(prospectId: string, enabled = true) {
  return useQuery({
    queryKey: [...pitchKey(), prospectId],
    queryFn: async () => readPack(await request(`/api/traction/pitch/${id(prospectId)}?check=1`)),
    enabled,
    staleTime: 30_000,
    retry: 0,
    networkMode: "always",
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: outreachKey() });
    void queryClient.invalidateQueries({ queryKey: [...agentosKeys.all, "business"] });
  };
}

export function useCapturePitchShots() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (prospectId: string) => readPack(await request(`/api/traction/pitch/${id(prospectId)}/screenshots`, json("POST", {}))),
    onSettled: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** Hermes drafts the pitch onto the case. Nothing is sent. */
export function useDraftPitch() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (prospectId: string) => request<unknown>(`/api/traction/pitch/${id(prospectId)}/draft`, json("POST", {})),
    onSettled: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** A draft quote in Business. Returns the existing one when there is one. */
export function useCreatePitchQuote() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({ prospectId, input }: { prospectId: string; input: PitchQuoteRequest }) => {
      const parsed = z.object({ quote: PitchQuoteSchema, created: z.boolean() }).safeParse(await request(`/api/traction/pitch/${id(prospectId)}/quote`, json("POST", input)));
      if (!parsed.success) throw new AgentOSRequestError("The quote came back in an unexpected shape.");
      return parsed.data;
    },
    onSettled: refresh,
    networkMode: "always",
    retry: 0,
  });
}
