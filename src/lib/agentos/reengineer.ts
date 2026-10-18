import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  LibraryEntrySchema,
  ReengineerReadinessSchema,
  ReengineerRunViewSchema,
  type LibraryEntry,
  type ReengineerReadiness,
  type ReengineerRequestInput,
  type ReengineerRunView,
  type VerdictInput,
} from "@shared/reengineer-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Reengineer could not do that.", response.status);
  const result = schema.safeParse(payload);
  if (!result.success) throw new AgentOSRequestError("Reengineer returned data in an unexpected shape.");
  return result.data;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const reengineerKeys = {
  all: () => [...agentosKeys.all, "reengineer"] as const,
  readiness: () => [...reengineerKeys.all(), "readiness"] as const,
  runs: () => [...reengineerKeys.all(), "runs"] as const,
  library: () => [...reengineerKeys.all(), "library"] as const,
};

export function useReengineerReadiness() {
  return useQuery({
    queryKey: reengineerKeys.readiness(),
    queryFn: () => request("/api/reengineer/readiness", { method: "GET" }, z.object({ readiness: ReengineerReadinessSchema })).then((r): ReengineerReadiness => r.readiness),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    networkMode: "always",
  });
}

const live = (run: ReengineerRunView) => run.status === "running" || run.status === "awaiting_review";

export function useReengineerRuns() {
  return useQuery({
    queryKey: reengineerKeys.runs(),
    queryFn: () => request("/api/reengineer/runs", { method: "GET" }, z.object({ runs: z.array(ReengineerRunViewSchema) })).then((r) => r.runs),
    // A finished run is filed into the library the moment it is read, so the library follows.
    refetchInterval: (query) => (query.state.data?.some(live) ? 5000 : false),
    networkMode: "always",
  });
}

export function useLibrary() {
  return useQuery({
    queryKey: reengineerKeys.library(),
    queryFn: () => request("/api/reengineer/library", { method: "GET" }, z.object({ entries: z.array(LibraryEntrySchema) })).then((r): LibraryEntry[] => r.entries),
    staleTime: 5_000,
    refetchInterval: 10_000,
    networkMode: "always",
  });
}

export function useStartReengineer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReengineerRequestInput) => request("/api/reengineer/runs", post(input), z.object({ run: ReengineerRunViewSchema })).then((r) => r.run),
    onSuccess: () => void client.invalidateQueries({ queryKey: reengineerKeys.all() }),
    networkMode: "always",
    retry: 0,
  });
}

export function useRecordVerdict() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...verdict }: { id: string } & VerdictInput) =>
      request(`/api/reengineer/library/${encodeURIComponent(id)}/verdict`, post(verdict), z.object({ entry: LibraryEntrySchema })).then((r) => r.entry),
    onSuccess: () => void client.invalidateQueries({ queryKey: reengineerKeys.library() }),
    networkMode: "always",
    retry: 0,
  });
}

export async function fetchLibraryBrief(kind?: string): Promise<string> {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  return request(`/api/reengineer/library/brief${query}`, { method: "GET" }, z.object({ brief: z.string() })).then((r) => r.brief);
}
