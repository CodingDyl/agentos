import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isRunSettled,
  OperatorRunSchema,
  OperatorRunsResponseSchema,
  RunbooksResponseSchema,
  type OperatorMode,
  type OperatorRun,
} from "@shared/operator-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Operator's client and queries.
 *
 * A run is created and returns at once; the page then polls it every second
 * until it settles. Polling rather than a stream because a run is a handful
 * of steps over seconds to minutes, and a poll survives a reload for free.
 */

export const operatorRunsKey = () => [...agentosKeys.all, "operator", "runs"] as const;
export const operatorRunKey = (id: string) => [...agentosKeys.all, "operator", "run", id] as const;
export const runbooksKey = () => [...agentosKeys.all, "operator", "runbooks"] as const;

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
    throw new AgentOSRequestError(failure?.error ?? "Operator could not do that.", response.status);
  }
  return payload as T;
}

/** Always JSON: the server refuses bodiless writes, so another site can't press Run. */
const json = (body: unknown = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function parseRun(payload: unknown): OperatorRun {
  const parsed = OperatorRunSchema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("The run came back in an unexpected shape.");
  return parsed.data;
}

const runPath = (id: string, suffix = "") => `/api/operator/runs/${encodeURIComponent(id)}${suffix}`;

export function useOperatorRuns() {
  return useQuery({
    queryKey: operatorRunsKey(),
    queryFn: async () => {
      const parsed = OperatorRunsResponseSchema.safeParse(await request("/api/operator/runs"));
      if (!parsed.success) throw new AgentOSRequestError("Runs came back in an unexpected shape.");
      return parsed.data.runs;
    },
    // Fast while something in the list is still going, slow otherwise.
    refetchInterval: (query) => (query.state.data?.some((run) => !isRunSettled(run.status) && run.status !== "awaiting_approval") ? 2_000 : 30_000),
    retry: 1,
    networkMode: "always",
  });
}

export function useOperatorRun(id: string | undefined) {
  return useQuery({
    queryKey: operatorRunKey(id ?? ""),
    queryFn: async () => parseRun(await request(runPath(id ?? ""))),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && (isRunSettled(status) || status === "awaiting_approval") ? false : 1_000;
    },
    retry: 1,
    networkMode: "always",
  });
}

export function useRunbooks() {
  return useQuery({
    queryKey: runbooksKey(),
    queryFn: async () => {
      const parsed = RunbooksResponseSchema.safeParse(await request("/api/operator/runbooks"));
      if (!parsed.success) throw new AgentOSRequestError("Runbooks came back in an unexpected shape.");
      return parsed.data.runbooks;
    },
    staleTime: 60_000,
    retry: 1,
    networkMode: "always",
  });
}

function useRunMutation<V>(fn: (variables: V) => Promise<OperatorRun>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (run) => {
      queryClient.setQueryData(operatorRunKey(run.id), run);
      void queryClient.invalidateQueries({ queryKey: operatorRunsKey(), exact: true });
    },
  });
}

export function useCreateOperatorRun() {
  return useRunMutation(async ({ input, mode }: { input: string; mode: OperatorMode }) =>
    parseRun(await request("/api/operator/runs", json({ input, mode }))),
  );
}

export function useApproveOperatorRun() {
  return useRunMutation(async (id: string) => parseRun(await request(runPath(id, "/approve"), json())));
}

export function useStopOperatorRun() {
  return useRunMutation(async (id: string) => parseRun(await request(runPath(id, "/stop"), json())));
}

export function useCreateProposedTasks() {
  return useRunMutation(async ({ id, ids }: { id: string; ids: string[] }) => parseRun(await request(runPath(id, "/tasks"), json({ ids }))));
}

export function useDecideMemoryProposal() {
  return useRunMutation(async ({ id, proposalId, decision }: { id: string; proposalId: string; decision: "accept" | "dismiss" }) =>
    parseRun(await request(runPath(id, `/memory/${encodeURIComponent(proposalId)}`), json({ decision }))),
  );
}
