import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { currentStage, RebuildRunSchema, type RebuildRun, type RebuildStageId, type RebuildStartInput } from "@shared/website-rebuild-types";
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

function useRunMutation<TInput>(request: (input: TInput) => Promise<RebuildRun>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (run) => {
      client.setQueryData(key(run.id), run);
      client.setQueryData(prospectKey(run.prospectId), run);
    },
    networkMode: "always",
    retry: 0,
  });
}

export function useStartRebuild() {
  return useRunMutation((input: RebuildStartInput) => call(base, RebuildRunSchema, input));
}

export function useRetryStage(runId: string) {
  return useRunMutation((stage: RebuildStageId) => call(`${base}/${encodeURIComponent(runId)}/stages/${stage}/retry`, RebuildRunSchema, {}));
}

export function useDecideStage(runId: string) {
  return useRunMutation((input: { stage: RebuildStageId; revision: number; decision: "approve" | "request-changes"; note?: string }) =>
    call(`${base}/${encodeURIComponent(runId)}/stages/${input.stage}/${input.decision}`, RebuildRunSchema, { revision: input.revision, ...(input.note ? { note: input.note } : {}) }),
  );
}
