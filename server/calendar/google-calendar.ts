import { CalendarEventInputSchema, type CalendarEventInput, type CalendarRange } from "../../shared/calendar-types";
import type { CalendarEvent } from "../../shared/today-types";
import { authorize, decide } from "../connectors/policy";
import { canReadCalendar, canWriteCalendar, getAccessToken, isGmailConfigured, isGmailConnected } from "../mail/gmail-auth";
import { readCalendarEvents } from "../today/calendar";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
export class CalendarError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export async function calendarRequest(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    if (response.status === 412) throw new CalendarError("This event changed in Google Calendar. Refresh the calendar and open it again before saving.", 409);
    if (response.status === 404 || response.status === 410) throw new CalendarError("This event no longer exists. Refresh the calendar.", 404);
    if (response.status === 401 || response.status === 403) throw new CalendarError("Google denied calendar access. Reconnect Google, check that the Calendar API is enabled, and confirm you can edit this calendar.", 403);
    if (response.status === 429) throw new CalendarError("Google Calendar is busy. Wait a moment, then try again.", 429);
    throw new CalendarError(`Google Calendar could not save or read the event (${response.status}). Try refreshing first.`);
  }
  return response.json();
}

async function tokenFor(action: "read_events" | "create_event" | "edit_event"): Promise<string> {
  const decision = authorize(`calendar.${action}`, { initiator: action === "read_events" ? "system" : "person" });
  if (!decision.allowed) throw new CalendarError(decision.reason, 403);
  if (!isGmailConfigured() || !(await isGmailConnected())) throw new CalendarError("Connect Google to use your calendar.", 403);
  if (action !== "read_events" && !(await canWriteCalendar())) throw new CalendarError("Reconnect Google to allow creating and editing calendar events.", 403);
  return getAccessToken();
}

/** Follows every page; a month must not silently lose events after the first page. */
export async function listCalendarRange(token: string, from: string, to: string, fetcher: typeof fetch = fetch): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await calendarRequest(`${EVENTS_URL}?${params}`, { headers: { Authorization: `Bearer ${token}` } }, fetcher) as { nextPageToken?: string };
    events.push(...readCalendarEvents(payload));
    pageToken = payload.nextPageToken;
    if (pageToken) {
      if (seen.has(pageToken) || seen.size >= 50) throw new CalendarError("There are too many events to load this range. Try the week view.");
      seen.add(pageToken);
    }
  } while (pageToken);
  return events;
}

export async function getCalendarRange(from: string, to: string): Promise<CalendarRange> {
  const base = { events: [], canWrite: false, fetchedAt: new Date().toISOString() };
  if (!isGmailConfigured()) return { ...base, status: "not-configured", detail: "Connect your Google account in Connectors to see and edit events." };
  if (!(await isGmailConnected())) return { ...base, status: "not-connected", detail: "Connect Google to see your events here." };
  if (!(await canReadCalendar())) return { ...base, status: "needs-connect", detail: "Reconnect Google to grant calendar access." };
  try {
    const token = await tokenFor("read_events");
    return { ...base, status: "ready", canWrite: await canWriteCalendar() && decide("calendar.create_event", "person").allowed && decide("calendar.edit_event", "person").allowed, events: await listCalendarRange(token, from, to) };
  } catch (error) {
    return { ...base, status: "error", detail: error instanceof CalendarError ? error.message : "Could not reach Google Calendar. Refresh to try again." };
  }
}

export function googleEventBody(input: CalendarEventInput) {
  const event = CalendarEventInputSchema.parse(input);
  const date = (value: string) => event.allDay ? { date: value } : { dateTime: value, timeZone: event.timeZone };
  return {
    summary: event.title, description: event.description, location: event.location,
    start: date(event.start), end: date(event.end),
    extendedProperties: { private: { agentosAllowTasks: String(event.allowTasks), agentosPreparation: event.preparation } },
  };
}

export async function readGoogleEvent(id: string): Promise<CalendarEvent> {
  const token = await tokenFor("read_events");
  const raw = await calendarRequest(`${EVENTS_URL}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  const event = readCalendarEvents({ items: [raw] })[0];
  if (!event) throw new CalendarError("That event is no longer available.", 404);
  return event;
}

export async function saveGoogleEvent(input: CalendarEventInput, id?: string, etag?: string): Promise<CalendarEvent> {
  const token = await tokenFor(id ? "edit_event" : "create_event");
  if (id && !etag) throw new CalendarError("Refresh and reopen this event before editing it.", 409);
  const payload = await calendarRequest(`${EVENTS_URL}${id ? `/${encodeURIComponent(id)}` : ""}?sendUpdates=all`, {
    method: id ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
    body: JSON.stringify(googleEventBody(input)),
  });
  const event = readCalendarEvents({ items: [payload] })[0];
  if (!event) throw new CalendarError("Google saved the event but its response could not be read. Refresh before trying again.");
  return event;
}
