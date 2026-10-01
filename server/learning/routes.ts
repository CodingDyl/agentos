import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  CreateNotebookRequestSchema,
  CreateNoteRequestSchema,
  ImportSourceRequestSchema,
  ProgressRequestSchema,
  PromoteNoteRequestSchema,
  SpotifyPlayRequestSchema,
  UpdateNotebookRequestSchema,
  UpdateNoteRequestSchema,
  UpdateSourceRequestSchema,
} from "../../shared/learning-types";
import { recordActivity } from "../activity/ui-events";
import { memoryService } from "../memory/service";
import { deleteSource, getSource, importSource, LearningRequestError, listSources, recordProgress, updateSource } from "./library";
import { createNotebook, deleteNotebook, getNotebook, listNotebooks, updateNotebook } from "./notebooks";
import { createNote, deleteNote, getNote, listNotes, promoteNote, updateNote } from "./notes";
import {
  buildSpotifyConsentUrl,
  completeSpotifyConnection,
  consumeConsentState,
  getDevices,
  getLibrary,
  getPlayback,
  getPlaylists,
  pause,
  play,
  sdkToken,
  seek,
  setVolume,
  skip,
  SpotifyError,
  spotifyStatus,
  transfer,
} from "./spotify";

/**
 * `/api/learning` — the library, notes and notebooks.
 * `/api/spotify`  — the connection and the player, proxied so no Spotify
 *                   credential ever lives in the browser.
 */

export const learningRouter = Router();
export const spotifyRouter = Router();

function fail(response: Response, error: unknown, fallback: string): void {
  if (error instanceof LearningRequestError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof SpotifyError) {
    response.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  console.error(`[learning] ${fallback}:`, error);
  response.status(500).json({ error: fallback });
}

function parse<T>(schema: z.ZodType<T>, request: Request, response: Response): T | undefined {
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That request could not be read." });
    return undefined;
  }
  return parsed.data;
}

// ------------------------------------------------------------------ library

learningRouter.get("/", async (_request, response) => {
  try {
    response.json({ sources: listSources(), notes: listNotes(), notebooks: await listNotebooks() });
  } catch (error) {
    fail(response, error, "The learning library could not be read");
  }
});

learningRouter.post("/sources", async (request, response) => {
  const body = parse(ImportSourceRequestSchema, request, response);
  if (!body) return;
  try {
    const result = await importSource(body);
    if (result.created) {
      await recordActivity({
        type: "learning.source_saved",
        description: `${result.source.title}${result.source.watchLater ? " · watch later" : ""}`,
        project: result.source.workspaceId,
        metadata: { sourceId: result.source.id, kind: result.source.kind },
      });
    }
    response.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    fail(response, error, "That address could not be saved");
  }
});

learningRouter.patch("/sources/:id", (request, response) => {
  const body = parse(UpdateSourceRequestSchema, request, response);
  if (!body) return;
  try {
    response.json(updateSource(request.params.id, body));
  } catch (error) {
    fail(response, error, "The source could not be updated");
  }
});

/** Playback position, every few seconds while something plays. Not an Activity event. */
learningRouter.put("/sources/:id/progress", (request, response) => {
  const body = parse(ProgressRequestSchema, request, response);
  if (!body) return;
  try {
    response.json(recordProgress(request.params.id, body));
  } catch (error) {
    fail(response, error, "Progress could not be saved");
  }
});

learningRouter.delete("/sources/:id", (request, response) => {
  try {
    deleteSource(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "The source could not be removed");
  }
});

// -------------------------------------------------------------------- notes

learningRouter.post("/notes", async (request, response) => {
  const body = parse(CreateNoteRequestSchema, request, response);
  if (!body) return;
  try {
    const note = createNote(body);
    await recordActivity({
      type: "learning.captured",
      description: note.title,
      project: note.workspaceId,
      metadata: { noteId: note.id, sourceType: note.sourceType, timestampSeconds: note.timestampSeconds, taskId: note.taskId },
    });
    response.status(201).json(note);
  } catch (error) {
    fail(response, error, "The learning could not be captured");
  }
});

learningRouter.patch("/notes/:id", (request, response) => {
  const body = parse(UpdateNoteRequestSchema, request, response);
  if (!body) return;
  try {
    response.json(updateNote(request.params.id, body));
  } catch (error) {
    fail(response, error, "The learning could not be updated");
  }
});

learningRouter.delete("/notes/:id", (request, response) => {
  try {
    deleteNote(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "The learning could not be deleted");
  }
});

/** A person approves a learning as memory. The request is the proposal they saw and edited. */
learningRouter.post("/notes/:id/promote", async (request, response) => {
  const body = parse(PromoteNoteRequestSchema, request, response);
  if (!body) return;
  try {
    const outcome = await promoteNote(memoryService(), request.params.id, body);
    if (outcome.outcome === "failed") {
      response.status(409).json({ error: outcome.error ?? "It could not be saved to memory.", outcome });
      return;
    }
    await recordActivity({
      type: "memory.proposal_saved",
      description: `${outcome.title} → ${outcome.target ?? "memory"} (from a learning)`,
      project: body.workspaceId,
      metadata: { noteId: request.params.id, target: outcome.target, outcome: outcome.outcome },
    });
    response.json({ outcome, note: getNote(request.params.id) });
  } catch (error) {
    fail(response, error, "The learning could not be promoted");
  }
});

// ---------------------------------------------------------------- notebooks

learningRouter.post("/notebooks", async (request, response) => {
  const body = parse(CreateNotebookRequestSchema, request, response);
  if (!body) return;
  try {
    const known = new Set(listSources().map((source) => source.id));
    const knownNotes = new Set(listNotes().map((note) => note.id));
    const notebook = await createNotebook({
      ...body,
      sourceIds: (body.sourceIds ?? []).filter((id) => known.has(id)),
      noteIds: (body.noteIds ?? []).filter((id) => knownNotes.has(id)),
    });
    await recordActivity({
      type: "learning.notebook_linked",
      description: `${notebook.name} · ${notebook.sourceIds.length + notebook.noteIds.length + notebook.externalSources.length} sources`,
      project: notebook.workspaceId,
      metadata: { notebookId: notebook.id, provider: notebook.provider },
    });
    response.status(201).json(notebook);
  } catch (error) {
    fail(response, error, "The notebook could not be saved");
  }
});

learningRouter.patch("/notebooks/:id", (request, response) => {
  const body = parse(UpdateNotebookRequestSchema, request, response);
  if (!body) return;
  try {
    response.json(updateNotebook(request.params.id, body));
  } catch (error) {
    fail(response, error, "The notebook could not be updated");
  }
});

learningRouter.delete("/notebooks/:id", (request, response) => {
  try {
    if (!getNotebook(request.params.id)) throw new LearningRequestError("There is no notebook with that id.", 404);
    deleteNotebook(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "The notebook could not be removed");
  }
});

learningRouter.get("/sources/:id", (request, response) => {
  const source = getSource(request.params.id);
  if (!source) {
    response.status(404).json({ error: "There is no saved source with that id." });
    return;
  }
  response.json(source);
});

// ------------------------------------------------------------------ spotify

spotifyRouter.get("/status", async (_request, response) => {
  response.json(await spotifyStatus());
});

spotifyRouter.get("/connect", (request, response) => {
  try {
    // The page the person clicked from is the reliable origin behind the dev proxy.
    response.redirect(buildSpotifyConsentUrl(request.get("referer")));
  } catch (error) {
    fail(response, error, "Spotify is not configured");
  }
});

/** Where Spotify sends the browser back. Never called by the frontend directly. */
spotifyRouter.get("/oauth/callback", async (request, response) => {
  const state = typeof request.query.state === "string" ? request.query.state : undefined;
  let origin = process.env.AGENTOS_WEB_ORIGIN ?? "http://localhost:1420";
  try {
    const consumed = consumeConsentState(state);
    origin = consumed.origin ?? origin;
    const code = typeof request.query.code === "string" ? request.query.code : undefined;
    if (!code) throw new SpotifyError(typeof request.query.error === "string" ? `Spotify said: ${request.query.error}.` : "Spotify didn't return a code.", "failed", 400);
    await completeSpotifyConnection(code);
    await recordActivity({ type: "learning.spotify_connected", description: "Spotify connected" });
    response.redirect(`${origin}/learning?tab=spotify&spotify=connected`);
  } catch (error) {
    const reason = error instanceof SpotifyError ? error.message : "Spotify could not be connected.";
    if (!(error instanceof SpotifyError)) console.error("[learning] spotify connection failed:", error);
    response.redirect(`${origin}/learning?tab=spotify&spotify=${encodeURIComponent(reason)}`);
  }
});

spotifyRouter.get("/player", async (_request, response) => {
  try {
    response.json({ playback: (await getPlayback()) ?? null });
  } catch (error) {
    fail(response, error, "Spotify playback could not be read");
  }
});

spotifyRouter.get("/devices", async (_request, response) => {
  try {
    response.json({ devices: await getDevices() });
  } catch (error) {
    fail(response, error, "Spotify devices could not be read");
  }
});

spotifyRouter.get("/playlists", async (_request, response) => {
  try {
    response.json({ playlists: await getPlaylists() });
  } catch (error) {
    fail(response, error, "Spotify playlists could not be read");
  }
});

spotifyRouter.get("/library", async (_request, response) => {
  try {
    response.json(await getLibrary());
  } catch (error) {
    fail(response, error, "The Spotify library could not be read");
  }
});

spotifyRouter.post("/player/play", async (request, response) => {
  const body = parse(SpotifyPlayRequestSchema, request, response);
  if (!body) return;
  try {
    await play(body);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "Spotify didn't start playing");
  }
});

spotifyRouter.post("/player/pause", async (_request, response) => {
  try {
    await pause();
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "Spotify didn't pause");
  }
});

for (const direction of ["next", "previous"] as const) {
  spotifyRouter.post(`/player/${direction}`, async (_request, response) => {
    try {
      await skip(direction);
      response.json({ ok: true });
    } catch (error) {
      fail(response, error, "Spotify didn't skip");
    }
  });
}

spotifyRouter.put("/player/seek", async (request, response) => {
  const body = parse(z.object({ positionMs: z.number().int().nonnegative() }), request, response);
  if (!body) return;
  try {
    await seek(body.positionMs);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "Spotify didn't seek");
  }
});

spotifyRouter.put("/player/volume", async (request, response) => {
  const body = parse(z.object({ percent: z.number().min(0).max(100) }), request, response);
  if (!body) return;
  try {
    await setVolume(body.percent);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "Spotify didn't change the volume");
  }
});

spotifyRouter.put("/player/transfer", async (request, response) => {
  const body = parse(z.object({ deviceId: z.string().min(1).max(100), play: z.boolean().optional() }), request, response);
  if (!body) return;
  try {
    await transfer(body.deviceId, body.play ?? false);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "Playback couldn't move to that device");
  }
});

/**
 * A short-lived token for Spotify's Web Playback SDK, which needs one to play
 * inside AgentOS. Not cached by the caller; the refresh token never leaves.
 */
spotifyRouter.post("/sdk-token", async (_request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    response.json(await sdkToken());
  } catch (error) {
    fail(response, error, "The in-app player couldn't get a token");
  }
});
