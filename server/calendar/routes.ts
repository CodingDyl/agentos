import express from "express";
import { z, ZodError } from "zod";
import { CalendarEventIdSchema, CalendarEventInputSchema, CalendarTaskInputSchema } from "../../shared/calendar-types";
import { CalendarError, getCalendarRange, readGoogleEvent, saveGoogleEvent } from "./google-calendar";
import { preparationSuggestions, readCalendarTasks, saveCalendarTask } from "./tasks";
import { RevisionConflictError } from "../agentos/mutations/revision";
import { InvalidRequestError, NotFoundError } from "../agentos/mutations/tasks";

export const calendarRouter = express.Router();
// This local API has no remote authentication. Reject cross-site browser writes.
calendarRouter.use((request, response, next) => {
  if (request.method === "GET") { next(); return; }
  const origin = request.get("origin");
  const allowed = new Set([process.env.AGENTOS_WEB_ORIGIN, "http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost", "http://tauri.localhost"]);
  if (request.get("sec-fetch-site") === "cross-site" || (origin && !allowed.has(origin) && origin !== `http://${request.get("host")}`)) {
    response.status(403).json({ error: "Calendar changes must come from AgentOS." }); return;
  }
  if (!request.is("application/json")) { response.status(415).json({ error: "Send calendar changes as JSON." }); return; }
  next();
});
function fail(response: express.Response, error: unknown) {
  if (error instanceof ZodError) { response.status(400).json({ error: error.issues[0]?.message ?? "Check the calendar details." }); return; }
  if (error instanceof CalendarError) { response.status(error.status).json({ error: error.message }); return; }
  if (error instanceof InvalidRequestError || error instanceof NotFoundError) { response.status(error instanceof NotFoundError ? 404 : 400).json({ error: error.message }); return; }
  if (error instanceof RevisionConflictError) { response.status(409).json({ error: "This task changed elsewhere. Refresh and reopen it." }); return; }
  console.error("[agentos] calendar operation failed", error instanceof Error ? error.name : "Unknown error");
  response.status(500).json({ error: "The calendar operation failed. Refresh before trying again." });
}
calendarRouter.get("/events", async (request, response) => {
  try {
    const range = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).parse(request.query);
    const duration = Date.parse(range.to) - Date.parse(range.from);
    if (duration <= 0 || duration > 63 * 86400000) throw new CalendarError("Choose a range of at most 63 days.", 400);
    response.json(await getCalendarRange(range.from, range.to));
  } catch (error) { fail(response, error); }
});
calendarRouter.post("/events", async (request, response) => {
  try { response.status(201).json(await saveGoogleEvent(CalendarEventInputSchema.parse(request.body))); }
  catch (error) { fail(response, error); }
});
calendarRouter.patch("/events/:id", async (request, response) => {
  try {
    const etag = z.string().min(1).max(200).parse(request.body?.etag);
    response.json(await saveGoogleEvent(CalendarEventInputSchema.parse(request.body), CalendarEventIdSchema.parse(request.params.id), etag));
  } catch (error) { fail(response, error); }
});
calendarRouter.get("/tasks", async (_request, response) => {
  try { response.json(await readCalendarTasks()); } catch (error) { fail(response, error); }
});
calendarRouter.post("/tasks", async (request, response) => {
  try { response.json(await saveCalendarTask(CalendarTaskInputSchema.parse(request.body))); } catch (error) { fail(response, error); }
});
calendarRouter.get("/events/:id/suggestions", async (request, response) => {
  try {
    const event = await readGoogleEvent(CalendarEventIdSchema.parse(request.params.id));
    if (!event.allowTasks) throw new CalendarError("This event does not allow task suggestions.", 409);
    response.json({ suggestions: preparationSuggestions(event.preparation ?? "") });
  } catch (error) { fail(response, error); }
});
