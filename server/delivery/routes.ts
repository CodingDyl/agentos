import express from "express";
import { DeliveryStartSchema } from "../../shared/delivery-types";
import { getProjects } from "../agentos/projects";
import { isSkillEnabled } from "../skills/registry";
import { advanceInBackground, currentSkillVersion } from "../website-rebuild/runner";
import { listRuns, readRun, RebuildError } from "../website-rebuild/store";
import { deliveryOverview } from "./overview";
import { startDelivery } from "./start";

/** Delivery: the workspaces and their rebuilds in one place. The rebuild's own routes do the stage work. */
export const deliveryRouter = express.Router();

function fail(response: express.Response, error: unknown): void {
  if (error instanceof RebuildError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[agentos] delivery request failed:", error instanceof Error ? error.message : error);
  response.status(500).json({ error: "The delivery request failed." });
}

deliveryRouter.get("/", async (_request, response) => {
  try {
    response.json(deliveryOverview(await getProjects(), listRuns(), readRun));
  } catch (error) {
    fail(response, error);
  }
});

/** Starts a workspace's delivery, or resumes the run it already has (200 with that run). */
deliveryRouter.post("/start", async (request, response) => {
  const parsed = DeliveryStartSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(422).json({ error: parsed.error.issues[0]?.message ?? "Fill in every field." });
    return;
  }
  try {
    const { run, created } = await startDelivery(parsed.data, { projects: () => getProjects(), skillEnabled: isSkillEnabled, skillVersion: currentSkillVersion, advance: advanceInBackground });
    response.status(created ? 201 : 200).json(run);
  } catch (error) {
    fail(response, error);
  }
});
