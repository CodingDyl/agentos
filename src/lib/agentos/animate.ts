import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AnimateJobSchema,
  AnimateStudioSchema,
  type AnimateDecisionInput,
  type AnimateJob,
  type AnimateRequestInput,
  type AnimateStudio,
} from "@shared/animate-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Claude Motion, from the browser's side: the intake, then watching a stage
 * and answering at each review gate. Polling runs only while Claude is working.
 */

async function animateRequest<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Claude Motion could not do that.", response.status);
  }

  const result = schema.safeParse(payload);
  if (!result.success) throw new AgentOSRequestError("Claude Motion returned data in an unexpected shape.");
  return result.data;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const animateKeys = {
  all: () => [...agentosKeys.all, "animate"] as const,
  studio: () => [...animateKeys.all(), "studio"] as const,
  jobs: () => [...animateKeys.all(), "jobs"] as const,
  job: (id: string) => [...animateKeys.all(), "job", id] as const,
};

const isLive = (status: AnimateJob["status"] | undefined) => status === "queued" || status === "running";

export function useAnimateStudio() {
  return useQuery({
    queryKey: animateKeys.studio(),
    queryFn: () =>
      animateRequest("/api/designs/animate/studio", { method: "GET" }, z.object({ studio: AnimateStudioSchema })).then(
        (response): AnimateStudio => response.studio,
      ),
    // Installing or enabling the skill elsewhere should show up when the person comes back.
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    networkMode: "always",
  });
}

export function useAnimateJobs() {
  return useQuery({
    queryKey: animateKeys.jobs(),
    queryFn: () =>
      animateRequest("/api/designs/animate", { method: "GET" }, z.object({ jobs: z.array(AnimateJobSchema) })).then((response) => response.jobs),
    refetchInterval: (query) => (query.state.data?.some((job) => isLive(job.status)) ? 4000 : false),
    networkMode: "always",
  });
}

export function useAnimateJob(id: string | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: animateKeys.job(id ?? ""),
    enabled: Boolean(id),
    queryFn: async () => {
      const job = await animateRequest(`/api/designs/animate/${encodeURIComponent(id!)}`, { method: "GET" }, z.object({ job: AnimateJobSchema })).then(
        (response) => response.job,
      );
      // A delivered video is a Creative asset now.
      if (job.status === "completed") void queryClient.invalidateQueries({ queryKey: agentosKeys.designs() });
      return job;
    },
    refetchInterval: (query) => (isLive(query.state.data?.status) ? 2500 : false),
    networkMode: "always",
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: animateKeys.all() });
}

export function useCreateAnimateJob() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (request: AnimateRequestInput) =>
      animateRequest("/api/designs/animate", json(request), z.object({ job: AnimateJobSchema })).then((response) => response.job),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useCancelAnimateJob() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => animateRequest(`/api/designs/animate/${encodeURIComponent(id)}/cancel`, json({}), z.object({ job: AnimateJobSchema })),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** Approve a review gate, or ask for changes at it. */
export function useDecideAnimateJob() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...decision }: { id: string } & AnimateDecisionInput) =>
      animateRequest(`/api/designs/animate/${encodeURIComponent(id)}/decision`, json(decision), z.object({ job: AnimateJobSchema })),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** Resume a stopped stage, or revise a delivered video when a note is given. */
export function useResumeAnimateJob() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      animateRequest(`/api/designs/animate/${encodeURIComponent(id)}/resume`, json({ note }), z.object({ job: AnimateJobSchema })),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}
