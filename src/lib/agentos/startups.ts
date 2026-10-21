import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  BrainstormIdeaSchema,
  PersonaSchema,
  PersonaSuggestionSchema,
  PersonasResponseSchema,
  ScopeCheckSchema,
  StageQuestionsSchema,
  VentureDetailSchema,
  VentureSchema,
  VenturesResponseSchema,
  type EditableStage,
  type Persona,
  type StageAnswers,
  type StageContent,
  type VentureDetail,
} from "@shared/startup-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/** Startups: ventures walked from idea to MVP. See docs/startups/README.md. */

const base = "/api/startups";

export const startupKeys = {
  all: [...agentosKeys.all, "startups"] as const,
  list: () => [...startupKeys.all, "list"] as const,
  venture: (slug: string) => [...startupKeys.all, "venture", slug] as const,
  personas: () => [...startupKeys.all, "personas"] as const,
  workspace: (slug: string) => [...startupKeys.all, "workspace", slug] as const,
};

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Startups could not be reached.", response.status);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("Startups answered in an unexpected shape.");
  return parsed.data;
}

const json = (method: "POST" | "PUT", body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const path = (slug: string, rest = "") => `${base}/${encodeURIComponent(slug)}${rest}`;

export function useVentures() {
  return useQuery({
    queryKey: startupKeys.list(),
    queryFn: () => call(base, VenturesResponseSchema).then((data) => data.ventures),
    networkMode: "always",
    retry: 0,
  });
}

export function useVenture(slug: string) {
  return useQuery({
    queryKey: startupKeys.venture(slug),
    queryFn: () => call(path(slug), VentureDetailSchema),
    enabled: Boolean(slug),
    networkMode: "always",
    retry: 0,
  });
}

export function usePersonas() {
  return useQuery({
    queryKey: startupKeys.personas(),
    queryFn: () => call(`${base}/personas`, PersonasResponseSchema).then((data) => data.personas),
    networkMode: "always",
    retry: 0,
  });
}

export function useVentureForWorkspace(workspace: string) {
  return useQuery({
    queryKey: startupKeys.workspace(workspace),
    queryFn: () => call(`${base}/by-workspace/${encodeURIComponent(workspace)}`, z.object({ venture: VentureSchema.nullable() })).then((data) => data.venture),
    enabled: Boolean(workspace),
    staleTime: 60_000,
    networkMode: "always",
    retry: 0,
  });
}

/** A change that answers with the whole venture: the cache is replaced, never merged. */
function useVentureChange<V>(slug: string, fn: (variables: V) => Promise<VentureDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(startupKeys.venture(slug), detail);
      void queryClient.invalidateQueries({ queryKey: startupKeys.list() });
      void queryClient.invalidateQueries({ queryKey: startupKeys.personas() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useCreateVenture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; pitch?: string; origin?: "idea" | "brainstorm" }) => call(base, VentureDetailSchema, json("POST", input)),
    onSuccess: (detail) => {
      queryClient.setQueryData(startupKeys.venture(detail.venture.slug), detail);
      void queryClient.invalidateQueries({ queryKey: startupKeys.list() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useBrainstorm() {
  return useMutation({
    mutationFn: (focus?: string) => call(`${base}/brainstorm`, z.object({ ideas: z.array(BrainstormIdeaSchema) }), json("POST", { focus })).then((data) => data.ideas),
    networkMode: "always",
    retry: 0,
  });
}

export function useStageQuestions(slug: string, stage: EditableStage) {
  return useMutation({
    mutationFn: (notes?: string) => call(path(slug, `/stages/${stage}/questions`), StageQuestionsSchema, json("POST", { notes })),
    networkMode: "always",
    retry: 0,
  });
}

export function useStageDraft<S extends EditableStage>(slug: string, stage: S) {
  return useMutation({
    mutationFn: (answers: StageAnswers) =>
      call(path(slug, `/stages/${stage}/draft`), z.object({ content: z.unknown() }), json("POST", answers)).then((data) => data.content as StageContent[S]),
    networkMode: "always",
    retry: 0,
  });
}

export const useSaveStage = <S extends EditableStage>(slug: string, stage: S) =>
  useVentureChange(slug, (input: { content: StageContent[S]; expectedRevision?: string }) => call(path(slug, `/stages/${stage}`), VentureDetailSchema, json("PUT", input)));

export function useSuggestPersonas(slug: string) {
  return useMutation({
    mutationFn: () => call(path(slug, "/personas/suggest"), z.object({ suggestions: z.array(PersonaSuggestionSchema) }), json("POST")).then((data) => data.suggestions),
    networkMode: "always",
    retry: 0,
  });
}

export function useDraftPersona() {
  return useMutation({
    mutationFn: (input: { role: string; industry?: string; notes?: string }) => call(`${base}/personas/draft`, z.object({ persona: PersonaSchema }), json("POST", input)).then((data) => data.persona),
    networkMode: "always",
    retry: 0,
  });
}

export function useSavePersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (persona: Omit<Persona, "created" | "usedBy" | "slug"> & { slug?: string }) => {
      const { slug, ...body } = persona;
      return call(slug ? `${base}/personas/${encodeURIComponent(slug)}` : `${base}/personas`, z.object({ persona: PersonaSchema }), json(slug ? "PUT" : "POST", body)).then((data) => data.persona);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: startupKeys.personas() }),
    networkMode: "always",
    retry: 0,
  });
}

export const useRunReview = (slug: string) =>
  useVentureChange(slug, (persona: string) => call(path(slug, `/personas/${encodeURIComponent(persona)}/review`), VentureDetailSchema, json("POST")));
export const useScoreVenture = (slug: string) => useVentureChange(slug, () => call(path(slug, "/score"), VentureDetailSchema, json("POST")));
export const usePivotVenture = (slug: string) => useVentureChange(slug, (direction?: string) => call(path(slug, "/pivot"), VentureDetailSchema, json("POST", { direction })));
export const useStopVenture = (slug: string) => useVentureChange(slug, (reason: string) => call(path(slug, "/stop"), VentureDetailSchema, json("POST", { reason })));
export const useParkLater = (slug: string) => useVentureChange(slug, (input: { title: string; reason?: string }) => call(path(slug, "/later"), VentureDetailSchema, json("POST", input)));
export const useGraduateVenture = (slug: string) => useVentureChange(slug, () => call(path(slug, "/graduate"), VentureDetailSchema, json("POST")));

export function useScopeCheck(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: string) => call(path(slug, "/scope-check"), z.object({ check: ScopeCheckSchema, detail: VentureDetailSchema }), json("POST", { request })),
    onSuccess: ({ detail }) => queryClient.setQueryData(startupKeys.venture(slug), detail),
    networkMode: "always",
    retry: 0,
  });
}
