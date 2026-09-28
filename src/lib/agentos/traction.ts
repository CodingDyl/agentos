import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TractionDataSchema,
  type CaseStudyInput,
  type ConfirmMailLink,
  type CrmImport,
  type ExperimentInput,
  type IcpInput,
  type OfferInput,
  type ProspectInput,
  type ProspectPatch,
  type QueueAction,
  type TractionData,
  type WaitingOnInput,
  type WeeklyTargets,
} from "@shared/traction-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Traction's client and queries, kept apart from the shared client so the
 * module can be read (and eventually moved) on its own.
 *
 * One read, many small writes. Every write invalidates the one read, so the
 * queue, pipeline and warnings are re-derived by the server together rather
 * than patched optimistically here — the numbers on screen are always the
 * server's numbers.
 */

export const tractionKey = () => [...agentosKeys.all, "traction"] as const;

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(failure?.error ?? "Traction could not be updated.", response.status);
  }

  return payload as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function getTraction(): Promise<TractionData> {
  const payload = await request("/api/traction");
  const parsed = TractionDataSchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("Traction returned data in an unexpected shape.");
  return parsed.data;
}

const id = (value: string) => encodeURIComponent(value);

/** Polled gently: Traction changes when a person acts, not on its own. */
export function useTraction() {
  return useQuery({
    queryKey: tractionKey(),
    queryFn: getTraction,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
    networkMode: "always",
  });
}

/** A mutation that re-reads Traction (and Today, which shows the queue) when it lands. */
function useTractionMutation<V, R = unknown>(fn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tractionKey() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export const useCreateProspect = () =>
  useTractionMutation((input: ProspectInput) => request("/api/traction/prospects", json("POST", input)));

export const useUpdateProspect = () =>
  useTractionMutation(({ prospectId, patch }: { prospectId: string; patch: ProspectPatch }) =>
    request(`/api/traction/prospects/${id(prospectId)}`, json("PATCH", patch)),
  );

export const useDeleteProspect = () =>
  useTractionMutation((prospectId: string) => request(`/api/traction/prospects/${id(prospectId)}`, { method: "DELETE" }));

/** What a Virtec write-back came to, when the action involved one. */
export type VirtecOutcome = { ok: true } | { ok: false; error: string };

export const useQueueAction = () =>
  useTractionMutation(({ itemId, action }: { itemId: string; action: QueueAction }) =>
    request<{ virtec?: VirtecOutcome; caseStudy?: { id: string } }>(`/api/traction/queue/${id(itemId)}`, json("POST", action)),
  );

export const useSaveIcp = () => useTractionMutation((input: IcpInput) => request("/api/traction/icp", json("PUT", input)));

export const useSaveTargets = () =>
  useTractionMutation((input: WeeklyTargets) => request("/api/traction/targets", json("PUT", input)));

export const useSaveOffer = () =>
  useTractionMutation(({ offerId, input }: { offerId?: string; input: OfferInput }) =>
    offerId
      ? request(`/api/traction/offers/${id(offerId)}`, json("PUT", input))
      : request("/api/traction/offers", json("POST", input)),
  );

export const useDeleteOffer = () =>
  useTractionMutation((offerId: string) => request(`/api/traction/offers/${id(offerId)}`, { method: "DELETE" }));

export const useSaveExperiment = () =>
  useTractionMutation(({ experimentId, input }: { experimentId?: string; input: ExperimentInput }) =>
    experimentId
      ? request(`/api/traction/experiments/${id(experimentId)}`, json("PUT", input))
      : request("/api/traction/experiments", json("POST", input)),
  );

export const useDeleteExperiment = () =>
  useTractionMutation((experimentId: string) => request(`/api/traction/experiments/${id(experimentId)}`, { method: "DELETE" }));

export const useSaveWaiting = () =>
  useTractionMutation(({ waitingId, input }: { waitingId?: string; input: WaitingOnInput }) =>
    waitingId
      ? request(`/api/traction/waiting/${id(waitingId)}`, json("PUT", input))
      : request("/api/traction/waiting", json("POST", input)),
  );

export const useResolveWaiting = () =>
  useTractionMutation((waitingId: string) => request(`/api/traction/waiting/${id(waitingId)}/resolve`, { method: "POST" }));

export const useDeleteWaiting = () =>
  useTractionMutation((waitingId: string) => request(`/api/traction/waiting/${id(waitingId)}`, { method: "DELETE" }));

/** Confirms a thread belongs to a prospect — and, only if asked, the stage move with it. */
export const useConfirmMailLink = () =>
  useTractionMutation((input: ConfirmMailLink) => request("/api/traction/mail-links", json("POST", input)));

export const useDismissMailSuggestion = () =>
  useTractionMutation((threadId: string) => request("/api/traction/mail-links/dismiss", json("POST", { threadId })));

export const useUnlinkMailThread = () =>
  useTractionMutation((threadId: string) => request(`/api/traction/mail-links/${id(threadId)}`, { method: "DELETE" }));

/** Reads Virtec again now rather than waiting out the adapter's five-minute cache. */
export const useRefreshCrm = () => useTractionMutation(() => request("/api/traction/crm/refresh", { method: "POST" }));

/** Imports one Virtec lead or client as a prospect. The adapter supplies the contents; this only names it. */
export const useImportCrm = () =>
  useTractionMutation((input: CrmImport) => request<{ virtec?: VirtecOutcome }>("/api/traction/crm/import", json("POST", input)));

/** Marks a Virtec follow-up sent or dismissed — in Virtec. Needs write-back on. */
export const useSetCrmFollowUp = () =>
  useTractionMutation(({ followUpId, status }: { followUpId: string; status: "sent" | "dismissed" }) =>
    request(`/api/traction/crm/follow-ups/${id(followUpId)}`, json("POST", { status })),
  );

/** Marks a Virtec lead disqualified. Needs write-back on. */
export const useLeadNotAFit = () =>
  useTractionMutation((leadId: string) => request(`/api/traction/crm/leads/${id(leadId)}/not-a-fit`, { method: "POST" }));

/** Settles a website lead in Virtec: replied, not a fit, or spam. Needs write-back on. */
export const useSetInboundLead = () =>
  useTractionMutation(({ leadId, status }: { leadId: string; status: "replied" | "not_a_fit" | "spam" }) =>
    request(`/api/traction/crm/inbound/${id(leadId)}`, json("POST", { status })),
  );

/** Starts a case study from an opportunity (by its source only) or from a blank form. */
export const useStartCaseStudy = () =>
  useTractionMutation((input: { fromOpportunity: string } | CaseStudyInput) =>
    request<{ caseStudy: { id: string } }>("/api/traction/case-studies", json("POST", input)),
  );

export const useSaveCaseStudy = () =>
  useTractionMutation(({ caseStudyId, input }: { caseStudyId: string; input: CaseStudyInput }) =>
    request(`/api/traction/case-studies/${id(caseStudyId)}`, json("PUT", input)),
  );

export const useDeleteCaseStudy = () =>
  useTractionMutation((caseStudyId: string) => request(`/api/traction/case-studies/${id(caseStudyId)}`, { method: "DELETE" }));

/** One Hermes call. Slow — it is a whole draft — and only ever on request. */
export const useDraftCaseStudy = () =>
  useTractionMutation((caseStudyId: string) => request(`/api/traction/case-studies/${id(caseStudyId)}/draft`, { method: "POST" }));

export const useRequestTestimonial = () =>
  useTractionMutation((caseStudyId: string) => request(`/api/traction/case-studies/${id(caseStudyId)}/testimonial-request`, { method: "POST" }));

export const useDismissOpportunity = () =>
  useTractionMutation((source: string) => request("/api/traction/case-studies/dismiss", json("POST", { source })));
