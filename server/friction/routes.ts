import { Router } from "express";
import { ReportFrictionRequestSchema, UpdateFrictionRequestSchema, pageNameForRoute } from "../../shared/friction-types";
import { recordActivity } from "../activity/ui-events";
import { rankFriction } from "./ranking";
import { readFriction, reportFriction, updateFrictionStatus } from "./store";

/** `/api/friction` — report it, list it ranked, mark it fixed or ignored. */
export const frictionRouter = Router();

frictionRouter.get("/", async (_request, response) => {
  response.json(rankFriction(await readFriction()));
});

frictionRouter.post("/", async (request, response) => {
  const parsed = ReportFrictionRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Say what annoyed you (at least a few words), how often, and how much." });
    return;
  }
  try {
    const item = await reportFriction(parsed.data);
    await recordActivity({
      type: "friction.reported",
      description: `${item.description.slice(0, 120)}${pageNameForRoute(item.route) ? ` · ${pageNameForRoute(item.route)}` : ""}`,
      metadata: { frictionId: item.id, frequency: item.frequency, severity: item.severity },
    });
    response.status(201).json(item);
  } catch (error) {
    console.error("[friction] could not save a report:", error);
    response.status(500).json({ error: "The report could not be saved." });
  }
});

frictionRouter.patch("/:id", async (request, response) => {
  const parsed = UpdateFrictionRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "Status must be open, fixed or ignored." });
    return;
  }
  try {
    const item = await updateFrictionStatus(request.params.id, parsed.data.status);
    if (!item) {
      response.status(404).json({ error: "There is no friction item with that id." });
      return;
    }
    await recordActivity({
      type: "friction.updated",
      description: `${item.description.slice(0, 120)} → ${item.status}`,
      metadata: { frictionId: item.id, status: item.status },
    });
    response.json(item);
  } catch (error) {
    console.error("[friction] could not update an item:", error);
    response.status(500).json({ error: "The item could not be updated." });
  }
});
