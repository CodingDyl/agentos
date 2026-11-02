import express from "express";
import { PitchDraftRequestSchema, PitchQuoteRequestSchema, PitchShotsRequestSchema } from "../../shared/pitch-types";
import { BusinessLedgerError } from "../business/ledger-store";
import { CaseError, draftCase } from "../outreach/cases";
import { assemblePitch, capturePitchShots, createPitchQuote, listPitches, PitchError, preparePitchCase } from "./pitch";
import { fail, parse } from "./route-helpers";

/**
 * `/api/traction/pitch`: the Pitch Pack for prospects whose rebuild has a
 * preview. Local only, JSON only, every body checked with zod. Nothing here
 * sends an email, deploys or charges: drafts and quotes are drafts until a
 * person acts on them in the existing mail and Business flows.
 */
export const pitchRouter = express.Router();

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

pitchRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!LOOPBACK.includes(request.hostname)) {
    response.status(403).json({ error: "Pitches are only available on this machine." });
    return;
  }
  const origin = request.get("origin");
  if (origin) {
    try {
      if (!LOOPBACK.includes(new URL(origin).hostname)) throw new Error("remote origin");
    } catch {
      response.status(403).json({ error: "Open Traction from the local AgentOS app." });
      return;
    }
  }
  if (request.method !== "GET" && !request.is("application/json")) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

function pitchFail(response: express.Response, error: unknown, what: string): void {
  if (error instanceof PitchError || error instanceof BusinessLedgerError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof CaseError) {
    response.status(422).json({ error: error.message });
    return;
  }
  fail(response, error, what);
}

pitchRouter.get("/", async (_request, response) => {
  try {
    response.json({ pitches: await listPitches() });
  } catch (error) {
    pitchFail(response, error, "read the pitches");
  }
});

/** `?check=1` also reads their current site (cached for an hour) for the findings. */
pitchRouter.get("/:prospectId", async (request, response) => {
  try {
    response.json({ pitch: await assemblePitch(request.params.prospectId, { check: request.query.check === "1" }) });
  } catch (error) {
    pitchFail(response, error, "assemble the pitch");
  }
});

/** Before/after screenshots the rebuild does not have yet, taken with its own screenshot code. */
pitchRouter.post("/:prospectId/screenshots", async (request, response) => {
  if (!parse(PitchShotsRequestSchema, request.body, response, "screenshot request")) return;
  try {
    const { taken } = await capturePitchShots(request.params.prospectId);
    response.json({ taken, pitch: await assemblePitch(request.params.prospectId) });
  } catch (error) {
    pitchFail(response, error, "take the screenshots");
  }
});

/**
 * Hermes drafts the pitch through the existing case path, with the preview
 * link. The draft is saved on the case for you to review; nothing is sent.
 */
pitchRouter.post("/:prospectId/draft", async (request, response) => {
  const input = parse(PitchDraftRequestSchema, request.body, response, "draft request");
  if (!input) return;
  try {
    await preparePitchCase(request.params.prospectId);
    response.json({ case: await draftCase(request.params.prospectId, undefined, { exampleId: input.exampleId, pitch: true }) });
  } catch (error) {
    pitchFail(response, error, "draft the pitch");
  }
});

/** A draft quote in Business from the case's prices. Returns the existing one instead of a duplicate. */
pitchRouter.post("/:prospectId/quote", async (request, response) => {
  const input = parse(PitchQuoteRequestSchema, request.body, response, "quote request");
  if (!input) return;
  try {
    const result = await createPitchQuote(request.params.prospectId, input);
    response.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    pitchFail(response, error, "create the quote");
  }
});
