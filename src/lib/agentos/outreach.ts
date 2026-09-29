import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  OutreachReplySchema,
  OutreachStatusSchema,
  OutreachSyncResultSchema,
  SuppressionSchema,
  type EmailContent,
  type OutreachReply,
  type OutreachStatus,
  type OutreachSyncResult,
  type Suppression,
  type SuppressionReason,
} from "@shared/outreach-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";
import { tractionKey } from "./traction";

/**
 * The outreach mailbox's client: its status, the signature, a Hermes draft,
 * creating a Gmail draft, sending one email, and the do-not-contact list.
 * Sending is one email to one prospect, only after the preview is confirmed.
 */

export const outreachKey = () => [...agentosKeys.all, "outreach"] as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError(
      "The AgentOS data adapter is not responding. Is it running?",
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(
      failure?.error ?? "The outreach mailbox could not be reached.",
      response.status,
    );
  }
  return payload as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function useOutreachStatus() {
  return useQuery({
    queryKey: outreachKey(),
    queryFn: async (): Promise<OutreachStatus> => {
      const parsed = OutreachStatusSchema.safeParse(
        await request("/api/outreach/status"),
      );
      if (!parsed.success)
        throw new AgentOSRequestError(
          "The outreach status came back in an unexpected shape.",
        );
      return parsed.data;
    },
    staleTime: 30_000,
    retry: 1,
    networkMode: "always",
  });
}

function useOutreachMutation<V, R>(fn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: outreachKey() }),
    networkMode: "always",
    retry: 0,
  });
}

export const useSaveOutreachSignature = () =>
  useOutreachMutation((signature: string) =>
    request<{ signature: string }>(
      "/api/outreach/settings",
      json("PUT", { signature }),
    ),
  );

export const useDisconnectOutreach = () =>
  useOutreachMutation(() =>
    request<{ ok: true }>("/api/outreach/disconnect", { method: "POST" }),
  );

const id = (value: string) => encodeURIComponent(value);

/** Hermes writes the email; nothing is created anywhere. */
export const useDraftOutreachEmail = () =>
  useMutation({
    mutationFn: (prospectId: string) =>
      request<EmailContent>(`/api/outreach/prospects/${id(prospectId)}/draft`, {
        method: "POST",
      }),
    networkMode: "always",
    retry: 0,
  });

export interface GmailDraftResult {
  draftId: string;
  address: string;
  openUrl: string;
}

/** Puts the email in the outreach mailbox's Drafts. A person sends it from Gmail. */
export const useCreateGmailDraft = () =>
  useMutation({
    mutationFn: ({
      prospectId,
      content,
    }: {
      prospectId: string;
      content: EmailContent;
    }) =>
      request<GmailDraftResult>(
        `/api/outreach/prospects/${id(prospectId)}/gmail-draft`,
        json("POST", content),
      ),
    networkMode: "always",
    retry: 0,
  });

export interface SendResult {
  sent: true;
  to: string;
  messageId: string;
}

/** Sends the previewed email now. The server picks the recipient and enforces every guardrail. */
export function useSendOutreachEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      prospectId,
      content,
      replyToId,
    }: {
      prospectId: string;
      content: EmailContent;
      replyToId?: string;
    }) =>
      request<SendResult>(
        `/api/outreach/prospects/${id(prospectId)}/send`,
        json("POST", { ...content, confirm: true, ...(replyToId ? { replyToId } : {}) }),
      ),
    // A send moves the prospect and uses a slot, whether or not the answer was clean.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: outreachKey() });
      void queryClient.invalidateQueries({ queryKey: tractionKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}

const suppressionsKey = () => [...outreachKey(), "suppressions"] as const;

export function useSuppressions() {
  return useQuery({
    queryKey: suppressionsKey(),
    queryFn: async (): Promise<Suppression[]> => {
      const parsed = z
        .object({ suppressions: z.array(SuppressionSchema) })
        .safeParse(await request("/api/outreach/suppressions"));
      if (!parsed.success)
        throw new AgentOSRequestError(
          "The do-not-contact list came back in an unexpected shape.",
        );
      return parsed.data.suppressions;
    },
    staleTime: 30_000,
    networkMode: "always",
  });
}

function useSuppressionMutation<V>(fn: (variables: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: suppressionsKey() }),
    networkMode: "always",
    retry: 0,
  });
}

export const useAddSuppression = () =>
  useSuppressionMutation(
    ({ address, reason }: { address: string; reason: SuppressionReason }) =>
      request("/api/outreach/suppressions", json("POST", { address, reason })),
  );

export const useRemoveSuppression = () =>
  useSuppressionMutation((address: string) =>
    request(`/api/outreach/suppressions/${id(address)}`, { method: "DELETE" }),
  );

/** What a prospect has written back, read from the outreach mailbox. */
export function useProspectReplies(prospectId: string) {
  return useQuery({
    queryKey: [...outreachKey(), "replies", prospectId] as const,
    queryFn: async (): Promise<OutreachReply[]> => {
      const parsed = z.object({ replies: z.array(OutreachReplySchema) }).safeParse(await request(`/api/outreach/prospects/${id(prospectId)}/replies`));
      if (!parsed.success) throw new AgentOSRequestError("The replies came back in an unexpected shape.");
      return parsed.data.replies;
    },
    staleTime: 30_000,
    networkMode: "always",
  });
}

/** Reads the outreach inbox now. Read-only against Gmail. */
export function useCheckReplies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<OutreachSyncResult> => {
      const parsed = OutreachSyncResultSchema.safeParse(await request("/api/outreach/sync", { method: "POST" }));
      if (!parsed.success) throw new AgentOSRequestError("The mailbox check came back in an unexpected shape.");
      return parsed.data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: outreachKey() });
      void queryClient.invalidateQueries({ queryKey: tractionKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}

/** Hermes answers one reply. Nothing is created or sent. */
export const useDraftReply = () =>
  useMutation({
    mutationFn: ({ prospectId, replyId }: { prospectId: string; replyId: string }) =>
      request<EmailContent>(`/api/outreach/prospects/${id(prospectId)}/replies/${id(replyId)}/draft`, { method: "POST" }),
    networkMode: "always",
    retry: 0,
  });
