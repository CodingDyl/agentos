import type { PlaceCandidate, PlaceNiche } from "@shared/places-types";
import type { Prospect, ProspectInput } from "@shared/traction-types";

/**
 * Find by niche, as plain functions.
 *
 * A Places result is not a prospect until you import it, and importing keeps
 * only what a prospect needs: the name, the website, the niche, why it is
 * worth a look and where to find them. Google's terms limit how long Places
 * content may be stored, so ratings, coordinates and the rest stay on screen
 * and are gone when the page is.
 */

const WEBSITE_ORDER = { none: 0, social: 1, own: 2 } as const;

/** Leads with the weakest web presence first: no website, then a social page, then their own site. Nearest first within each. */
export function orderCandidates(candidates: readonly PlaceCandidate[]): PlaceCandidate[] {
  return [...candidates].sort((a, b) => WEBSITE_ORDER[a.websiteKind] - WEBSITE_ORDER[b.websiteKind] || a.distanceKm - b.distanceKm);
}

export const WEBSITE_KIND_LABEL = {
  none: "No website",
  social: "Social page only",
  own: "Has a website",
} as const;

const cut = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`);

const host = (website: string | undefined): string | undefined => {
  if (!website) return undefined;
  try {
    return new URL(website).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return undefined;
  }
};

const nameKey = (name: string): string => name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** Whether a business is already on the list, by website host or by name, so importing twice cannot double it. */
export function alreadyListed(candidate: PlaceCandidate, prospects: readonly Prospect[]): boolean {
  const candidateHost = candidate.websiteKind === "own" ? host(candidate.website) : undefined;
  const candidateName = nameKey(candidate.name);
  return prospects.some(
    (prospect) => (candidateHost !== undefined && host(prospect.website) === candidateHost) || nameKey(prospect.company) === candidateName,
  );
}

/** The prospect an import creates. It has no verdict, so it lands in "To check". */
export function prospectFromCandidate(candidate: PlaceCandidate, niche: PlaceNiche, areaName: string): ProspectInput {
  const reasons = [
    candidate.websiteKind === "none"
      ? "No website on Google Maps"
      : candidate.websiteKind === "social"
        ? "Only a social page on Google Maps, no website of their own"
        : "Has a website: check it for what is out of date",
    `${niche.label} near ${areaName}, ${candidate.distanceKm} km away`,
  ];
  if (candidate.rating !== undefined && candidate.ratingCount !== undefined) {
    reasons.push(`${candidate.rating} stars from ${candidate.ratingCount} Google reviews`);
  }

  const notes = [
    "Found with Google Places.",
    candidate.address ? `Address: ${candidate.address}` : undefined,
    candidate.phone ? `Phone: ${candidate.phone}` : undefined,
    candidate.mapsUrl ? `Google Maps: ${candidate.mapsUrl}` : undefined,
    niche.caveat ? `Note for this niche: ${niche.caveat}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    company: cut(candidate.name.trim(), 120),
    website: candidate.website && candidate.websiteKind !== "none" ? cut(candidate.website, 300) : undefined,
    segment: cut(niche.label, 80),
    stage: "target",
    source: "outbound",
    reasons: reasons.map((reason) => cut(reason, 200)),
    notes: cut(notes, 4000),
  };
}

/** Why searching is not possible right now, or undefined when it is. */
export function searchBlocker(reply: { configured: boolean; budget: { cap: number; remaining: number } } | undefined, requestsNeeded: number): string | undefined {
  if (!reply) return undefined;
  if (!reply.configured) return "GOOGLE_PLACES_API_KEY is not set. Add it in Connectors → Google Places.";
  if (reply.budget.cap === 0) return "Set AGENTOS_PLACES_MONTHLY_REQUEST_CAP in Connectors → Google Places. Searches are refused until a monthly cap is set.";
  if (reply.budget.remaining < requestsNeeded) return `This month's Places requests are used up (${reply.budget.cap} of ${reply.budget.cap}). Raise the cap to search again.`;
  return undefined;
}
