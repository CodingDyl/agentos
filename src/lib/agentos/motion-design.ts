import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  MotionDraftSchema,
  MotionRunViewSchema,
  MotionSetupSchema,
  SkillInstallResultSchema,
  suggestedReferences,
  type MotionApprovalInput,
  type MotionDraft,
  type MotionLaunchInput,
  type MotionReference,
  type MotionRunView,
} from "@shared/motion-design-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

const base = "/api/motion-design";

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS server is not responding.");
  }
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "Motion Design could not do that.";
    throw new AgentOSRequestError(message, response.status);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentOSRequestError("Motion Design returned data in an unexpected shape.");
  return parsed.data;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const motionDesignKeys = {
  all: () => [...agentosKeys.all, "motion-design"] as const,
  setup: () => [...motionDesignKeys.all(), "setup"] as const,
  draft: () => [...motionDesignKeys.all(), "draft"] as const,
  run: (id: string) => [...motionDesignKeys.all(), "run", id] as const,
  workspace: (slug: string) => [...motionDesignKeys.all(), "workspace", slug] as const,
};

const SetupResponse = z.object({
  setup: MotionSetupSchema,
  higgsfield: z.string().optional(),
  suggestions: z.array(z.object({ id: z.string(), kind: z.enum(["link", "file"]), url: z.string().optional(), likes: z.array(z.string()), note: z.string() })).optional(),
});

export function useMotionSetup() {
  return useQuery({
    queryKey: motionDesignKeys.setup(),
    queryFn: () => call(`${base}/setup`, SetupResponse),
    staleTime: 3_000,
    refetchOnWindowFocus: true,
    networkMode: "always",
    retry: 1,
  });
}

export function useMotionDraft() {
  return useQuery({
    queryKey: motionDesignKeys.draft(),
    queryFn: () => call(`${base}/draft`, z.object({ draft: MotionDraftSchema.nullable() })),
    networkMode: "always",
  });
}

function pollView(view: MotionRunView | null | undefined): number | false {
  if (!view) return false;
  if (view.status === "running" || view.status === "building" || view.status === "queued") return 2_500;
  if (view.status === "awaiting_approval") return 4_000;
  return false;
}

export function useMotionRun(id: string | undefined) {
  return useQuery({
    queryKey: motionDesignKeys.run(id ?? ""),
    queryFn: () => call(`${base}/${encodeURIComponent(id ?? "")}`, MotionRunViewSchema),
    enabled: Boolean(id),
    refetchInterval: (query) => pollView(query.state.data),
    networkMode: "always",
    retry: 1,
  });
}

export function useMotionForWorkspace(slug: string) {
  return useQuery({
    queryKey: motionDesignKeys.workspace(slug),
    queryFn: async () => {
      try {
        return await call(`${base}/by-workspace/${encodeURIComponent(slug)}`, MotionRunViewSchema);
      } catch (error) {
        if (error instanceof AgentOSRequestError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(slug),
    refetchInterval: (query) => pollView(query.state.data ?? undefined),
    retry: 1,
    networkMode: "always",
  });
}

export function useSaveMotionDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: MotionDraft) => call(`${base}/draft`, z.object({ draft: MotionDraftSchema }), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }),
    onSuccess: (payload) => client.setQueryData(motionDesignKeys.draft(), payload),
    networkMode: "always",
    retry: 0,
  });
}

export function useInstallMotionSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (confirmOverwrite: boolean) => call(`${base}/skill/install`, SkillInstallResultSchema, json({ confirmOverwrite })),
    onSuccess: () => void client.invalidateQueries({ queryKey: motionDesignKeys.setup() }),
    networkMode: "always",
    retry: 0,
  });
}

export function useLaunchMotionDesign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MotionLaunchInput) => call(`${base}/launch`, MotionRunViewSchema, json(input)),
    onSuccess: (run) => {
      client.setQueryData(motionDesignKeys.run(run.id), run);
      client.setQueryData(motionDesignKeys.workspace(run.workspaceSlug), run);
      void client.invalidateQueries({ queryKey: agentosKeys.projects() });
      void client.invalidateQueries({ queryKey: agentosKeys.missionControl() });
      void client.invalidateQueries({ queryKey: agentosKeys.workerJobs() });
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useApproveMotionConcept(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MotionApprovalInput) => call(`${base}/${encodeURIComponent(id)}/approve`, MotionRunViewSchema, json(input)),
    onSuccess: (run) => {
      client.setQueryData(motionDesignKeys.run(run.id), run);
      client.setQueryData(motionDesignKeys.workspace(run.workspaceSlug), run);
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useSendMotionNotes(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => call(`${base}/${encodeURIComponent(id)}/notes`, MotionRunViewSchema, json({ text })),
    onSuccess: (run) => {
      client.setQueryData(motionDesignKeys.run(run.id), run);
      client.setQueryData(motionDesignKeys.workspace(run.workspaceSlug), run);
    },
    networkMode: "always",
    retry: 0,
  });
}

export async function uploadMotionReference(file: File): Promise<MotionReference> {
  const response = await fetch(`${base}/draft/files?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "image/png" },
    body: file,
  });
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "The image could not be stored.";
    throw new AgentOSRequestError(message, response.status);
  }
  const parsed = z.object({ reference: z.custom<MotionReference>() }).safeParse(value);
  if (!parsed.success) throw new AgentOSRequestError("The image was stored in an unexpected shape.");
  return parsed.data.reference;
}

export { suggestedReferences };
