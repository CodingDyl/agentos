import express from "express";
import { CheckInSchema, DoneSchema, SwapSchema } from "../../shared/focus-types";
import { checkIn, FocusError, markDone, readDay, skip, swap } from "./today";
import { shortlist } from "./shortlist";

/** `/api/focus`: the morning check-in and today's three. */
export const focusRouter = express.Router();

function focusFail(response: express.Response, error: unknown, what: string): void {
  if (error instanceof FocusError) {
    response.status(409).json({ error: error.message });
    return;
  }
  console.error(`[agentos] could not ${what}:`, error);
  response.status(500).json({ error: `Could not ${what}.` });
}

async function today() {
  const [day, list] = await Promise.all([readDay(), shortlist()]);
  return { day, shortlist: list };
}

focusRouter.get("/today", async (_request, response) => {
  try {
    response.json(await today());
  } catch (error) {
    focusFail(response, error, "read today's focus");
  }
});

/** Saves the check-in, builds the shortlist, and has Hermes (or the rules) pick three. */
focusRouter.post("/check-in", async (request, response) => {
  const input = CheckInSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: "Choose your energy and time first." });
    return;
  }
  try {
    await checkIn(input.data);
    response.json(await today());
  } catch (error) {
    focusFail(response, error, "plan the day");
  }
});

focusRouter.post("/skip", async (_request, response) => {
  try {
    await skip();
    response.json(await today());
  } catch (error) {
    focusFail(response, error, "skip the check-in");
  }
});

focusRouter.post("/swap", async (request, response) => {
  const input = SwapSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: "Choose what to swap in." });
    return;
  }
  try {
    await swap(input.data.slot, input.data.candidateId);
    response.json(await today());
  } catch (error) {
    focusFail(response, error, "swap it");
  }
});

focusRouter.post("/done", async (request, response) => {
  const input = DoneSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: "Which one?" });
    return;
  }
  try {
    await markDone(input.data.candidateId, input.data.done);
    response.json(await today());
  } catch (error) {
    focusFail(response, error, "mark it done");
  }
});
