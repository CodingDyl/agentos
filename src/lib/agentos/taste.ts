import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { DesignAssetSchema } from "@shared/agentos-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Taste Vault: reference assets in the design library, plus what only a
 * reference has (source URL, snippet, attached workspaces). Uploading an image
 * and deleting stay with the design library's own hooks.
 */

const base = "/api/taste";

const ItemsSchema = z.object({ items: z.array(DesignAssetSchema) });
const AssetSchema = z.object({ asset: DesignAssetSchema, duplicate: z.boolean().optional() });

/**
 * Nested under the design library's key on purpose: an upload or delete made
 * through the library's hooks refreshes the vault without knowing about it.
 */
export const tasteKeys = {
  all: [...agentosKeys.designs(), "taste"] as const,
  list: (workspace?: string) => [...tasteKeys.all, workspace ?? "all"] as const,
};

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AgentOSRequestError((payload as { error?: string } | null)?.error ?? "Taste Vault could not be reached.", response.status);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AgentOSRequestError("Taste Vault answered in an unexpected shape.");
  return parsed.data;
}

const json = (method: "POST" | "PATCH", body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** `null` clears notes or snippet. `attachedTo` replaces the whole list. */
export interface TastePatch {
  notes?: string | null;
  tags?: string[];
  snippet?: string | null;
  attachedTo?: string[];
}

/** Every reference, newest first; with a workspace, only those attached to it. */
export function useTaste(workspace?: string) {
  return useQuery({
    queryKey: tasteKeys.list(workspace),
    queryFn: () => call(workspace ? `${base}?workspace=${encodeURIComponent(workspace)}` : base, ItemsSchema).then((data) => data.items),
    staleTime: 30_000,
    networkMode: "always",
    retry: 1,
  });
}

function useRefresh() {
  const client = useQueryClient();
  // The whole library: a reference is also an asset on the Creative page.
  return () => client.invalidateQueries({ queryKey: agentosKeys.designs() });
}

/** Photographs a page and keeps it as a reference. Can take ten seconds or more. */
export function useAddTasteUrl() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (url: string) => call(`${base}/url`, AssetSchema, json("POST", { url })),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}

export function useUpdateTaste() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TastePatch }) =>
      call(`${base}/${encodeURIComponent(id)}`, AssetSchema, json("PATCH", patch)).then((data) => data.asset),
    onSuccess: refresh,
    networkMode: "always",
    retry: 0,
  });
}
