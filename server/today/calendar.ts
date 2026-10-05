import type { CalendarEvent, TodayCalendar } from "../../shared/today-types";
import { authorize } from "../connectors/policy";
import { canReadCalendar, getAccessToken, isGmailConfigured, isGmailConnected } from "../mail/gmail-auth";

/**
 * Today's events from the primary Google Calendar, read-only.
 *
 * Uses the same Google connection as the Inbox. Every way this can fail is
 * returned as a status the page can explain, never thrown: a missing calendar
 * must not take Today down with it.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

interface GoogleEvent {
  id?: string;
  etag?: string;
  description?: string;
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

/** Google's event list → the events worth showing: not cancelled, not declined. */
export function readCalendarEvents(payload: unknown): CalendarEvent[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const events: CalendarEvent[] = [];
  for (const raw of items as GoogleEvent[]) {
    if (!raw || raw.status === "cancelled") continue;
    if (raw.attendees?.some((attendee) => attendee.self && attendee.responseStatus === "declined")) continue;

    const start = raw.start?.dateTime ?? raw.start?.date;
    if (!raw.id || !start) continue;

    const video = raw.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
    events.push({
      id: raw.id,
      title: raw.summary?.trim() || "(No title)",
      description: raw.description,
      etag: raw.etag,
      timeZone: raw.start?.timeZone,
      recurringEventId: raw.recurringEventId,
      allowTasks: raw.extendedProperties?.private?.agentosAllowTasks === "true",
      preparation: raw.extendedProperties?.private?.agentosPreparation ?? "",
      start,
      end: raw.end?.dateTime ?? raw.end?.date,
      allDay: !raw.start?.dateTime,
      location: raw.location?.trim() || undefined,
      meetingUrl: video ?? raw.hangoutLink ?? undefined,
      htmlLink: raw.htmlLink,
    });
  }
  return events;
}

function startOfDay(date: Date, offsetDays = 0): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offsetDays);
  return day;
}

type ListResult = { events: CalendarEvent[] } | { status: TodayCalendar["status"]; detail: string };

async function listEvents(token: string, from: Date, to: Date, maxResults: number): Promise<ListResult> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(maxResults),
  });

  let response: Response;
  try {
    response = await fetch(`${CALENDAR_API}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { status: "error", detail: "Couldn't reach Google Calendar." };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(body)) {
      return {
        status: "api-disabled",
        detail: "The Google Calendar API is switched off in your Google Cloud project. Enable it, then refresh.",
      };
    }
    if (response.status === 401 || response.status === 403) {
      return { status: "needs-connect", detail: "Google didn't allow calendar access. Reconnect Google to grant it." };
    }
    return { status: "error", detail: `Google Calendar responded with ${response.status}.` };
  }

  return { events: readCalendarEvents(await response.json()) };
}

export async function getTodayCalendar(now: Date = new Date()): Promise<TodayCalendar> {
  if (!isGmailConfigured()) return { status: "not-configured", today: [] };
  if (!(await isGmailConnected())) return { status: "not-connected", today: [] };
  if (!(await canReadCalendar())) {
    return {
      status: "needs-connect",
      detail: "Your Google connection predates calendar access. Reconnect once to add it.",
      today: [],
    };
  }

  const decision = authorize("calendar.read_events", { initiator: "system" });
  if (!decision.allowed) return { status: "error", detail: decision.reason, today: [] };

  let token: string;
  try {
    token = await getAccessToken();
  } catch (error) {
    return { status: "error", detail: error instanceof Error ? error.message : "Couldn't sign in to Google.", today: [] };
  }

  const [today, tomorrow] = await Promise.all([
    listEvents(token, startOfDay(now), startOfDay(now, 1), 50),
    listEvents(token, startOfDay(now, 1), startOfDay(now, 2), 10),
  ]);

  if (!("events" in today)) return { status: today.status, detail: today.detail, today: [] };

  return {
    status: "ready",
    today: today.events,
    tomorrowFirst: "events" in tomorrow ? tomorrow.events.find((event) => !event.allDay) : undefined,
  };
}
