import express, { type Response } from "express";
import { z } from "zod";
import { SiteChecksRequestSchema } from "../../shared/places-types";
import { isPlacesConfigured, PlacesError, RADIUS_MAX_KM, RADIUS_MIN_KM } from "./client";
import { NICHES } from "./niches";
import { runSearch } from "./search";
import { checkSites } from "./site-check";
import { placesBudget } from "./usage";

/**
 * `/api/traction/places`.
 *
 * The body is parsed here and checked again by the client. Nothing from a
 * search is stored: the page holds the results until a business is imported.
 */
export const placesRouter = express.Router();

const SearchBodySchema = z.object({
  area: z.string().max(200),
  nicheId: z.string().max(60),
  radiusKm: z.number(),
});

const STATUS: Record<PlacesError["reason"], number> = {
  invalid: 422,
  "bad-area": 422,
  "not-configured": 409,
  off: 409,
  "no-cap": 409,
  quota: 429,
  unauthorized: 502,
  failed: 502,
};

function fail(response: Response, error: unknown): void {
  if (error instanceof PlacesError) {
    response.status(STATUS[error.reason]).json({ error: error.message, reason: error.reason });
    return;
  }
  console.error("[agentos] places: search failed:", error);
  response.status(500).json({ error: "Unable to search Google Places" });
}

/** What the dropdown needs, and whether searching can work at all right now. */
placesRouter.get("/niches", (_request, response) => {
  response.json({
    niches: NICHES,
    radius: { min: RADIUS_MIN_KM, max: RADIUS_MAX_KM },
    configured: isPlacesConfigured(),
    budget: placesBudget(),
  });
});

placesRouter.post("/search", async (request, response) => {
  const parsed = SearchBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    response.status(400).json({ error: `Invalid search${issue ? `: ${issue.path.join(".") || "body"}: ${issue.message}` : ""}` });
    return;
  }

  try {
    response.json(await runSearch(parsed.data));
  } catch (error) {
    fail(response, error);
  }
});

/**
 * Reads the websites of businesses a search found. Costs no Places requests:
 * the pages are fetched through the guarded fetcher, a few at a time, and
 * nothing is stored.
 */
placesRouter.post("/check-sites", async (request, response) => {
  const parsed = SiteChecksRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    response.status(400).json({ error: `Invalid site check${issue ? `: ${issue.path.join(".") || "body"}: ${issue.message}` : ""}` });
    return;
  }

  try {
    response.json({ checks: await checkSites(parsed.data.websites, undefined, undefined, parsed.data.reviews) });
  } catch (error) {
    fail(response, error);
  }
});
