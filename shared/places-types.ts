import { z } from "zod";

/**
 * What the Places search routes send, shared by the server that builds it and
 * the page that reads it, so the two cannot drift apart.
 */

/** Places requests one search makes: one to find the area, one to search it. */
export const PLACES_SEARCH_REQUESTS = 2;

export const PlaceNicheSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** The Places text query, without the area. */
  query: z.string(),
  /** Why the niche is worth a pitch. */
  why: z.string(),
  /** Rules or habits that change how you may pitch them. */
  caveat: z.string().optional(),
});
export type PlaceNiche = z.infer<typeof PlaceNicheSchema>;

export const PlaceCandidateSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  address: z.string(),
  website: z.string().optional(),
  /** `own` is their domain, `social` is a Facebook-type page, `none` is no website at all. */
  websiteKind: z.enum(["own", "social", "none"]),
  phone: z.string().optional(),
  rating: z.number().optional(),
  ratingCount: z.number().optional(),
  lat: z.number(),
  lng: z.number(),
  distanceKm: z.number(),
  mapsUrl: z.string().optional(),
});
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;

export const PlacesBudgetSchema = z.object({
  /** 0 means no cap is set, and searches are refused. */
  cap: z.number(),
  used: z.number(),
  remaining: z.number(),
  month: z.string(),
});
export type PlacesBudget = z.infer<typeof PlacesBudgetSchema>;

export const PlaceSearchResultSchema = z.object({
  area: z.object({ name: z.string(), lat: z.number(), lng: z.number() }),
  nicheId: z.string(),
  radiusKm: z.number(),
  candidates: z.array(PlaceCandidateSchema),
  /** Places requests a successful search makes. */
  requests: z.number(),
});
export type PlaceSearchResult = z.infer<typeof PlaceSearchResultSchema>;

/** `GET /api/traction/places/niches`. */
export const PlacesNichesReplySchema = z.object({
  niches: z.array(PlaceNicheSchema),
  radius: z.object({ min: z.number(), max: z.number() }),
  configured: z.boolean(),
  budget: PlacesBudgetSchema,
});
export type PlacesNichesReply = z.infer<typeof PlacesNichesReplySchema>;

/** `POST /api/traction/places/search`. */
export const PlacesSearchReplySchema = z.object({
  result: PlaceSearchResultSchema,
  budget: PlacesBudgetSchema,
});
export type PlacesSearchReply = z.infer<typeof PlacesSearchReplySchema>;

/** The most websites one check reads: a search returns at most 20 places. */
export const MAX_SITE_CHECKS = 20;

/**
 * What reading one business's website found. `score` is how much there is to
 * fix, 0 to 10, so the list can lead with the sites that need the most work.
 * The findings come from the page's HTML, so a site built with scripts can
 * show gaps that a visitor would not see; they are a reason to look, not a verdict.
 */
export const SiteCheckSchema = z.object({
  website: z.string(),
  reachable: z.boolean(),
  /** What is wrong, in plain words, worst first. For an unreachable site: why it did not load. */
  problems: z.array(z.string()),
  score: z.number().int().min(0).max(10),
  copyrightYear: z.number().int().optional(),
});
export type SiteCheck = z.infer<typeof SiteCheckSchema>;

/** `POST /api/traction/places/check-sites`. */
export const SiteChecksRequestSchema = z.object({
  websites: z.array(z.string().max(300)).min(1).max(MAX_SITE_CHECKS),
});
export const SiteChecksReplySchema = z.object({ checks: z.array(SiteCheckSchema) });
export type SiteChecksReply = z.infer<typeof SiteChecksReplySchema>;
