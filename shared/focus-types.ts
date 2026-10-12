import { z } from "zod";

/**
 * Today's focus: the morning check-in, the shortlist AgentOS builds by rule,
 * and the three things Hermes picks from it.
 *
 * Hermes can only pick from the shortlist, so it cannot invent work, and if
 * it is slow or down the rules pick instead: the morning never waits on it.
 */

export const EnergySchema = z.enum(["low", "ok", "high"]);
export const TimeSchema = z.enum(["under_1h", "1_3h", "most_of_day"]);
export type Energy = z.infer<typeof EnergySchema>;
export type TimeAvailable = z.infer<typeof TimeSchema>;

export const ENERGY_LABEL: Record<Energy, string> = { low: "Low", ok: "OK", high: "High" };
export const TIME_LABEL: Record<TimeAvailable, string> = { under_1h: "Under an hour", "1_3h": "1 to 3 hours", most_of_day: "Most of the day" };

export const CheckInSchema = z
  .object({
    energy: EnergySchema,
    time: TimeSchema,
    /** Anything on your mind. Each line becomes a to-do on Today. */
    mind: z.string().trim().max(600).default(""),
  })
  .strict();
export type CheckIn = z.infer<typeof CheckInSchema>;

export const CandidateKindSchema = z.enum(["week", "task", "area_task", "follow_up"]);

export const CandidateSchema = z.object({
  /** Stable for the same piece of work across the day: what picks and done-marks point at. */
  id: z.string(),
  title: z.string(),
  kind: CandidateKindSchema,
  /** Where it comes from, in words: "This week", "Pantry Pilot", "Personal", "Outreach". */
  source: z.string(),
  /** Why the rules put it on the list. */
  reason: z.string(),
  /** The Compass goal it serves, when known. */
  goalId: z.string().optional(),
  /** A quick, concrete job rather than deep work. */
  small: z.boolean(),
  /** Where to go to do it. */
  href: z.string().optional(),
  score: z.number(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const PickSchema = z.object({ candidate: CandidateSchema, why: z.string() });
export type Pick = z.infer<typeof PickSchema>;

export const TODO_TEXT_MAX = 200;

/** One thing to do today: from the check-in, or added on Today. Not one of the three. */
export const TodoSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(TODO_TEXT_MAX),
  done: z.boolean().default(false),
  /** `mind` came from "Anything on your mind?", `you` was added on Today. */
  from: z.enum(["mind", "you"]),
  /** The day it was carried over from, when it was not finished then. */
  carriedFrom: z.string().optional(),
  at: z.string(),
});
export type Todo = z.infer<typeof TodoSchema>;

export const FocusDaySchema = z.object({
  /** Local date, YYYY-MM-DD. */
  date: z.string(),
  checkIn: CheckInSchema.extend({ at: z.string() }).optional(),
  skipped: z.boolean().default(false),
  picks: z.array(PickSchema).default([]),
  /** Who picked: Hermes, the rules (Hermes did not answer), or you. */
  pickedBy: z.enum(["hermes", "rules"]).optional(),
  /** Why the rules picked, when they did. */
  pickNote: z.string().optional(),
  /** Candidate ids marked done today. */
  done: z.array(z.string()).default([]),
  /** Today's to-do list. Unfinished ones carry over to the next day. */
  todos: z.array(TodoSchema).default([]),
});
export type FocusDay = z.infer<typeof FocusDaySchema>;

export const FocusTodaySchema = z.object({
  day: FocusDaySchema,
  /** Built fresh on every read, so swapping always offers what is current. */
  shortlist: z.array(CandidateSchema),
});
export type FocusToday = z.infer<typeof FocusTodaySchema>;

export const SwapSchema = z.object({ slot: z.number().int().min(0).max(2), candidateId: z.string().min(1).max(200) }).strict();
export const DoneSchema = z.object({ candidateId: z.string().min(1).max(200), done: z.boolean() }).strict();

export const TodoAddSchema = z.object({ text: z.string().trim().min(1).max(TODO_TEXT_MAX) }).strict();
export const TodoPatchSchema = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(TODO_TEXT_MAX).optional() }).strict();

/**
 * What was on your mind, as to-dos: one per line (or per semicolon), bullets
 * and numbering stripped, blanks and repeats dropped.
 */
export function mindToTodos(mind: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of mind.split(/[\n;]+/)) {
    const text = raw.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, "").trim().slice(0, TODO_TEXT_MAX);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** The most the shortlist holds. Hermes picks three of these. */
export const SHORTLIST_SIZE = 8;
