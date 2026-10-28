import { siteDomain } from "../outreach/email-finder";
import { nicheById } from "./niches";

/**
 * Google Places (New), for finding businesses of one niche near an area.
 *
 * Two requests per search, and the result says so:
 *
 * 1. `resolveArea` turns a typed area ("Sandton") into a point.
 * 2. `searchNiche` asks for the niche around that point.
 *
 * Google treats a location bias as a hint, not a limit, so the radius is
 * enforced here: anything outside it is dropped.
 *
 * Only what a prospect needs is returned (name, address, website, phone,
 * rating, point and the place id). Nothing is stored here. Google's terms
 * limit how long Places content may be kept, so the caller keeps the place id
 * and the fields it imports, and drops the rest.
 *
 * The key lives in `.env`, rides in a header, and is never logged or returned.
 */

const BASE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 20;

/** Places requests one search makes: one to find the area, one to search it. */
export const SEARCH_REQUESTS = 2;

export const RADIUS_MIN_KM = 5;
export const RADIUS_MAX_KM = 15;

export class PlacesError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "off" | "invalid" | "unauthorized" | "quota" | "bad-area" | "failed",
  ) {
    super(message);
    this.name = "PlacesError";
  }
}

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string;
  website?: string;
  /** `own` is their domain, `social` is a Facebook-type page, `none` is no website at all. */
  websiteKind: "own" | "social" | "none";
  phone?: string;
  rating?: number;
  ratingCount?: number;
  lat: number;
  lng: number;
  distanceKm: number;
  mapsUrl?: string;
}

export interface PlaceSearchResult {
  area: { name: string; lat: number; lng: number };
  nicheId: string;
  radiusKm: number;
  candidates: PlaceCandidate[];
  /** Places requests a successful search makes. A search that fails part-way still spent some, so the monthly cap reserves `SEARCH_REQUESTS` before calling. */
  requests: number;
}

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim());
}

function key(): string {
  const value = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!value) throw new PlacesError("GOOGLE_PLACES_API_KEY is not set. Add it in Connectors → Google Places.", "not-configured");
  return value;
}

async function call(path: string, body: unknown, fieldMask: string, fetcher: typeof fetch): Promise<unknown> {
  const apiKey = key();
  let response: Response;
  try {
    response = await fetcher(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": fieldMask },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PlacesError("Could not reach Google Places.", "failed");
  }

  if (response.status === 401 || response.status === 403) {
    throw new PlacesError(
      "Google refused the key. It needs the Places API (New) enabled and billing switched on for its project.",
      "unauthorized",
    );
  }
  if (response.status === 429) throw new PlacesError("Google says the Places quota is used up. Try again later.", "quota");
  if (response.status === 400) throw new PlacesError("Google could not read that search. Check the area and try again.", "invalid");
  if (!response.ok) throw new PlacesError(`Google Places answered ${response.status}.`, "failed");
  return response.json().catch(() => ({}));
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

interface RawPlace {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  websiteUri?: unknown;
  nationalPhoneNumber?: unknown;
  rating?: unknown;
  userRatingCount?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  googleMapsUri?: unknown;
  businessStatus?: unknown;
}

const places = (payload: unknown): RawPlace[] => {
  const list = (payload as { places?: unknown }).places;
  return Array.isArray(list) ? (list as RawPlace[]) : [];
};

/** Great-circle distance between two points, in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A typed area as a point. One Places request. */
export async function resolveArea(areaText: string, fetcher: typeof fetch = fetch): Promise<{ name: string; lat: number; lng: number }> {
  const payload = await call(
    "/places:searchText",
    { textQuery: areaText, regionCode: "ZA", maxResultCount: 1 },
    "places.displayName,places.location",
    fetcher,
  );
  const [first] = places(payload);
  const lat = num(first?.location?.latitude);
  const lng = num(first?.location?.longitude);
  if (!first || lat === undefined || lng === undefined) {
    throw new PlacesError(`Google could not find “${areaText}”. Try a suburb or town name.`, "bad-area");
  }
  return { name: text(first.displayName?.text) || areaText, lat, lng };
}

export interface SearchRequest {
  area: string;
  nicheId: string;
  radiusKm: number;
}

/** Operational businesses of one niche within the radius, nearest first. Two Places requests, at most 20 results. */
export async function searchNiche(request: SearchRequest, fetcher: typeof fetch = fetch): Promise<PlaceSearchResult> {
  const area = request.area.trim();
  const niche = nicheById(request.nicheId);
  if (area.length < 2 || area.length > 80) throw new PlacesError("Type an area between 2 and 80 characters.", "invalid");
  if (!niche) throw new PlacesError("That niche is not one AgentOS searches for.", "invalid");
  if (!Number.isFinite(request.radiusKm) || request.radiusKm < RADIUS_MIN_KM || request.radiusKm > RADIUS_MAX_KM) {
    throw new PlacesError(`The radius must be between ${RADIUS_MIN_KM} and ${RADIUS_MAX_KM} km.`, "invalid");
  }
  key();

  const centre = await resolveArea(area, fetcher);
  const payload = await call(
    "/places:searchText",
    {
      textQuery: niche.query,
      regionCode: "ZA",
      pageSize: PAGE_SIZE,
      locationBias: { circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: request.radiusKm * 1000 } },
    },
    "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.location,places.googleMapsUri,places.businessStatus",
    fetcher,
  );

  const seen = new Set<string>();
  const candidates: PlaceCandidate[] = [];
  for (const place of places(payload)) {
    const placeId = text(place.id);
    const lat = num(place.location?.latitude);
    const lng = num(place.location?.longitude);
    const name = text(place.displayName?.text);
    if (!placeId || !name || lat === undefined || lng === undefined || seen.has(placeId)) continue;
    if (place.businessStatus !== undefined && place.businessStatus !== "OPERATIONAL") continue;

    const distance = distanceKm(centre.lat, centre.lng, lat, lng);
    if (distance > request.radiusKm) continue;

    seen.add(placeId);
    const website = text(place.websiteUri) || undefined;
    candidates.push({
      placeId,
      name,
      address: text(place.formattedAddress),
      website,
      websiteKind: !website ? "none" : siteDomain(website) ? "own" : "social",
      phone: text(place.nationalPhoneNumber) || undefined,
      rating: num(place.rating),
      ratingCount: num(place.userRatingCount),
      lat,
      lng,
      distanceKm: Math.round(distance * 10) / 10,
      mapsUrl: text(place.googleMapsUri) || undefined,
    });
  }
  candidates.sort((a, b) => a.distanceKm - b.distanceKm);

  return { area: centre, nicheId: niche.id, radiusKm: request.radiusKm, candidates, requests: SEARCH_REQUESTS };
}
