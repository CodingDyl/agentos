import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { defaultTimesheetWeek } from "../../shared/career-logic";
import {
  CAREER_MEMORY_LABELS,
  CAREER_MEMORY_TYPE,
  CAREER_SLUG,
  CareerMemoryRequestSchema,
  CareerTaskMetaPatchSchema,
  CurrentWorkInputSchema,
  EvidenceInputSchema,
  GrowthProfileInputSchema,
  LinkedInPostInputSchema,
  LinkedInPostPatchSchema,
  RecordSoccerEventSchema,
  RoutineIdSchema,
  RoutinePatchSchema,
  RunTimesheetRequestSchema,
  SoccerDefaultsInputSchema,
  WorkLogInputSchema,
} from "../../shared/career-types";
import { isoDate, weekStart } from "../../shared/traction-dates";
import { recordActivity } from "../activity/ui-events";
import { authorize } from "../connectors/policy";
import { HUMAN } from "../memory/mutations";
import { applyDecision, proposalId } from "../memory/proposals";
import { memoryService } from "../memory/service";
import { careerAgenda, findResource, getCareer } from "./career";
import { CareerHermesError, draftLinkedInPost, suggestGrowth } from "./hermes";
import { LinkedInError, publishToLinkedIn } from "./linkedin";
import { mutateCareer, newId, readCareer } from "./store";
import {
  TimesheetError,
  markTimesheetReviewed,
  markTimesheetSubmitted,
  runTimesheetExtraction,
  uploadFilePath,
} from "./timesheet";

/** `/api/career` — one read, many small writes, each re-read by the page. */
export const careerRouter = Router();

class CareerRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function parse<T>(schema: z.ZodType<T>, request: Request, response: Response): T | undefined {
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "That request could not be read." });
    return undefined;
  }
  return parsed.data;
}

function fail(response: Response, error: unknown, fallback: string): void {
  if (error instanceof CareerRequestError || error instanceof TimesheetError || error instanceof LinkedInError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof CareerHermesError) {
    response.status(502).json({ error: error.message });
    return;
  }
  console.error(`[career] ${fallback}:`, error);
  response.status(500).json({ error: fallback });
}

/** Wraps a handler: run, answer with its result, or fail with `fallback`. */
function handle(fallback: string, run: (request: Request) => Promise<unknown>) {
  return async (request: Request, response: Response) => {
    try {
      response.json(await run(request));
    } catch (error) {
      fail(response, error, fallback);
    }
  };
}

const notFound = (what: string) => new CareerRequestError(`There is no ${what} with that id.`, 404);
const param = (request: Request, name: string) => String(request.params[name] ?? "");

// --------------------------------------------------------------------- read

careerRouter.get("/", handle("Career could not be read", () => getCareer()));

/** Plain text for Hermes' morning brief pre-run script. */
careerRouter.get("/agenda", async (_request, response) => {
  try {
    response.type("text/plain").send(await careerAgenda());
  } catch {
    response.type("text/plain").send("Career could not be read today.");
  }
});

// ------------------------------------------------------------- current work

careerRouter.put("/current-work", async (request, response) => {
  const body = parse(CurrentWorkInputSchema, request, response);
  if (!body) return;
  await handle("Current work could not be saved", () =>
    mutateCareer((state) => {
      state.currentWork = { ...body, updatedAt: new Date().toISOString() };
      return state.currentWork;
    }),
  )(request, response);
});

// -------------------------------------------------------------------- tasks

/** Category, client, due date and notes for a task that lives in the career workspace's TASKS.md. */
careerRouter.patch("/tasks/:taskId/meta", async (request, response) => {
  const taskId = param(request, "taskId");
  if (!/^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/.test(taskId)) {
    response.status(400).json({ error: "Invalid task id." });
    return;
  }
  const body = parse(CareerTaskMetaPatchSchema, request, response);
  if (!body) return;
  await handle("The task details could not be saved", () =>
    mutateCareer((state) => {
      const existing = state.taskMeta.find((item) => item.taskId === taskId);
      const next = { category: "other" as const, memoryLinks: [], ...existing, ...body, taskId };
      state.taskMeta = [...state.taskMeta.filter((item) => item.taskId !== taskId), next];
      return next;
    }),
  )(request, response);
});

// ----------------------------------------------------------------- work log

careerRouter.post("/work-log", async (request, response) => {
  const body = parse(WorkLogInputSchema, request, response);
  if (!body) return;
  try {
    const entry = await mutateCareer((state) => {
      const created = { ...body, id: newId("wl"), createdAt: new Date().toISOString() };
      state.workLog = [created, ...state.workLog];
      return created;
    });
    await recordActivity({ type: "career.work_logged", description: `${entry.date}${entry.client ? ` · ${entry.client}` : ""}`, project: CAREER_SLUG });
    response.status(201).json(entry);
  } catch (error) {
    fail(response, error, "The work log entry could not be saved");
  }
});

careerRouter.put("/work-log/:id", async (request, response) => {
  const body = parse(WorkLogInputSchema, request, response);
  if (!body) return;
  await handle("The work log entry could not be saved", () =>
    mutateCareer((state) => {
      const entry = state.workLog.find((item) => item.id === param(request, "id"));
      if (!entry) throw notFound("work log entry");
      Object.assign(entry, body, { updatedAt: new Date().toISOString() });
      return entry;
    }),
  )(request, response);
});

careerRouter.delete(
  "/work-log/:id",
  handle("The work log entry could not be deleted", (request) =>
    mutateCareer((state) => {
      const before = state.workLog.length;
      state.workLog = state.workLog.filter((item) => item.id !== param(request, "id"));
      if (state.workLog.length === before) throw notFound("work log entry");
      return { ok: true };
    }),
  ),
);

// ------------------------------------------------------------------- growth

careerRouter.patch("/growth/profile", async (request, response) => {
  const body = parse(GrowthProfileInputSchema, request, response);
  if (!body) return;
  await handle("The growth profile could not be saved", () =>
    mutateCareer((state) => {
      Object.assign(state.growth, Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)));
      return state.growth;
    }),
  )(request, response);
});

const GoalInputSchema = z.object({ text: z.string().trim().min(1).max(500) }).strict();
const GoalPatchSchema = z.object({ status: z.enum(["active", "done", "dropped"]).optional(), text: z.string().trim().min(1).max(500).optional() }).strict();

/** Goals change only here — a person's request. Hermes' suggestions go through accept. */
careerRouter.post("/growth/goals", async (request, response) => {
  const body = parse(GoalInputSchema, request, response);
  if (!body) return;
  await handle("The goal could not be saved", () =>
    mutateCareer((state) => {
      const goal = { id: newId("goal"), text: body.text, status: "active" as const, createdAt: new Date().toISOString() };
      state.growth.goals.push(goal);
      return goal;
    }),
  )(request, response);
});

careerRouter.patch("/growth/goals/:id", async (request, response) => {
  const body = parse(GoalPatchSchema, request, response);
  if (!body) return;
  await handle("The goal could not be saved", () =>
    mutateCareer((state) => {
      const goal = state.growth.goals.find((item) => item.id === param(request, "id"));
      if (!goal) throw notFound("goal");
      if (body.status) goal.status = body.status;
      if (body.text) goal.text = body.text;
      return goal;
    }),
  )(request, response);
});

careerRouter.delete(
  "/growth/goals/:id",
  handle("The goal could not be deleted", (request) =>
    mutateCareer((state) => {
      state.growth.goals = state.growth.goals.filter((item) => item.id !== param(request, "id"));
      return { ok: true };
    }),
  ),
);

careerRouter.post("/growth/evidence", async (request, response) => {
  const body = parse(EvidenceInputSchema, request, response);
  if (!body) return;
  await handle("The evidence could not be saved", () =>
    mutateCareer((state) => {
      const item = { ...body, id: newId("ev") };
      state.growth.evidence = [item, ...state.growth.evidence];
      return item;
    }),
  )(request, response);
});

careerRouter.delete(
  "/growth/evidence/:id",
  handle("The evidence could not be deleted", (request) =>
    mutateCareer((state) => {
      state.growth.evidence = state.growth.evidence.filter((item) => item.id !== param(request, "id"));
      return { ok: true };
    }),
  ),
);

/** Asks Hermes for suggestions. They are stored, never applied. */
careerRouter.post(
  "/growth/suggestions",
  handle("Hermes could not suggest anything", async () => {
    const state = await readCareer();
    const suggestions = await suggestGrowth(state.growth, state.workLog);
    return mutateCareer((current) => {
      current.growth.suggestions = suggestions;
      current.growth.suggestionsAt = new Date().toISOString();
      return current.growth;
    });
  }),
);

/** A person accepts a suggestion: its proposed goal (if any) becomes a goal, an achievement becomes evidence. */
careerRouter.post(
  "/growth/suggestions/:id/accept",
  handle("The suggestion could not be accepted", (request) =>
    mutateCareer((state) => {
      const suggestion = state.growth.suggestions.find((item) => item.id === param(request, "id"));
      if (!suggestion) throw notFound("suggestion");
      const now = new Date();
      if (suggestion.kind === "achievement") {
        state.growth.evidence = [{ id: newId("ev"), kind: "achievement", text: suggestion.text, date: isoDate(now) }, ...state.growth.evidence];
      } else {
        state.growth.goals.push({ id: newId("goal"), text: suggestion.proposedGoal ?? suggestion.text, status: "active", createdAt: now.toISOString() });
      }
      state.growth.suggestions = state.growth.suggestions.filter((item) => item.id !== suggestion.id);
      return state.growth;
    }),
  ),
);

careerRouter.delete(
  "/growth/suggestions/:id",
  handle("The suggestion could not be dismissed", (request) =>
    mutateCareer((state) => {
      state.growth.suggestions = state.growth.suggestions.filter((item) => item.id !== param(request, "id"));
      return state.growth;
    }),
  ),
);

// ------------------------------------------------------------------- memory

/**
 * A person approves a career memory — a lesson from the log, an achievement
 * from the evidence. Same path as a closeout proposal: duplicate check,
 * provenance, re-index, into `projects/career/memory`.
 */
careerRouter.post("/memory", async (request, response) => {
  const body = parse(CareerMemoryRequestSchema, request, response);
  if (!body) return;
  try {
    const title = `${CAREER_MEMORY_LABELS[body.kind]}: ${body.title}`;
    const outcome = await applyDecision(
      memoryService(),
      {
        proposal: {
          id: proposalId(CAREER_SLUG, `career:${body.source ?? body.kind}`, title),
          type: CAREER_MEMORY_TYPE[body.kind],
          title,
          body: body.body,
          project: CAREER_SLUG,
          proposedBy: HUMAN,
          selected: true,
        },
        action: "create",
        acknowledgedDuplicates: body.acknowledgedDuplicates,
      },
      HUMAN,
    );
    if (outcome.outcome === "failed") {
      response.status(409).json({ error: outcome.error ?? "It could not be saved to memory.", outcome });
      return;
    }
    const evidenceId = body.source?.startsWith("evidence:") ? body.source.slice("evidence:".length) : undefined;
    if (evidenceId && outcome.target) {
      await mutateCareer((state) => {
        const item = state.growth.evidence.find((entry) => entry.id === evidenceId);
        if (item) item.memoryTarget = outcome.target;
      });
    }
    await recordActivity({
      type: "memory.proposal_saved",
      description: `${outcome.title} → ${outcome.target ?? "memory"} (from Career)`,
      project: CAREER_SLUG,
      metadata: { target: outcome.target, outcome: outcome.outcome, kind: body.kind },
    });
    response.json({ outcome });
  } catch (error) {
    fail(response, error, "It could not be saved to memory");
  }
});

// ----------------------------------------------------------------- routines

careerRouter.patch("/routines/:id", async (request, response) => {
  const id = RoutineIdSchema.safeParse(param(request, "id"));
  if (!id.success) {
    response.status(404).json({ error: "There is no routine with that id." });
    return;
  }
  const body = parse(RoutinePatchSchema, request, response);
  if (!body) return;
  await handle("The routine could not be saved", () =>
    mutateCareer((state) => {
      const routine = state.routines.find((item) => item.id === id.data);
      if (!routine) throw notFound("routine");
      if (body.weekday !== undefined) routine.weekday = body.weekday;
      if (body.enabled !== undefined) routine.enabled = body.enabled;
      if (body.automationId !== undefined) routine.automationId = body.automationId ?? undefined;
      return routine;
    }),
  )(request, response);
});

/** Done by hand, outside a runbook. */
careerRouter.post(
  "/routines/:id/complete",
  handle("The routine could not be marked done", (request) =>
    mutateCareer((state) => {
      const routine = state.routines.find((item) => item.id === param(request, "id"));
      if (!routine) throw notFound("routine");
      routine.lastCompletedOn = isoDate(new Date());
      return routine;
    }),
  ),
);

// ---------------------------------------------------------------- timesheet

careerRouter.post("/timesheet/run", async (request, response) => {
  const body = parse(RunTimesheetRequestSchema, request, response);
  if (!body) return;
  try {
    const week = weekStart(body.weekStart ?? defaultTimesheetWeek(isoDate(new Date())));
    const run = await runTimesheetExtraction(week);
    await recordActivity({
      type: "career.timesheet_extracted",
      description: `Week ${run.week}: ${run.rows.length} rows, ${run.totals.unmappedMinutes}m unmapped`,
      project: CAREER_SLUG,
    });
    response.json(run);
  } catch (error) {
    fail(response, error, "The timesheet could not be extracted");
  }
});

careerRouter.post("/timesheet/:id/review", handle("The timesheet could not be marked reviewed", (request) => markTimesheetReviewed(param(request, "id"))));

careerRouter.post("/timesheet/:id/submitted", async (request, response) => {
  const body = parse(z.object({ acceptUnmapped: z.boolean().default(false) }).strict(), request, response);
  if (!body) return;
  try {
    const run = await markTimesheetSubmitted(param(request, "id"), body);
    await recordActivity({ type: "career.timesheet_submitted", description: `Week ${run.week} submitted`, project: CAREER_SLUG });
    response.json(run);
  } catch (error) {
    fail(response, error, "The timesheet could not be marked submitted");
  }
});

/** The upload spreadsheet the script wrote. Looked up by its generated name only. */
careerRouter.get("/timesheet/files/:name", (request, response) => {
  const file = uploadFilePath(param(request, "name"));
  if (!file) {
    response.status(404).json({ error: "That upload file is not there." });
    return;
  }
  response.download(file);
});

// ------------------------------------------------------------------- soccer

careerRouter.put("/soccer/defaults", async (request, response) => {
  const body = parse(SoccerDefaultsInputSchema, request, response);
  if (!body) return;
  await handle("The soccer defaults could not be saved", () =>
    mutateCareer((state) => {
      state.soccer.defaults = { ...state.soccer.defaults, ...body };
      const routine = state.routines.find((item) => item.id === "soccer");
      if (routine && body.weekday !== undefined) routine.weekday = body.weekday;
      return state.soccer.defaults;
    }),
  )(request, response);
});

/**
 * The person created the event on Entelect Events (after confirming the
 * defaults) and pasted the link back. Records it and completes the routine.
 */
careerRouter.post("/soccer/events", async (request, response) => {
  const body = parse(RecordSoccerEventSchema, request, response);
  if (!body) return;
  const decision = authorize("entelect.events.create", { initiator: "person", detail: `soccer ${body.date}` });
  if (!decision.allowed) {
    response.status(403).json({ error: decision.reason });
    return;
  }
  try {
    const event = await mutateCareer((state) => {
      const created = { id: newId("se"), date: body.date, link: body.link, createdAt: new Date().toISOString() };
      state.soccer.events = [created, ...state.soccer.events.filter((item) => item.date !== body.date)];
      const routine = state.routines.find((item) => item.id === "soccer");
      if (routine) routine.lastCompletedOn = isoDate(new Date());
      return created;
    });
    await recordActivity({ type: "career.soccer_event", description: `Indoor soccer ${event.date}`, project: CAREER_SLUG });
    response.status(201).json(event);
  } catch (error) {
    fail(response, error, "The event could not be recorded");
  }
});

// ----------------------------------------------------------------- linkedin

careerRouter.post("/linkedin/posts", async (request, response) => {
  const body = parse(LinkedInPostInputSchema, request, response);
  if (!body) return;
  try {
    const post = await mutateCareer((state) => {
      const created = { ...body, id: newId("li"), draft: "", status: "idea" as const, createdAt: new Date().toISOString() };
      state.linkedinPosts = [created, ...state.linkedinPosts];
      return created;
    });
    response.status(201).json(post);
  } catch (error) {
    fail(response, error, "The post idea could not be saved");
  }
});

careerRouter.patch("/linkedin/posts/:id", async (request, response) => {
  const body = parse(LinkedInPostPatchSchema, request, response);
  if (!body) return;
  await handle("The post could not be saved", () =>
    mutateCareer((state) => {
      const post = state.linkedinPosts.find((item) => item.id === param(request, "id"));
      if (!post) throw notFound("post");
      if (post.status === "published") throw new CareerRequestError("A published post can't be edited here.", 409);
      if (body.idea !== undefined) post.idea = body.idea;
      if (body.draft !== undefined) {
        post.draft = body.draft;
        // Editing an approved draft withdraws the approval: what is approved is what is published.
        if (post.status === "approved" && body.status === undefined) post.status = "draft";
      }
      if (body.status !== undefined) {
        if (body.status === "approved" && !(body.draft ?? post.draft).trim()) throw new CareerRequestError("There is no draft to approve.", 409);
        post.status = body.status;
        post.approvedAt = body.status === "approved" ? new Date().toISOString() : undefined;
      }
      post.updatedAt = new Date().toISOString();
      return post;
    }),
  )(request, response);
});

careerRouter.delete(
  "/linkedin/posts/:id",
  handle("The post could not be deleted", (request) =>
    mutateCareer((state) => {
      state.linkedinPosts = state.linkedinPosts.filter((item) => item.id !== param(request, "id"));
      return { ok: true };
    }),
  ),
);

/** Hermes drafts (or redrafts). Lands as an unapproved draft. */
careerRouter.post(
  "/linkedin/posts/:id/draft",
  handle("The post could not be drafted", async (request) => {
    const state = await readCareer();
    const post = state.linkedinPosts.find((item) => item.id === param(request, "id"));
    if (!post) throw notFound("post");
    if (post.status === "published") throw new CareerRequestError("That post is already published.", 409);
    const decision = authorize("linkedin.draft_post", { initiator: "person", detail: post.id });
    if (!decision.allowed) throw new CareerRequestError(decision.reason, 403);
    const draft = await draftLinkedInPost(post, state.workLog);
    return mutateCareer((current) => {
      const target = current.linkedinPosts.find((item) => item.id === post.id);
      if (!target) throw notFound("post");
      target.draft = draft;
      target.status = "draft";
      target.approvedAt = undefined;
      target.updatedAt = new Date().toISOString();
      return target;
    });
  }),
);

/** Publishes an approved post. The press is the approval; nothing publishes on its own. */
careerRouter.post("/linkedin/posts/:id/publish", async (request, response) => {
  try {
    const state = await readCareer();
    const post = state.linkedinPosts.find((item) => item.id === param(request, "id"));
    if (!post) throw notFound("post");
    if (post.status !== "approved") throw new CareerRequestError("Approve the draft before publishing it.", 409);
    const result = await publishToLinkedIn(post.draft, post.id);
    const saved = await mutateCareer((current) => {
      const target = current.linkedinPosts.find((item) => item.id === post.id);
      if (!target) throw notFound("post");
      Object.assign(target, { status: "published", publishedAt: new Date().toISOString(), postUrn: result.postUrn, url: result.url });
      return target;
    });
    await recordActivity({ type: "career.linkedin_published", description: post.idea.slice(0, 120), project: CAREER_SLUG });
    response.json(saved);
  } catch (error) {
    fail(response, error, "The post could not be published");
  }
});

// ---------------------------------------------------------------- resources

/** Opening a Career link goes through its capability, so it can be switched off and shows in history. */
careerRouter.post("/resources/:id/open", (request, response) => {
  const resource = findResource(param(request, "id"));
  if (!resource) {
    response.status(404).json({ error: "There is no such Career resource." });
    return;
  }
  const decision = authorize(resource.capabilityId, { initiator: "person", detail: resource.label });
  if (!decision.allowed) {
    response.status(403).json({ error: decision.reason });
    return;
  }
  response.json({ url: resource.url });
});
