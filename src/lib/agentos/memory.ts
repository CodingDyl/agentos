import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type {
  MemoryDiagnostics,
  MemoryFacets,
  MemoryGraph,
  MemoryNoteDetail,
  MemoryNotesPage,
  MemoryTree,
  VaultStatus,
} from "@shared/memory-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Memory's client and queries.
 *
 * Every read is keyed under one root so a change in the vault can refresh the
 * whole screen at once. The status is polled; when its `version` moves (an
 * edit in Obsidian, a rename, the drive coming back), everything else is
 * invalidated — previous data stays on screen while it refetches, so the
 * graph and the open note never blank out mid-read.
 */

export const memoryKey = () => [...agentosKeys.all, "memory"] as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(failure?.error ?? "Memory could not be read.", response.status);
  }
  return payload as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function useMemoryStatus() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: [...memoryKey(), "status"],
    queryFn: () => request<VaultStatus>("/api/memory/status"),
    refetchInterval: 1_500,
    networkMode: "always",
  });

  // A new index version means the vault changed: refresh everything else.
  const seen = useRef<number | undefined>(undefined);
  const version = status.data?.version;
  useEffect(() => {
    if (version === undefined) return;
    if (seen.current !== undefined && seen.current !== version) {
      void client.invalidateQueries({
        queryKey: memoryKey(),
        predicate: (entry) => entry.queryKey[2] !== "status",
      });
    }
    seen.current = version;
  }, [client, version]);

  return status;
}

export interface NotesQuery {
  q?: string;
  folder?: string;
  tag?: string;
  sort?: "title" | "modified" | "links";
  limit?: number;
}

export function useMemoryNotes(options: NotesQuery) {
  return useQuery({
    queryKey: [...memoryKey(), "notes", options],
    queryFn: () => request<MemoryNotesPage & { stale: boolean }>(`/api/memory/notes${query({ ...options })}`),
    placeholderData: keepPreviousData,
    networkMode: "always",
  });
}

export function useMemoryTree(q?: string) {
  return useQuery({
    queryKey: [...memoryKey(), "tree", q ?? ""],
    queryFn: () => request<MemoryTree>(`/api/memory/tree${query({ q })}`),
    placeholderData: keepPreviousData,
    networkMode: "always",
  });
}

export function useMemoryNote(id: string | undefined) {
  return useQuery({
    queryKey: [...memoryKey(), "note", id],
    queryFn: () => request<MemoryNoteDetail>(`/api/memory/note${query({ id })}`),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    networkMode: "always",
    retry: false,
  });
}

export function useMemoryFacets() {
  return useQuery({
    queryKey: [...memoryKey(), "facets"],
    queryFn: () => request<MemoryFacets>("/api/memory/facets"),
    networkMode: "always",
  });
}

export interface GraphQuery {
  focus?: string;
  depth?: number;
  folder?: string;
  tag?: string;
  q?: string;
  orphans?: boolean;
  unresolved?: boolean;
}

export function useMemoryGraph(options: GraphQuery) {
  return useQuery({
    queryKey: [...memoryKey(), "graph", options],
    queryFn: () =>
      request<MemoryGraph & { stale: boolean }>(
        `/api/memory/graph${query({ ...options, orphans: options.orphans ? 1 : 0, unresolved: options.unresolved ? 1 : 0 })}`,
      ),
    placeholderData: keepPreviousData,
    networkMode: "always",
  });
}

export function useMemoryDiagnostics(enabled: boolean) {
  return useQuery({
    queryKey: [...memoryKey(), "diagnostics"],
    queryFn: () => request<MemoryDiagnostics>("/api/memory/diagnostics"),
    enabled,
    networkMode: "always",
  });
}

export function useReindexMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => request<VaultStatus>("/api/memory/reindex", { method: "POST" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: memoryKey() }),
  });
}
