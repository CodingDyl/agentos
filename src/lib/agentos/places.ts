import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlacesNichesReplySchema, PlacesSearchReplySchema, type PlacesNichesReply, type PlacesSearchReply } from "@shared/places-types";
import { AgentOSRequestError } from "./client";
import { agentosKeys } from "./queries";

/**
 * Find by niche: the niche list and budget, and the search.
 *
 * A search spends Google Places requests, so it is a mutation that only runs
 * when a person presses Search, never a query that refetches. The results live
 * in the mutation and are gone with the page: nothing from Google is cached
 * here.
 */

export const placesKey = () => [...agentosKeys.all, "traction-places"] as const;

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AgentOSRequestError("The AgentOS data adapter is not responding. Is it running?");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as { error?: string } | null;
    throw new AgentOSRequestError(failure?.error ?? "The search could not be run.", response.status);
  }
  return payload;
}

/** The dropdown's options and this month's budget. Reading it spends nothing. */
export function usePlacesNiches(enabled: boolean) {
  return useQuery({
    queryKey: placesKey(),
    enabled,
    queryFn: async (): Promise<PlacesNichesReply> => {
      const parsed = PlacesNichesReplySchema.safeParse(await request("/api/traction/places/niches"));
      if (!parsed.success) throw new AgentOSRequestError("The niche list came back in an unexpected shape.");
      return parsed.data;
    },
    staleTime: 15_000,
    retry: 1,
    networkMode: "always",
  });
}

export function useSearchPlaces() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (search: { area: string; nicheId: string; radiusKm: number }): Promise<PlacesSearchReply> => {
      const parsed = PlacesSearchReplySchema.safeParse(
        await request("/api/traction/places/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(search),
        }),
      );
      if (!parsed.success) throw new AgentOSRequestError("The search came back in an unexpected shape.");
      return parsed.data;
    },
    // Even a failed search may have spent requests, so the budget is read again either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: placesKey() }),
  });
}
