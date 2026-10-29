import { Router, type Request, type Response } from "express";
import matter from "gray-matter";
import { z } from "zod";
import {
  DecideRequestSchema,
  PasteTranscriptRequestSchema,
  StartIdeaRequestSchema,
  type VideoIdeaReadiness,
} from "../../shared/video-ideas-types";
import { readOptionalFile } from "../agentos/filesystem";
import { findOnPath } from "../ai-stack/detect";
import { authorize } from "../connectors/policy";
import { getSource } from "../learning/library";
import { slugify } from "../reengineer/library";
import { writeTranscript } from "./note";
import { decide } from "./plan";
import { advanceIdea, retryIdea, writeNoteFor } from "./pipeline";
import { createIdea, getIdea, ideaForSource, listIdeas, updateIdea, VideoIdeaError } from "./store";
import { fetchCaptions, linesFromPaste, transcriptText, ytDlpPath } from "./transcript";

/** `/api/video-ideas` — learn from a saved video, and decide whether AgentOS adopts it. */
export const videoIdeasRouter = Router();

function fail(response: Response, error: unknown, fallback: string): void {
  if (error instanceof VideoIdeaError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error(`[video-ideas] ${fallback}:`, error);
  response.status(500).json({ error: error instanceof Error ? error.message : fallback });
}

function parse<T>(schema: z.ZodType<T>, request: Request, response: Response): T | undefined {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: result.error.issues[0]?.message ?? "That request is not valid." });
    return undefined;
  }
  return result.data;
}

/** Off in Connectors means AgentOS doesn't contact YouTube at all. */
function allowYouTube(videoId: string): void {
  const decision = authorize("youtube.import_video", { initiator: "person", detail: videoId });
  if (!decision.allowed) throw new VideoIdeaError(decision.reason, 409);
}

/** Takes the next step now rather than waiting for the sweep. Errors land on the idea. */
function kick(id: string): void {
  const idea = getIdea(id);
  if (idea) void advanceIdea(idea).catch(() => undefined);
}

export async function readiness(): Promise<VideoIdeaReadiness> {
  const [ytDlp, claude] = await Promise.all([ytDlpPath(), findOnPath("claude")]);
  const missing = [
    ...(ytDlp ? [] : ["Install yt-dlp to read captions: brew install yt-dlp"]),
    ...(claude ? [] : ["Install Claude Code (`claude`) to write notes."]),
  ];
  return { ytDlp: Boolean(ytDlp), claude: Boolean(claude), missing };
}

videoIdeasRouter.get("/", (_request, response) => {
  try {
    response.json({ ideas: listIdeas() });
  } catch (error) {
    fail(response, error, "Could not list video ideas");
  }
});

videoIdeasRouter.get("/readiness", async (_request, response) => {
  response.json(await readiness());
});

videoIdeasRouter.post("/", async (request, response) => {
  const body = parse(StartIdeaRequestSchema, request, response);
  if (!body) return;
  try {
    const source = getSource(body.sourceId);
    if (!source || source.kind !== "youtube") throw new VideoIdeaError("That isn't a saved YouTube video.", 404);
    allowYouTube(source.externalId);
    const ready = await readiness();
    if (ready.missing.length > 0) throw new VideoIdeaError(ready.missing.join(" "), 409);
    const idea = createIdea(source, body.mode);
    kick(idea.id);
    response.status(201).json({ idea });
  } catch (error) {
    fail(response, error, "Could not start the video idea");
  }
});

/** The transcript as a `.txt` file: the one already filed, or the captions fetched now. */
videoIdeasRouter.get("/sources/:sourceId/transcript.txt", async (request, response) => {
  try {
    const source = getSource(request.params.sourceId);
    if (!source || source.kind !== "youtube") throw new VideoIdeaError("That isn't a saved YouTube video.", 404);
    const idea = ideaForSource(source.id);
    const filed = idea?.transcriptPath ? await readOptionalFile(idea.transcriptPath) : undefined;
    let text = filed ? matter(filed).content.replace(/^# .*\n+/, "").trim() : undefined;
    if (!text) {
      allowYouTube(source.externalId);
      const lines = await fetchCaptions(source.externalId);
      if (!lines) throw new VideoIdeaError("This video has no captions", 404);
      text = transcriptText(lines);
    }
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${slugify(source.title, source.externalId)}.txt"`);
    response.send(`${source.title}\n${source.url}\n\n${text}\n`);
  } catch (error) {
    fail(response, error, "Could not get the transcript");
  }
});

videoIdeasRouter.get("/:id", (request, response) => {
  const idea = getIdea(request.params.id);
  if (!idea) {
    response.status(404).json({ error: "There is no video idea with that id." });
    return;
  }
  response.json({ idea });
});

videoIdeasRouter.get("/:id/assessment", async (request, response) => {
  try {
    const idea = getIdea(request.params.id);
    if (!idea) throw new VideoIdeaError("There is no video idea with that id.", 404);
    const file = idea.assessmentPath ? await readOptionalFile(idea.assessmentPath) : undefined;
    if (!file) throw new VideoIdeaError("This idea has no assessment yet.", 404);
    response.json({ markdown: matter(file).content.trim(), path: idea.assessmentPath });
  } catch (error) {
    fail(response, error, "Could not read the assessment");
  }
});

videoIdeasRouter.post("/:id/transcript", async (request, response) => {
  const body = parse(PasteTranscriptRequestSchema, request, response);
  if (!body) return;
  try {
    const idea = getIdea(request.params.id);
    if (!idea) throw new VideoIdeaError("There is no video idea with that id.", 404);
    if (idea.stage !== "needs_transcript") throw new VideoIdeaError("This video doesn't need a transcript.", 409);
    const lines = linesFromPaste(body.text);
    if (lines.length === 0) throw new VideoIdeaError("That transcript is empty.");
    const transcriptPath = await writeTranscript(idea, lines);
    const noting = updateIdea(idea.id, { stage: "noting", error: undefined, transcriptPath });
    void writeNoteFor(noting, lines).catch((error: unknown) =>
      updateIdea(idea.id, { stage: "failed", failedAt: "needs_transcript", error: error instanceof Error ? error.message : String(error) }),
    );
    response.json({ idea: noting });
  } catch (error) {
    fail(response, error, "Could not save the transcript");
  }
});

videoIdeasRouter.post("/:id/decide", async (request, response) => {
  const body = parse(DecideRequestSchema, request, response);
  if (!body) return;
  try {
    response.json({ idea: await decide(request.params.id, body) });
  } catch (error) {
    fail(response, error, "Could not record the decision");
  }
});

videoIdeasRouter.post("/:id/retry", async (request, response) => {
  try {
    const idea = await retryIdea(request.params.id);
    kick(idea.id);
    response.json({ idea });
  } catch (error) {
    fail(response, error, "Could not retry");
  }
});
