import express from "express";
import { RebuildDecisionInputSchema, RebuildStageIdSchema, RebuildStartSchema } from "../../shared/website-rebuild-types";
import { advanceInBackground, currentSkillVersion } from "./runner";
import { createOrReuseRun, decide, listRuns, readRun, RebuildError, recoverAbandonedStages, resetForRetry, runForProspect } from "./store";

/**
 * Website rebuilds. Every route answers with the run's full state, so the page
 * never has to merge partial updates. Work happens in the background; the page
 * polls `GET /:id` while a stage is in progress.
 */
export const rebuildRouter = express.Router();

rebuildRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  // Client research and approvals are local: no DNS rebinding, no cross-site forms.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Website rebuilds are only available on this machine." });
    return;
  }
  if (request.method !== "GET" && !request.is("application/json")) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

function fail(response: express.Response, error: unknown): void {
  if (error instanceof RebuildError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[agentos] website rebuild request failed:", error instanceof Error ? error.message : error);
  response.status(500).json({ error: "The website rebuild request failed." });
}

function stageParam(value: string): ReturnType<typeof RebuildStageIdSchema.parse> {
  const parsed = RebuildStageIdSchema.safeParse(value);
  if (!parsed.success) throw new RebuildError("No such stage.", 404);
  return parsed.data;
}

rebuildRouter.get("/", (_request, response) => {
  try {
    response.json({ runs: listRuns() });
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.get("/by-prospect/:prospectId", (request, response) => {
  try {
    const run = runForProspect(request.params.prospectId);
    if (!run) throw new RebuildError("No rebuild for that prospect yet.", 404);
    response.json(run);
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.get("/:id", (request, response) => {
  try {
    response.json(readRun(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

/** Starts a rebuild, or returns the one this prospect already has. */
rebuildRouter.post("/", async (request, response) => {
  const parsed = RebuildStartSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(422).json({ error: parsed.error.issues[0]?.message ?? "Fill in every field." });
    return;
  }
  try {
    const { run, created } = createOrReuseRun({ ...parsed.data, skillVersion: await currentSkillVersion() });
    advanceInBackground(run.id);
    response.status(created ? 201 : 200).json(run);
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.post("/:id/stages/:stage/retry", (request, response) => {
  try {
    resetForRetry(readRun(request.params.id).id, stageParam(request.params.stage));
    advanceInBackground(request.params.id);
    response.json(readRun(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.post("/:id/stages/:stage/approve", (request, response) => {
  const input = RebuildDecisionInputSchema.safeParse(request.body);
  if (!input.success) {
    response.status(422).json({ error: "Say which revision you reviewed." });
    return;
  }
  try {
    decide(readRun(request.params.id).id, stageParam(request.params.stage), input.data.revision, "approved", input.data.note);
    advanceInBackground(request.params.id);
    response.json(readRun(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

rebuildRouter.post("/:id/stages/:stage/request-changes", (request, response) => {
  const input = RebuildDecisionInputSchema.safeParse(request.body);
  if (!input.success) {
    response.status(422).json({ error: "Say which revision you reviewed and what should change." });
    return;
  }
  try {
    decide(readRun(request.params.id).id, stageParam(request.params.stage), input.data.revision, "changes_requested", input.data.note);
    advanceInBackground(request.params.id);
    response.json(readRun(request.params.id));
  } catch (error) {
    fail(response, error);
  }
});

/** Called once at server start: stages a previous process was running have no worker any more. */
export function recoverRebuildsAtStartup(): void {
  try {
    const recovered = recoverAbandonedStages({ atStartup: true });
    if (recovered > 0) console.log(`[agentos] website rebuild: ${recovered} interrupted stage${recovered === 1 ? "" : "s"} marked for retry.`);
  } catch (error) {
    console.error("[agentos] website rebuild recovery failed:", error);
  }
}
