import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CompassReadSchema,
  CompassSchema,
  InterviewQuestionsSchema,
  type Compass,
  type CompassRead,
  type InterviewAnswers,
  type InterviewQuestions,
} from "@shared/compass-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/** The Compass (me/COMPASS.md) and its first-time interview. */

export const compassKey = () => [...agentosKeys.all, "compass"] as const;

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "The Compass could not be reached.", response.status);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The Compass came back in an unexpected shape.");
  return parsed.data;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function useCompass() {
  return useQuery({
    queryKey: compassKey(),
    queryFn: () => call<CompassRead>("/api/compass", CompassReadSchema),
    staleTime: 30_000,
    networkMode: "always",
    retry: 0,
  });
}

export function useSaveCompass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ compass, revision }: { compass: Compass; revision?: string }) =>
      call<CompassRead>("/api/compass", CompassReadSchema, { ...post({ compass, revision }), method: "PUT" }),
    onSuccess: (saved) => queryClient.setQueryData(compassKey(), saved),
    networkMode: "always",
    retry: 0,
  });
}

export const useInterviewQuestions = () =>
  useMutation({
    mutationFn: () => call<InterviewQuestions>("/api/compass/interview/questions", InterviewQuestionsSchema, { method: "POST" }),
    networkMode: "always",
    retry: 0,
  });

export const useDraftCompass = () =>
  useMutation({
    mutationFn: (answers: InterviewAnswers["answers"]) =>
      call<{ compass: Compass }>("/api/compass/interview/draft", z.object({ compass: CompassSchema }), post({ answers })),
    networkMode: "always",
    retry: 0,
  });
