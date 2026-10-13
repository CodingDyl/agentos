import express from "express";
import { CleanupRequestSchema } from "../../shared/client-cleanup";
import { fail, parse } from "../traction/route-helpers";
import { CleanupError, listCleanupCandidates, previewCleanup, runCleanup } from "./client-cleanup";

/**
 * `/api/cleanup`: clearing out what was built for a business that never
 * showed interest. The business is named by id; the paths, repositories and
 * projects are always the ones AgentOS recorded when it made them, never
 * anything in a request.
 */
export const cleanupRouter = express.Router();

function cleanupFail(response: express.Response, error: unknown, what: string): void {
  if (error instanceof CleanupError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  fail(response, error, what);
}

/** Who could be cleaned up. No sizes: cheap. */
cleanupRouter.get("/candidates", async (_request, response) => {
  try {
    response.json({ candidates: await listCleanupCandidates() });
  } catch (error) {
    cleanupFail(response, error, "list what can be cleaned up");
  }
});

/** What would go, how big it is, and whether each item may be deleted. Deletes nothing. */
cleanupRouter.get("/:prospectId", async (request, response) => {
  try {
    response.json(await previewCleanup(request.params.prospectId));
  } catch (error) {
    cleanupFail(response, error, "preview the clean-up");
  }
});

/** Deletes the items you chose. The request names items only, and needs `confirm: true`. */
cleanupRouter.post("/:prospectId", async (request, response) => {
  const input = parse(CleanupRequestSchema, request.body, response, "clean-up");
  if (!input) return;
  try {
    response.json(await runCleanup(request.params.prospectId, input));
  } catch (error) {
    cleanupFail(response, error, "clean up");
  }
});
