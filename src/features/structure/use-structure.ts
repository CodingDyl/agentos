import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStructure, getStructureNode, getStructureSubsystem, rebuildStructure, searchStructure } from "@/lib/agentos/client";

const base = (slug: string) => ["agentos", "structure", slug] as const;

/** Polls only while a rebuild is running, then settles on the new map. */
export function useStructure(slug: string) {
  return useQuery({
    queryKey: base(slug),
    queryFn: () => getStructure(slug),
    networkMode: "always",
    retry: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.rebuild.status === "running" ? 1_500 : false),
  });
}

export function useStructureSubsystem(slug: string, id: number | undefined, builtAt: string | undefined) {
  return useQuery({
    queryKey: [...base(slug), "subsystem", id, builtAt],
    queryFn: () => getStructureSubsystem(slug, id as number),
    enabled: id !== undefined,
    networkMode: "always",
    retry: 0,
  });
}

export function useStructureNode(slug: string, id: string | undefined, builtAt: string | undefined) {
  return useQuery({
    queryKey: [...base(slug), "node", id, builtAt],
    queryFn: () => getStructureNode(slug, id as string),
    enabled: id !== undefined,
    networkMode: "always",
    retry: 0,
  });
}

export function useStructureSearch(slug: string, query: string, builtAt: string | undefined) {
  return useQuery({
    queryKey: [...base(slug), "search", query, builtAt],
    queryFn: () => searchStructure(slug, query),
    enabled: query.length > 0,
    networkMode: "always",
    retry: 0,
  });
}

export function useRebuildStructure(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (force: boolean) => rebuildStructure(slug, force),
    onSuccess: (state) => queryClient.setQueryData(base(slug), state),
    networkMode: "always",
    retry: 0,
  });
}
