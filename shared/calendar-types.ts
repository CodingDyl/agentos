import { z } from "zod";
import { CalendarEventSchema, CalendarStatusSchema } from "./today-types";

export const CalendarDateSchema = z.iso.date();
export const TaskScheduleSchema = z.object({
  date: CalendarDateSchema,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  durationMinutes: z.number().int().min(15).max(1440).default(60),
});
export type TaskSchedule = z.infer<typeof TaskScheduleSchema>;
export const CalendarEventIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,1024}$/);
export const CalendarEventInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10000).default(""),
  location: z.string().max(1000).default(""),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  timeZone: z.string().max(100).refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid time zone."),
  allowTasks: z.boolean().default(false),
  preparation: z.string().max(1000).refine((value) => new TextEncoder().encode(value).length <= 1024, "Preparation notes must fit within 1 KB. Shorten the notes and try again.").default(""),
}).superRefine((input, ctx) => {
  const schema = input.allDay ? CalendarDateSchema : z.iso.datetime({ offset: true });
  if (!schema.safeParse(input.start).success || !schema.safeParse(input.end).success || Date.parse(input.end) <= Date.parse(input.start)) {
    ctx.addIssue({ code: "custom", message: "Choose valid dates with the end after the start.", path: ["end"] });
  }
});
export type CalendarEventInput = z.infer<typeof CalendarEventInputSchema>;
export const CalendarTaskSchema = z.object({
  projectSlug: z.string(), projectName: z.string(), taskId: z.string(), title: z.string(),
  completed: z.boolean(), revision: z.string(),
  schedule: TaskScheduleSchema.optional(), calendarEventId: CalendarEventIdSchema.optional(),
});
export type CalendarTask = z.infer<typeof CalendarTaskSchema>;
export const CalendarTaskInputSchema = z.object({
  projectSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  taskId: z.string().regex(/^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/).optional(),
  title: z.string().trim().min(1).max(500),
  schedule: TaskScheduleSchema.nullable(),
  calendarEventId: CalendarEventIdSchema.nullable().optional(),
  expectedRevision: z.string().optional(),
  completed: z.boolean().optional(),
});
export type CalendarTaskInput = z.infer<typeof CalendarTaskInputSchema>;
export const CalendarRangeSchema = z.object({
  status: CalendarStatusSchema, detail: z.string().optional(), canWrite: z.boolean(),
  events: z.array(CalendarEventSchema), fetchedAt: z.string(),
});
export type CalendarRange = z.infer<typeof CalendarRangeSchema>;
export const CalendarTasksResponseSchema = z.object({ tasks: z.array(CalendarTaskSchema), projects: z.array(z.object({ slug: z.string(), name: z.string() })) });
export type CalendarTasksResponse = z.infer<typeof CalendarTasksResponseSchema>;
