import express from "express";
import { ReengineerRequestSchema, VerdictInputSchema } from "../../shared/reengineer-types";
import { libraryBrief, listLibrary, mediaPath, recordVerdict } from "./library";
import { launchReengineer, listRunViews, ReengineerError, readiness, runView } from "./runs";

/**
 * Reengineer's API, mounted at `/api/reengineer`: start a teardown, read the
 * runs and the library, and record verdicts. Local-only, like the other
 * surfaces that start agents.
 */
export const reengineerRouter = express.Router();

reengineerRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Reengineer is only available on this machine." });
    return;
  }
  if (request.method !== "GET" && !request.is("application/json")) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

function fail(response: express.Response, error: unknown): void {
  if (error instanceof ReengineerError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("[agentos] reengineer request failed:", error instanceof Error ? error.message : error);
  response.status(500).json({ error: "Reengineer could not do that." });
}

reengineerRouter.get("/readiness", async (_request, response) => {
  try {
    response.json({ readiness: await readiness() });
  } catch (error) {
    fail(response, error);
  }
});

reengineerRouter.get("/runs", async (_request, response) => {
  try {
    response.json({ runs: await listRunViews() });
  } catch (error) {
    fail(response, error);
  }
});

reengineerRouter.post("/runs", async (request, response) => {
  const parsed = ReengineerRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That request is incomplete." });
    return;
  }
  try {
    const run = await launchReengineer(parsed.data);
    response.status(201).json({ run: await runView(run.id) });
  } catch (error) {
    fail(response, error);
  }
});

reengineerRouter.get("/runs/:id", async (request, response) => {
  try {
    const run = await runView(request.params.id);
    if (!run) {
      response.status(404).json({ error: "There is no such teardown." });
      return;
    }
    response.json({ run });
  } catch (error) {
    fail(response, error);
  }
});

reengineerRouter.get("/library", async (_request, response) => {
  try {
    response.json({ entries: await listLibrary() });
  } catch (error) {
    fail(response, error);
  }
});

/** The library as text a worker can read before it builds. */
reengineerRouter.get("/library/brief", async (request, response) => {
  try {
    const text = libraryBrief(await listLibrary(), {
      kind: typeof request.query.kind === "string" ? request.query.kind : undefined,
      tag: typeof request.query.tag === "string" ? request.query.tag : undefined,
      candidates: request.query.candidates === "1",
    });
    response.json({ brief: text });
  } catch (error) {
    fail(response, error);
  }
});

reengineerRouter.post("/library/:id/verdict", async (request, response) => {
  const parsed = VerdictInputSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "That isn't a verdict." });
    return;
  }
  try {
    const entry = await recordVerdict(request.params.id, parsed.data.verdict, parsed.data.note, parsed.data.workspace);
    if (!entry) {
      response.status(404).json({ error: "There is no such library entry." });
      return;
    }
    response.json({ entry });
  } catch (error) {
    fail(response, error);
  }
});

reengineerRouter.get("/media", (request, response) => {
  const file = typeof request.query.path === "string" ? mediaPath(request.query.path) : undefined;
  if (!file) {
    response.status(404).json({ error: "That image isn't part of the library." });
    return;
  }
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.sendFile(file, { dotfiles: "allow", headers: { "Cache-Control": "private, max-age=300" } }, (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "That image isn't part of the library." });
  });
});
