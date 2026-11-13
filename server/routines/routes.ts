import express from "express";
import { RoutineIdSchema } from "../../shared/routine-types";
import { HermesError } from "../hermes/client";
import { buildFeed } from "./feeds";
import { installRoutine, listRoutines } from "./install";

/**
 * Routines, mounted at `/api/routines`. Local-only: the feed carries mail
 * subjects and client names, and installing writes into Hermes.
 */
export const routinesRouter = express.Router();

routinesRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Routines are only available on this machine." });
    return;
  }
  next();
});

function fail(response: express.Response, error: unknown): void {
  const known = error instanceof HermesError;
  if (!known) console.error("[agentos] routines request failed:", error instanceof Error ? error.message : error);
  response
    .status(known && error.reason === "not-configured" ? 503 : known ? 502 : 500)
    .json({ error: known ? error.message : "Routines could not do that." });
}

routinesRouter.get("/", async (_request, response) => {
  try {
    response.json(await listRoutines());
  } catch (error) {
    fail(response, error);
  }
});

/**
 * The message a routine sends, as plain text, for Hermes' script. An empty
 * body means "nothing to report".
 */
routinesRouter.get("/feed/:id", async (request, response) => {
  const id = RoutineIdSchema.safeParse(request.params.id);
  if (!id.success) {
    response.status(404).json({ error: "Unknown routine" });
    return;
  }
  try {
    response.type("text/plain").send(await buildFeed(id.data));
  } catch (error) {
    fail(response, error);
  }
});

/** The same message as JSON, for the Preview button. */
routinesRouter.get("/:id/preview", async (request, response) => {
  const id = RoutineIdSchema.safeParse(request.params.id);
  if (!id.success) {
    response.status(404).json({ error: "Unknown routine" });
    return;
  }
  try {
    response.json({ message: await buildFeed(id.data) });
  } catch (error) {
    fail(response, error);
  }
});

routinesRouter.post("/:id/install", async (request, response) => {
  const id = RoutineIdSchema.safeParse(request.params.id);
  if (!id.success) {
    response.status(404).json({ error: "Unknown routine" });
    return;
  }
  try {
    await installRoutine(id.data);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error);
  }
});
