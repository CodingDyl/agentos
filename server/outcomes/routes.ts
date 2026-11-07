import { Router } from "express";
import { LogOwnerHoursRequestSchema } from "../../shared/outcomes-types";
import { recordActivity } from "../activity/ui-events";
import { computeOutcomes, currentMonth } from "./compute";
import { deleteOwnerHours, logOwnerHours } from "./hours-store";
import { gatherOutcomeInputs } from "./sources";

/** `/api/outcomes` — what agent work earned, and the hours the owner put in. */
export const outcomesRouter = Router();

outcomesRouter.get("/", async (_request, response) => {
  try {
    const now = new Date();
    response.json(computeOutcomes(await gatherOutcomeInputs(currentMonth(now)), now));
  } catch (error) {
    console.error("[outcomes] could not be computed:", error);
    response.status(500).json({ error: "The scorecard could not be worked out." });
  }
});

outcomesRouter.post("/hours", async (request, response) => {
  const parsed = LogOwnerHoursRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Give a date, between 1 and 1440 minutes, and what kind of work it was." });
    return;
  }
  try {
    const entry = await logOwnerHours(parsed.data);
    await recordActivity({
      type: "outcomes.hours_logged",
      description: `${entry.minutes} min · ${entry.kind}`,
      metadata: { hoursId: entry.id, kind: entry.kind },
    });
    response.status(201).json(entry);
  } catch (error) {
    console.error("[outcomes] could not save hours:", error);
    response.status(500).json({ error: "The hours could not be saved." });
  }
});

outcomesRouter.delete("/hours/:id", async (request, response) => {
  try {
    if (!(await deleteOwnerHours(request.params.id))) {
      response.status(404).json({ error: "There is no logged entry with that id." });
      return;
    }
    response.status(204).end();
  } catch (error) {
    console.error("[outcomes] could not delete hours:", error);
    response.status(500).json({ error: "The entry could not be removed." });
  }
});
