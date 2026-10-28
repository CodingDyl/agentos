import { authorize } from "../connectors/policy";
import { checkSearch, PlacesError, searchNiche, SEARCH_REQUESTS, type PlaceSearchResult, type SearchRequest } from "./client";
import { placesBudget, reserveRequests, type PlacesBudget } from "./usage";

/**
 * A niche search, from a person pressing Search.
 *
 * The order is the point: validate (spends nothing), check the connector is on
 * and the capability allowed, reserve the requests against the monthly cap,
 * and only then call Google. A search that is refused at any earlier step has
 * cost nothing.
 */

/** Gate for the route handler: Google Places must be switched on, and the capability allowed. */
export function allow(detail: string): void {
  const decision = authorize("googleplaces.search_places", { initiator: "person", detail });
  if (!decision.allowed) throw new PlacesError(decision.reason, "off");
}

export async function runSearch(request: SearchRequest, fetcher: typeof fetch = fetch): Promise<{ result: PlaceSearchResult; budget: PlacesBudget }> {
  const { niche } = checkSearch(request);
  allow(niche.id);
  reserveRequests(SEARCH_REQUESTS);
  const result = await searchNiche(request, fetcher);
  return { result, budget: placesBudget() };
}
