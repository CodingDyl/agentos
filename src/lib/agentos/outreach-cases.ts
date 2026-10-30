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
import { LibraryEmailSchema, type LibraryEmail, type LibrarySaveRequest } from "@shared/outreach-library";
import type { ReviseRequest, ReviseResult } from "@shared/outreach-revise";
import { CostEstimateResponseSchema, type CostEstimate } from "@shared/design-generation-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";
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

/** `exampleId` models the draft on one saved email, instead of the automatic picks. */
export const useDraftCase = () =>
  useCaseMutation(({ prospectId, exampleId }: { prospectId: string; exampleId?: string }) =>
    request(`/api/outreach/cases/${id(prospectId)}/draft`, json("POST", exampleId ? { exampleId } : {})),
  );

/** What enhancing this many photos would cost in credits, asked before anything is spent. */
export function usePhotoSampleCost() {
  return useMutation({
    mutationFn: async (input: { model: string; count: number }): Promise<CostEstimate> => {
      const parsed = CostEstimateResponseSchema.safeParse(
        await request("/api/designs/cost", json("POST", { model: input.model, prompt: "Enhance this photo", count: input.count })),
      );
      if (!parsed.success) throw new AgentOSRequestError("The price came back in an unexpected shape.");
      return parsed.data.cost;
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Enhances the picked photos of one business. Paid, so it never retries on its own. */
export function useMakePhotoSamples() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { prospect: string; photoAssetIds: string[] }) =>
      request<{ generations: unknown[] }>("/api/designs/enhance-photos", json("POST", input)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.designs() });
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === "design-generations" });
    },
    networkMode: "always",
    retry: 0,
  });
}

/**
 * Rewrites the saved draft with the agent you choose, changing only what the
 * instruction asks. Returns the revision and saves nothing: write it with
 * `useWriteCase` to keep it.
 */
export function useReviseDraft() {
  return useMutation({
    mutationFn: ({ prospectId, ...input }: ReviseRequest & { prospectId: string }) =>
      request<ReviseResult>(`/api/outreach/cases/${id(prospectId)}/revise`, json("POST", input)),
    networkMode: "always",
    retry: 0,
  });
}

const libraryKey = () => [...outreachKey(), "library"] as const;

/** Saved emails, newest first. Read from the vault's cached index, so it works with the drive unplugged. */
export function useEmailLibrary() {
  return useQuery({
    queryKey: libraryKey(),
    queryFn: async (): Promise<LibraryEmail[]> => {
      const parsed = z.object({ emails: z.array(LibraryEmailSchema) }).safeParse(await request("/api/outreach/library"));
      if (!parsed.success) throw new AgentOSRequestError("The email library came back in an unexpected shape.");
      return parsed.data.emails;
    },
    staleTime: 30_000,
    networkMode: "always",
  });
}

/** Saves a draft to the library (a note in your Obsidian vault). Needs the drive plugged in. */
export function useSaveToLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LibrarySaveRequest) => request<{ id: string }>("/api/outreach/library", json("POST", input)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: libraryKey() }),
    networkMode: "always",
    retry: 0,
  });
}

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
