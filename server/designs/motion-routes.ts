import express from "express";
import { MotionJobRequestSchema } from "../../shared/motion-types";
import {
  cancelMotionJob,
  createMotionJob,
  listMotionJobs,
  MotionUnavailableError,
  readMotionJob,
  reconcileMotionJobs,
  resumeMotionJob,
  sheetPath,
  studioInfo,
} from "./motion";

/**
 * The motion studio's API, mounted at `/api/designs/motion`.
 *
 * The browser sends a brief and reads progress back. It never names a file:
 * contact sheets are served by job id and a name matched against a pattern,
 * and finished films reach it only as Creative assets.
 */
export const motionRouter = express.Router();

// Films outlive AgentOS restarts; this picks up whatever was running.
void reconcileMotionJobs().catch((error) => console.error("[agentos] motion reconcile failed:", error));

motionRouter.get("/studio", async (_request, response) => {
  try {
    response.json({ studio: await studioInfo() });
  } catch (error) {
    console.error("[agentos] motion studio info failed:", error);
    response.status(500).json({ error: "Unable to read the motion studio prompts" });
  }
});

motionRouter.get("/", async (_request, response) => {
  try {
    response.json({ jobs: await listMotionJobs() });
  } catch (error) {
    console.error("[agentos] motion listing failed:", error);
    response.status(500).json({ error: "Unable to list motion videos" });
  }
});

motionRouter.post("/", async (request, response) => {
  const parsed = MotionJobRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That brief is incomplete." });
    return;
  }

  try {
    response.status(201).json({ job: await createMotionJob(parsed.data) });
  } catch (error) {
    if (error instanceof MotionUnavailableError) {
      response.status(409).json({ error: error.message });
      return;
    }
    console.error("[agentos] motion job failed to start:", error);
    response.status(500).json({ error: "Unable to start that motion video" });
  }
});

motionRouter.get("/:id", async (request, response) => {
  const job = await readMotionJob(request.params.id).catch(() => undefined);
  if (!job) {
    response.status(404).json({ error: "There is no such motion video." });
    return;
  }
  response.json({ job });
});

motionRouter.post("/:id/cancel", async (request, response) => {
  const job = await cancelMotionJob(request.params.id).catch(() => undefined);
  if (!job) {
    response.status(404).json({ error: "There is no such motion video." });
    return;
  }
  response.json({ job });
});

/** Resume a stopped film, or — with a note — revise a finished one. */
motionRouter.post("/:id/resume", async (request, response) => {
  const note = typeof request.body?.note === "string" ? request.body.note.slice(0, 4000) : undefined;
  const job = await resumeMotionJob(request.params.id, note).catch(() => undefined);
  if (!job) {
    response.status(404).json({ error: "There is no such motion video." });
    return;
  }
  response.json({ job });
});

motionRouter.get("/:id/sheets/:name", (request, response) => {
  const file = sheetPath(request.params.id, request.params.name);
  if (!file) {
    response.status(404).json({ error: "There is no such contact sheet." });
    return;
  }
  response.sendFile(file, { headers: { "Cache-Control": "private, max-age=60" } }, (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "There is no such contact sheet." });
  });
});
