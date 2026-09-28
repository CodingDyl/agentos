import { z } from "zod";

/**
 * Today's day-shaped reads: the calendar, Hermes' morning brief, and the
 * end-of-day wrap. Each is its own request, so a slow or broken one never
 * holds up the rest of the page.
 */

export const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** ISO 8601 date-time, or `YYYY-MM-DD` for an all-day event. */
  start: z.string(),
  end: z.string().optional(),
  allDay: z.boolean(),
  location: z.string().optional(),
  /** A video-call link, when the event carries one. */
  meetingUrl: z.string().optional(),
  /** The event in Google Calendar. */
  htmlLink: z.string().optional(),
});

/**
 * Why a calendar might be missing, named so the page can say what to do:
 * `needs-connect` is a Google connection made before calendar access was
 * asked for; `api-disabled` is the Calendar API switched off in the Google
 * Cloud project.
 */
export const CalendarStatusSchema = z.enum([
  "ready",
  "not-configured",
  "not-connected",
  "needs-connect",
  "api-disabled",
  "error",
]);

export const TodayCalendarSchema = z.object({
  status: CalendarStatusSchema,
  detail: z.string().optional(),
  today: z.array(CalendarEventSchema),
  /** The first timed event tomorrow, for the evening wrap. */
  tomorrowFirst: CalendarEventSchema.optional(),
});

export const BriefPlanSchema = z.object({
  mainOutcome: z.string().optional(),
  top: z.array(z.string()),
  ifTime: z.array(z.string()),
  avoid: z.string().optional(),
  /** Any other labelled part of the brief (Calendar, Focus time), verbatim. */
  notes: z.array(z.object({ label: z.string(), text: z.string() })),
});

export const MorningBriefSchema = z.object({
  /**
   * `today`: a brief from this morning. `stale`: the newest brief is from an
   * earlier day. `none`: the job has never produced one. `no-job`: there is no
   * morning-brief job in Hermes at all.
   */
  status: z.enum(["today", "stale", "none", "no-job"]),
  jobId: z.string().optional(),
  jobName: z.string().optional(),
  /** ISO 8601, when Hermes wrote it. */
  runAt: z.string().optional(),
  /** Present when the reply followed the start-day format. */
  plan: BriefPlanSchema.optional(),
  /** Hermes' reply, verbatim, for when it didn't produce a plan. */
  response: z.string().optional(),
  /** When the newest brief has no plan: the most recent one that did, from the last week. */
  lastPlan: z.object({ runAt: z.string(), plan: BriefPlanSchema }).optional(),
});

export const WrapDoneItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["task", "worker", "milestone"]),
  /** ISO 8601. */
  at: z.string(),
  project: z.string().optional(),
});

export const WrapCarryItemSchema = z.object({
  projectSlug: z.string(),
  projectName: z.string(),
  taskId: z.string().optional(),
  title: z.string(),
});

export const DayWrapSchema = z.object({
  done: z.array(WrapDoneItemSchema),
  /** Unfinished Now tasks: what tomorrow starts with unless something changes. */
  carryOver: z.array(WrapCarryItemSchema),
  /** How many Now tasks are open in total, when more than the list shows. */
  carryOverTotal: z.number().int().nonnegative(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type CalendarStatus = z.infer<typeof CalendarStatusSchema>;
export type TodayCalendar = z.infer<typeof TodayCalendarSchema>;
export type BriefPlan = z.infer<typeof BriefPlanSchema>;
export type MorningBrief = z.infer<typeof MorningBriefSchema>;
export type WrapDoneItem = z.infer<typeof WrapDoneItemSchema>;
export type WrapCarryItem = z.infer<typeof WrapCarryItemSchema>;
export type DayWrap = z.infer<typeof DayWrapSchema>;
