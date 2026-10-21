import express from "express";
import { z, ZodError } from "zod";
import {
  EditableStageSchema,
  PersonaSchema,
  STAGE_SCHEMAS,
  StageAnswersSchema,
  stageProblems,
  type EditableStage,
  type StageContent,
  type Venture,
} from "../../shared/startup-types";
import { RevisionConflictError } from "../agentos/mutations/revision";
import { DocumentInvalidError } from "../agentos/mutations/writer";
import { graduateVenture } from "./graduate";
import { brainstorm, draftStage, stageQuestions } from "./interview";
import { draftPersona, runPersonaReview, suggestPersonas } from "./personas";
import { pivotVenture, scoreVenture, stopVenture } from "./score";
import { checkScope } from "./scope";
import {
  appendDecision,
  appendLater,
  assertVentureSlug,
  createVenture,
  listPersonas,
  listVentures,
  readVentureDetail,
  requireVenture,
  saveVenture,
  savePersona,
  StartupError,
  writeStage,
} from "./store";

/**
 * `/api/startups`: ventures walked from idea to MVP. Local only. Every write
 * answers with the state it changed, so the page never merges partial updates.
 * See docs/startups/README.md.
 */
export const startupsRouter = express.Router();

startupsRouter.use((request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)) {
    response.status(403).json({ error: "Startups are only available on this machine." });
    return;
  }
  if (!["GET", "HEAD"].includes(request.method) && !request.is("application/json") && Number(request.headers["content-length"] ?? 0) > 0) {
    response.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});

function fail(response: express.Response, error: unknown, what: string): void {
  if (error instanceof RevisionConflictError) {
    response.status(409).json({ error: "This changed since you opened it (perhaps in Obsidian). Reload, then make your change again." });
    return;
  }
  if (error instanceof StartupError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof DocumentInvalidError) {
    response.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    response.status(400).json({ error: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}` });
    return;
  }
  console.error(`[startups] could not ${what}:`, error instanceof Error ? error.message : error);
  response.status(500).json({ error: `Could not ${what}.` });
}

const slugOf = (request: express.Request) => assertVentureSlug(String(request.params.slug));
const stageOf = (request: express.Request): EditableStage => {
  const parsed = EditableStageSchema.safeParse(request.params.stage);
  if (!parsed.success) throw new StartupError("That stage cannot be edited yet.", 404);
  return parsed.data;
};

/** Wraps a handler so every route fails the same way. */
function route(what: string, handler: (request: express.Request, response: express.Response) => Promise<unknown>) {
  return async (request: express.Request, response: express.Response) => {
    try {
      response.json(await handler(request, response));
    } catch (error) {
      fail(response, error, what);
    }
  };
}

// --- Ventures ---------------------------------------------------------------

startupsRouter.get("/", route("list ventures", async () => ({ ventures: await listVentures() })));

startupsRouter.post(
  "/",
  route("start a venture", async (request) => {
    const body = z.object({ name: z.string().min(1).max(120), pitch: z.string().max(1000).optional(), origin: z.enum(["idea", "brainstorm"]).optional() }).parse(request.body);
    const venture = await createVenture(body);
    return readVentureDetail(venture.slug);
  }),
);

startupsRouter.post(
  "/brainstorm",
  route("brainstorm", async (request) => {
    const body = z.object({ focus: z.string().max(500).optional() }).parse(request.body ?? {});
    return { ideas: await brainstorm(body.focus) };
  }),
);

// --- Personas (before `/:slug`, so "personas" is never read as a venture) ------

startupsRouter.get("/personas", route("list personas", async () => ({ personas: await listPersonas() })));

startupsRouter.post(
  "/personas/draft",
  route("draft a persona", async (request) => {
    const body = z.object({ role: z.string().min(1).max(120), industry: z.string().max(120).optional(), notes: z.string().max(2000).optional() }).parse(request.body);
    return { persona: await draftPersona(body) };
  }),
);

startupsRouter.put(
  "/personas/:persona",
  route("save the persona", async (request) => {
    const slug = assertVentureSlug(String(request.params.persona));
    const body = PersonaSchema.omit({ slug: true, created: true, usedBy: true }).parse(request.body);
    return { persona: await savePersona({ ...body, slug }) };
  }),
);

startupsRouter.post(
  "/personas",
  route("save the persona", async (request) => {
    const body = PersonaSchema.omit({ slug: true, created: true, usedBy: true }).parse(request.body);
    return { persona: await savePersona(body) };
  }),
);

startupsRouter.get(
  "/by-workspace/:workspace",
  route("find the venture", async (request) => {
    const workspace = String(request.params.workspace);
    return { venture: (await listVentures()).find((venture) => venture.workspace === workspace) ?? null };
  }),
);

// --- One venture --------------------------------------------------------------

startupsRouter.get("/:slug", route("read the venture", async (request) => readVentureDetail(slugOf(request))));

startupsRouter.post(
  "/:slug/stages/:stage/questions",
  route("ask the questions", async (request) => {
    const slug = slugOf(request);
    const stage = stageOf(request);
    await assertOpen(slug, stage);
    const body = z.object({ notes: z.string().max(6000).optional() }).parse(request.body ?? {});
    return stageQuestions(slug, stage, body.notes);
  }),
);

startupsRouter.post(
  "/:slug/stages/:stage/draft",
  route("draft the stage", async (request) => {
    const slug = slugOf(request);
    const stage = stageOf(request);
    await assertOpen(slug, stage);
    return { content: await draftStage(slug, stage, StageAnswersSchema.parse(request.body)) };
  }),
);

/** The stage after each one, which saving it unlocks. */
const NEXT: Record<EditableStage, Venture["stage"]> = { idea: "value", value: "validate", validate: "validate", mvp: "mvp" };
const ORDER: Venture["stage"][] = ["idea", "value", "validate", "mvp", "design", "tech", "build", "test", "refine", "launch"];

startupsRouter.put(
  "/:slug/stages/:stage",
  route("save the stage", async (request) => {
    const slug = slugOf(request);
    const stage = stageOf(request);
    await assertOpen(slug, stage);
    const body = z.object({ content: z.unknown(), expectedRevision: z.string().optional() }).parse(request.body);
    const content = STAGE_SCHEMAS[stage].parse(body.content) as StageContent[typeof stage];

    const problems = stageProblems(stage, content);
    if (problems.length > 0) throw new StartupError(`Fill in ${problems.join(", ")} before saving.`, 422);

    await writeStage(slug, stage, content, body.expectedRevision);

    const { venture, revision } = await requireVenture(slug);
    const advanced = ORDER.indexOf(NEXT[stage]) > ORDER.indexOf(venture.stage) ? NEXT[stage] : venture.stage;
    const pitch = stage === "idea" ? (content as StageContent["idea"]).oneLiner || venture.pitch : venture.pitch;
    await saveVenture({ ...venture, stage: advanced, pitch, status: stage === "validate" ? "validating" : venture.status }, revision);

    return readVentureDetail(slug);
  }),
);

startupsRouter.post(
  "/:slug/personas/suggest",
  route("suggest personas", async (request) => {
    const slug = slugOf(request);
    await assertOpen(slug, "validate");
    return { suggestions: await suggestPersonas(slug) };
  }),
);

startupsRouter.post(
  "/:slug/personas/:persona/review",
  route("run the persona review", async (request) => {
    const slug = slugOf(request);
    await assertOpen(slug, "validate");
    await runPersonaReview(slug, assertVentureSlug(String(request.params.persona)));
    return readVentureDetail(slug);
  }),
);

startupsRouter.post(
  "/:slug/score",
  route("score the idea", async (request) => {
    const slug = slugOf(request);
    await assertOpen(slug, "validate");
    await scoreVenture(slug);
    return readVentureDetail(slug);
  }),
);

startupsRouter.post(
  "/:slug/pivot",
  route("pivot", async (request) => {
    const slug = slugOf(request);
    const body = z.object({ direction: z.string().max(1000).optional() }).parse(request.body ?? {});
    await pivotVenture(slug, body.direction);
    return readVentureDetail(slug);
  }),
);

startupsRouter.post(
  "/:slug/stop",
  route("stop the venture", async (request) => {
    const slug = slugOf(request);
    const body = z.object({ reason: z.string().min(1).max(600) }).parse(request.body);
    await stopVenture(slug, body.reason);
    return readVentureDetail(slug);
  }),
);

startupsRouter.post(
  "/:slug/scope-check",
  route("check the scope", async (request) => {
    const slug = slugOf(request);
    const body = z.object({ request: z.string().min(1).max(1000), park: z.boolean().optional() }).parse(request.body);
    const check = await checkScope(slug, body.request, { park: body.park });
    return { check, detail: await readVentureDetail(slug) };
  }),
);

startupsRouter.post(
  "/:slug/later",
  route("park the idea", async (request) => {
    const slug = slugOf(request);
    const body = z.object({ title: z.string().min(1).max(300), reason: z.string().max(600).optional() }).parse(request.body);
    await requireVenture(slug);
    await appendLater(slug, body);
    return readVentureDetail(slug);
  }),
);

startupsRouter.post(
  "/:slug/decision",
  route("record the decision", async (request) => {
    const slug = slugOf(request);
    const body = z.object({ title: z.string().min(1).max(200), detail: z.string().max(2000).optional() }).parse(request.body);
    await requireVenture(slug);
    await appendDecision(slug, body);
    return readVentureDetail(slug);
  }),
);

startupsRouter.post(
  "/:slug/graduate",
  route("create the workspace", async (request) => {
    const slug = slugOf(request);
    await graduateVenture(slug);
    return readVentureDetail(slug);
  }),
);

/** The server's own gate: a locked stage is refused here, whatever the page shows. */
async function assertOpen(slug: string, stage: EditableStage): Promise<void> {
  const detail = await readVentureDetail(slug);
  const lock = detail.locks[stage];
  if (lock) throw new StartupError(lock, 409);
}
