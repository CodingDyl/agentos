import express from "express";
import { AnimateDecisionSchema, AnimateRequestSchema } from "../../shared/animate-types";
import {
  AnimateUnavailableError,
  animateStudio,
  cancelAnimateJob,
  checkpointImagePath,
  createAnimateJob,
  decideAnimateJob,
  listAnimateJobs,
  readAnimateJob,
  reconcileAnimateJobs,
  resumeAnimateJob,
  samplePath,
} from "./animate";

/**
 * Claude Motion's API, mounted at `/api/designs/animate`.
 *
 * The browser sends the intake and the decisions at each review gate. It never
 * names a file: checkpoint frames and style samples are served by id and a
 * name matched against a pattern, and finished videos reach it only as
 * Creative assets.
 */
export const animateRouter = express.Router();

void reconcileAnimateJobs().catch((error) => console.error("[agentos] animate reconcile failed:", error));

const missing = { error: "There is no such Claude Motion video." };

animateRouter.get("/studio", async (_request, response) => {
  try {
    response.json({ studio: await animateStudio() });
  } catch (error) {
    console.error("[agentos] animate studio info failed:", error);
    response.status(500).json({ error: "Unable to read the Animate skill" });
  }
});

animateRouter.get("/styles/:id/sample.png", async (request, response) => {
  const file = await samplePath(request.params.id);
  if (!file) {
    response.status(404).json({ error: "There is no such style sample." });
    return;
  }
  response.sendFile(file, { dotfiles: "allow", headers: { "Cache-Control": "private, max-age=300" } }, (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "There is no such style sample." });
  });
});

animateRouter.get("/", async (_request, response) => {
  try {
    response.json({ jobs: await listAnimateJobs() });
  } catch (error) {
    console.error("[agentos] animate listing failed:", error);
    response.status(500).json({ error: "Unable to list Claude Motion videos" });
  }
});

animateRouter.post("/", async (request, response) => {
  const parsed = AnimateRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That intake is incomplete." });
    return;
  }
  try {
    response.status(201).json({ job: await createAnimateJob(parsed.data) });
  } catch (error) {
    if (error instanceof AnimateUnavailableError) {
      response.status(409).json({ error: error.message });
      return;
    }
    console.error("[agentos] animate job failed to start:", error);
    response.status(500).json({ error: "Unable to start Claude Motion" });
  }
});

animateRouter.get("/:id", async (request, response) => {
  const job = await readAnimateJob(request.params.id).catch(() => undefined);
  if (!job) {
    response.status(404).json(missing);
    return;
  }
  response.json({ job });
});

animateRouter.post("/:id/cancel", async (request, response) => {
  const job = await cancelAnimateJob(request.params.id).catch(() => undefined);
  if (!job) {
    response.status(404).json(missing);
    return;
  }
  response.json({ job });
});

animateRouter.post("/:id/decision", async (request, response) => {
  const parsed = AnimateDecisionSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That decision is incomplete." });
    return;
  }
  const result = await decideAnimateJob(request.params.id, parsed.data.decision, parsed.data.note).catch(() => undefined);
  if (!result) {
    response.status(404).json(missing);
    return;
  }
  if ("error" in result) {
    response.status(409).json(result);
    return;
  }
  response.json({ job: result });
});

animateRouter.post("/:id/resume", async (request, response) => {
  const note = typeof request.body?.note === "string" ? request.body.note.slice(0, 4000) : undefined;
  const job = await resumeAnimateJob(request.params.id, note).catch(() => undefined);
  if (!job) {
    response.status(404).json(missing);
    return;
  }
  response.json({ job });
});

animateRouter.get("/:id/checkpoints/:stage/:name", (request, response) => {
  const file = checkpointImagePath(request.params.id, request.params.stage, request.params.name);
  if (!file) {
    response.status(404).json({ error: "There is no such frame." });
    return;
  }
  response.sendFile(file, { dotfiles: "allow", headers: { "Cache-Control": "private, max-age=60" } }, (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "There is no such frame." });
  });
});
