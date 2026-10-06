import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { currentStage, RebuildRunSchema, StageWorkerOptionsSchema, type BrandKitEdit, type RebuildRun, type RebuildStageId, type RebuildStartInput } from "@shared/website-rebuild-types";
import { AgentOSRequestError } from "./client";

const base = "/api/rebuilds";
const key = (id: string) => ["rebuild", id] as const;
const prospectKey = (prospectId: string) => ["rebuild", "prospect", prospectId] as const;

async function call<T>(url: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new AgentOSRequestError("The AgentOS server is not responding.");
  }
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "The website rebuild request failed.";
    throw new AgentOSRequestError(message, response.status);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentOSRequestError("The website rebuild answer was not what AgentOS expected.");
  return parsed.data;
}

/** Poll while something is happening, so the page follows along without a refresh. */
function pollWhileBusy(run: RebuildRun | undefined): number | false {
  const next = run ? currentStage(run.stages) : undefined;
  // Waiting on a person (approval) or a blocker: nothing will change by itself.
  return next && (next.status === "in_progress" || next.status === "not_started") ? 2_000 : false;
}

export function useRebuild(id: string | undefined) {
  return useQuery({
    queryKey: key(id ?? ""),
    queryFn: () => call(`${base}/${encodeURIComponent(id ?? "")}`, RebuildRunSchema),
    enabled: Boolean(id),
    refetchInterval: (query) => pollWhileBusy(query.state.data),
    retry: 1,
    networkMode: "always",
  });
}

/** The rebuild for a prospect, or null when there isn't one yet. */
export function useRebuildForProspect(prospectId: string) {
  return useQuery({
    queryKey: prospectKey(prospectId),
    queryFn: async () => {
      try {
        return await call(`${base}/by-prospect/${encodeURIComponent(prospectId)}`, RebuildRunSchema);
      } catch (error) {
        if (error instanceof AgentOSRequestError && error.status === 404) return null;
        throw error;
      }
    },
    refetchInterval: (query) => pollWhileBusy(query.state.data ?? undefined),
    retry: 1,
    networkMode: "always",
  });
}

/** The rebuild a workspace belongs to, or null for a workspace that is not a client rebuild. */
export function useRebuildForWorkspace(slug: string) {
  return useQuery({
    queryKey: ["rebuild", "workspace", slug] as const,
    queryFn: async () => {
      try {
        return await call(`${base}/by-workspace/${encodeURIComponent(slug)}`, RebuildRunSchema);
      } catch (error) {
        if (error instanceof AgentOSRequestError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(slug),
    refetchInterval: (query) => pollWhileBusy(query.state.data ?? undefined),
    retry: 1,
    networkMode: "always",
  });
}

function useRunMutation<TInput>(request: (input: TInput) => Promise<RebuildRun>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (run) => {
      client.setQueryData(key(run.id), run);
      client.setQueryData(prospectKey(run.prospectId), run);
      if (run.workspaceSlug) client.setQueryData(["rebuild", "workspace", run.workspaceSlug], run);
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useStartRebuild() {
  return useRunMutation((input: RebuildStartInput) => call(base, RebuildRunSchema, input));
}

/** Retry a blocked stage, optionally with another worker ("plan" goes back to the stage's usual order). */
export function useRetryStage(runId: string) {
  return useRunMutation(({ stage, worker }: { stage: RebuildStageId; worker?: string }) =>
    call(`${base}/${encodeURIComponent(runId)}/stages/${stage}/retry`, RebuildRunSchema, worker ? { worker } : {}),
  );
}

/** Skips a blocked website capture, so the rebuild carries on without the current site. */
export function useSkipCapture(runId: string) {
  return useRunMutation(() => call(`${base}/${encodeURIComponent(runId)}/stages/capture/skip`, RebuildRunSchema, {}));
}

/** Workers able to do a stage, with whether each is ready now. Read only while the choice is on screen. */
export function useStageWorkers(runId: string, stage: RebuildStageId, enabled: boolean) {
  return useQuery({
    queryKey: ["rebuild", runId, "workers", stage] as const,
    queryFn: () => call(`${base}/${encodeURIComponent(runId)}/stages/${stage}/workers`, StageWorkerOptionsSchema),
    enabled,
    staleTime: 10_000,
    retry: 0,
    networkMode: "always",
  });
}

export function useDecideStage(runId: string) {
  return useRunMutation((input: { stage: RebuildStageId; revision: number; decision: "approve" | "request-changes"; note?: string; choice?: string }) =>
    call(`${base}/${encodeURIComponent(runId)}/stages/${input.stage}/${input.decision}`, RebuildRunSchema, {
      revision: input.revision,
      ...(input.note ? { note: input.note } : {}),
      ...(input.choice ? { choice: input.choice } : {}),
    }),
  );
}

/** Saves which brand images are used, their order, and the colours and fonts. */
export function useUpdateBrandKit(runId: string) {
  return useRunMutation((edit: BrandKitEdit) => call(`${base}/${encodeURIComponent(runId)}/brand`, RebuildRunSchema, edit));
}

/** Adds a logo or photo the person has, sent as the file itself. */
export function useUploadBrandAsset(runId: string) {
  return useRunMutation(async ({ file, kind }: { file: File; kind: "logo" | "photo" }) => {
    let response: Response;
    try {
      response = await fetch(`${base}/${encodeURIComponent(runId)}/brand/assets?kind=${kind}&alt=${encodeURIComponent(file.name.replace(/\.[a-z0-9]+$/i, ""))}`, {
        method: "POST",
        // Some systems give SVG or ICO no type; any image type is fine, the server reads the bytes.
        headers: { "Content-Type": file.type.startsWith("image/") ? file.type : "image/png" },
        body: file,
      });
    } catch {
      throw new AgentOSRequestError("The AgentOS server is not responding.");
    }
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : response.status === 413 ? "Images are limited to 20 MB." : "The upload failed.";
      throw new AgentOSRequestError(message, response.status);
    }
    const parsed = RebuildRunSchema.safeParse(value);
    if (!parsed.success) throw new AgentOSRequestError("The website rebuild answer was not what AgentOS expected.");
    return parsed.data;
  });
}
