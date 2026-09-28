import express, { type Response } from "express";
import type { ZodType } from "zod";
import {
  ExperimentInputSchema,
  IcpInputSchema,
  OfferInputSchema,
  ProspectInputSchema,
  ProspectPatchSchema,
  QueueActionSchema,
  WeeklyTargetsSchema,
} from "../../shared/traction-types";
import { isoDate } from "./engine";
import {
  completeQueueItem,
  createExperiment,
  createOffer,
  createProspect,
  deleteExperiment,
  deleteOffer,
  deleteProspect,
  replaceExperiment,
  replaceOffer,
  saveIcp,
  saveTargets,
  snoozeQueueItem,
  TractionNotFoundError,
  updateProspect,
} from "./store";
import { getTraction } from "./traction";

/**
 * `/api/traction`.
 *
 * A separate router rather than more lines in `server/index.ts`: Traction is
 * a module with its own store, and its routes belong beside it.
 *
 * Every body is parsed with the shared schema before it reaches the store, and
 * every id in a path is matched against records the store already holds —
 * nothing a request sends becomes a file path.
 *
 * Nothing here sends anything. Outreach is drafted and sent by a person; these
 * routes only record what they did.
 */
export const tractionRouter = express.Router();

function parse<T>(schema: ZodType<T>, body: unknown, response: Response, what: string): T | undefined {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  response.status(400).json({ error: `Invalid ${what}${issue ? `: ${issue.path.join(".") || "body"} — ${issue.message}` : ""}` });
  return undefined;
}

function fail(response: Response, error: unknown, what: string): void {
  if (error instanceof TractionNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }

  console.error(`[agentos] traction: ${what} failed:`, error);
  response.status(500).json({ error: `Unable to ${what}` });
}

tractionRouter.get("/", async (_request, response) => {
  try {
    response.json(await getTraction());
  } catch (error) {
    fail(response, error, "read Traction");
  }
});

tractionRouter.post("/prospects", async (request, response) => {
  const input = parse(ProspectInputSchema, request.body, response, "prospect");
  if (!input) return;

  try {
    response.status(201).json({ prospect: await createProspect(input) });
  } catch (error) {
    fail(response, error, "add the prospect");
  }
});

tractionRouter.patch("/prospects/:id", async (request, response) => {
  const patch = parse(ProspectPatchSchema, request.body, response, "prospect change");
  if (!patch) return;

  try {
    response.json({ prospect: await updateProspect(request.params.id, patch) });
  } catch (error) {
    fail(response, error, "update the prospect");
  }
});

tractionRouter.delete("/prospects/:id", async (request, response) => {
  try {
    await deleteProspect(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the prospect");
  }
});

/** A person did the thing (`done`), or put it off (`snooze`). */
tractionRouter.post("/queue/:itemId", async (request, response) => {
  const action = parse(QueueActionSchema, request.body, response, "queue action");
  if (!action) return;

  try {
    if (action.action === "done") {
      response.json({ prospect: await completeQueueItem(request.params.itemId) });
    } else {
      await snoozeQueueItem(request.params.itemId, isoDate(new Date()), action.days);
      response.json({ ok: true });
    }
  } catch (error) {
    fail(response, error, "update the queue");
  }
});

tractionRouter.put("/icp", async (request, response) => {
  const input = parse(IcpInputSchema, request.body, response, "ICP");
  if (!input) return;

  try {
    response.json({ icp: await saveIcp(input) });
  } catch (error) {
    fail(response, error, "save the ICP");
  }
});

tractionRouter.put("/targets", async (request, response) => {
  const input = parse(WeeklyTargetsSchema, request.body, response, "weekly targets");
  if (!input) return;

  try {
    response.json({ targets: await saveTargets(input) });
  } catch (error) {
    fail(response, error, "save the weekly targets");
  }
});

tractionRouter.post("/offers", async (request, response) => {
  const input = parse(OfferInputSchema, request.body, response, "offer");
  if (!input) return;

  try {
    response.status(201).json({ offer: await createOffer(input) });
  } catch (error) {
    fail(response, error, "add the offer");
  }
});

tractionRouter.put("/offers/:id", async (request, response) => {
  const input = parse(OfferInputSchema, request.body, response, "offer");
  if (!input) return;

  try {
    response.json({ offer: await replaceOffer(request.params.id, input) });
  } catch (error) {
    fail(response, error, "update the offer");
  }
});

tractionRouter.delete("/offers/:id", async (request, response) => {
  try {
    await deleteOffer(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the offer");
  }
});

tractionRouter.post("/experiments", async (request, response) => {
  const input = parse(ExperimentInputSchema, request.body, response, "experiment");
  if (!input) return;

  try {
    response.status(201).json({ experiment: await createExperiment(input) });
  } catch (error) {
    fail(response, error, "add the experiment");
  }
});

tractionRouter.put("/experiments/:id", async (request, response) => {
  const input = parse(ExperimentInputSchema, request.body, response, "experiment");
  if (!input) return;

  try {
    response.json({ experiment: await replaceExperiment(request.params.id, input) });
  } catch (error) {
    fail(response, error, "update the experiment");
  }
});

tractionRouter.delete("/experiments/:id", async (request, response) => {
  try {
    await deleteExperiment(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "remove the experiment");
  }
});
