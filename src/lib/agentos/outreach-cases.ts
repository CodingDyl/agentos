import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  OutreachCaseSchema,
  SenderSchema,
  type OutreachCase,
  type OutreachCasePatch,
  type Sender,
  type SenderInput,
} from "@shared/outreach-case";
import { AgentOSRequestError } from "./client";
import { json, outreachKey, request } from "./outreach";
import { tractionKey } from "./traction";

/**
 * Outreach cases (the brief, the decision and the draft for one business)
 * and your companies. Every write returns the saved case, which replaces
 * the cached one, so the screen always shows what the server holds.
 */

const casesKey = () => [...outreachKey(), "cases"] as const;
const sendersKey = () => [...outreachKey(), "senders"] as const;
const id = (value: string) => encodeURIComponent(value);

export function useOutreachCases() {
  return useQuery({
    queryKey: casesKey(),
    queryFn: async (): Promise<Record<string, OutreachCase>> => {
      const parsed = z.object({ cases: z.record(z.string(), OutreachCaseSchema) }).safeParse(await request("/api/outreach/cases"));
      if (!parsed.success) throw new AgentOSRequestError("The outreach cases came back in an unexpected shape.");
      return parsed.data.cases;
    },
    staleTime: 10_000,
    networkMode: "always",
  });
}

function readCase(payload: unknown): OutreachCase {
  const parsed = z.object({ case: OutreachCaseSchema }).safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The case came back in an unexpected shape.");
  return parsed.data.case;
}

/** Puts a saved case in the cache, and refreshes Traction (the opening line becomes the prospect's observation). */
function useCaseMutation<V>(fn: (variables: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: V) => readCase(await fn(variables)),
    onSuccess: (saved) => {
      queryClient.setQueryData<Record<string, OutreachCase>>(casesKey(), (current) => ({ ...(current ?? {}), [saved.prospectId]: saved }));
      void queryClient.invalidateQueries({ queryKey: tractionKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export const useWriteCase = () =>
  useCaseMutation(({ prospectId, patch }: { prospectId: string; patch: OutreachCasePatch }) =>
    request(`/api/outreach/cases/${id(prospectId)}`, json("PATCH", { patch, by: "you" })),
  );

export const useBriefCase = () =>
  useCaseMutation(({ prospectId, replace = false }: { prospectId: string; replace?: boolean }) =>
    request(`/api/outreach/cases/${id(prospectId)}/brief`, json("POST", { replace })),
  );

export const useDraftCase = () =>
  useCaseMutation((prospectId: string) => request(`/api/outreach/cases/${id(prospectId)}/draft`, { method: "POST" }));

export function useSenders() {
  return useQuery({
    queryKey: sendersKey(),
    queryFn: async (): Promise<Sender[]> => {
      const parsed = z.object({ senders: z.array(SenderSchema) }).safeParse(await request("/api/outreach/senders"));
      if (!parsed.success) throw new AgentOSRequestError("Your companies came back in an unexpected shape.");
      return parsed.data.senders;
    },
    staleTime: 30_000,
    networkMode: "always",
  });
}

export function useSaveSender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, senderId }: { input: SenderInput; senderId?: string }) =>
      request<{ sender: Sender }>(senderId ? `/api/outreach/senders/${id(senderId)}` : "/api/outreach/senders", json(senderId ? "PUT" : "POST", input)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sendersKey() }),
    networkMode: "always",
    retry: 0,
  });
}

export function useDeleteSender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (senderId: string) => request(`/api/outreach/senders/${id(senderId)}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sendersKey() }),
    networkMode: "always",
    retry: 0,
  });
}
