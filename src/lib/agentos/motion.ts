import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  MotionJobDetailSchema,
  MotionJobSchema,
  MotionStudioInfoSchema,
  type MotionJob,
  type MotionJobDetail,
  type MotionJobRequestInput,
  type MotionStudioInfo,
} from "@shared/motion-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * The motion studio, from the browser's side: send a brief, then watch.
 *
 * A film takes Claude Code tens of minutes, so everything here is polling on a
 * short interval while a film is queued or running, and stops when it is not.
 */

async function motionRequest<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AgentOSRequestError(
      (payload as { error?: string } | null)?.error ?? "The motion studio could not do that.",
      response.status,
    );
  }

  const result = schema.safeParse(payload);
  if (!result.success) throw new AgentOSRequestError("The motion studio returned data in an unexpected shape.");
  return result.data;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const motionKeys = {
  all: () => [...agentosKeys.all, "motion"] as const,
  studio: () => [...motionKeys.all(), "studio"] as const,
  jobs: () => [...motionKeys.all(), "jobs"] as const,
  job: (id: string) => [...motionKeys.all(), "job", id] as const,
};

const isLive = (status: MotionJob["status"] | undefined) => status === "queued" || status === "running";

export function useMotionStudio() {
  return useQuery({
    queryKey: motionKeys.studio(),
    queryFn: () =>
      motionRequest("/api/designs/motion/studio", { method: "GET" }, z.object({ studio: MotionStudioInfoSchema })).then(
        (response): MotionStudioInfo => response.studio,
      ),
    staleTime: 30_000,
    networkMode: "always",
  });
}

export function useMotionJobs() {
  return useQuery({
    queryKey: motionKeys.jobs(),
    queryFn: () =>
      motionRequest("/api/designs/motion", { method: "GET" }, z.object({ jobs: z.array(MotionJobSchema) })).then(
        (response) => response.jobs,
      ),
    refetchInterval: (query) => (query.state.data?.some((job) => isLive(job.status)) ? 4000 : false),
    networkMode: "always",
  });
}

export function useMotionJob(id: string | undefined) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: motionKeys.job(id ?? ""),
    enabled: Boolean(id),
    queryFn: async (): Promise<MotionJobDetail> => {
      const job = await motionRequest(
        `/api/designs/motion/${encodeURIComponent(id!)}`,
        { method: "GET" },
        z.object({ job: MotionJobDetailSchema }),
      ).then((response) => response.job);
      // A film that just finished has new assets in Creative.
      if (job.status === "completed") void queryClient.invalidateQueries({ queryKey: agentosKeys.designs() });
      return job;
    },
    refetchInterval: (query) => (isLive(query.state.data?.status) ? 2500 : false),
    networkMode: "always",
  });
}

function useRefreshMotion() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: motionKeys.all() });
}

export function useCreateMotionJob() {
  const refresh = useRefreshMotion();
  return useMutation({
    mutationFn: (request: MotionJobRequestInput) =>
      motionRequest("/api/designs/motion", json(request), z.object({ job: MotionJobSchema })).then((response) => response.job),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useCancelMotionJob() {
  const refresh = useRefreshMotion();
  return useMutation({
    mutationFn: (id: string) =>
      motionRequest(`/api/designs/motion/${encodeURIComponent(id)}/cancel`, json({}), z.object({ job: MotionJobSchema })),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

/** Resume a stopped film, or revise a finished one when a note is given. */
export function useResumeMotionJob() {
  const refresh = useRefreshMotion();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      motionRequest(`/api/designs/motion/${encodeURIComponent(id)}/resume`, json({ note }), z.object({ job: MotionJobSchema })),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}
