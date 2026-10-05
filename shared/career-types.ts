import { z } from "zod";

/**
 * Career: day-to-day employment admin, the record of what was done and
 * learned, and where the career is heading.
 *
 * Career owns no task engine, no integrations and no memory store of its own:
 * - tasks are ordinary AgentOS tasks in the `career` workspace's TASKS.md,
 *   with a small sidecar here for what TASKS.md has no field for (category,
 *   due date, notes);
 * - every external action goes through a Connector capability, and the ones
 *   that write elsewhere need a person's approval;
 * - learnings become memory only through the same proposal path closeouts
 *   and Learning use, in the `career` scope.
 */

/** The workspace slug Career's tasks and memory live under. */
export const CAREER_SLUG = "career";

const ID = z.string().min(1).max(64);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LINE = z.string().trim().min(1).max(500);
const URL = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => /^https:\/\//i.test(value), "Only https links are kept.");

// ------------------------------------------------------------------- tasks

export const CAREER_TASK_CATEGORIES = ["entelect", "client", "admin", "meeting", "recurring", "other"] as const;
export const CareerTaskCategorySchema = z.enum(CAREER_TASK_CATEGORIES);
export type CareerTaskCategory = z.infer<typeof CareerTaskCategorySchema>;

export const CAREER_TASK_CATEGORY_LABELS: Record<CareerTaskCategory, string> = {
  entelect: "Entelect",
  client: "Client work",
  admin: "Admin",
  meeting: "Meeting / follow-up",
  recurring: "Recurring",
  other: "Other",
};

/** What TASKS.md has no field for. Keyed by task id; the task itself stays in TASKS.md. */
export const CareerTaskMetaSchema = z.object({
  taskId: z.string().regex(/^[A-Z][A-Z0-9]{0,7}-\d{1,5}$/),
  category: CareerTaskCategorySchema.default("other"),
  /** The client or engagement, e.g. "Standard Bank". */
  client: z.string().trim().max(80).optional(),
  dueDate: DAY.optional(),
  notes: z.string().max(4000).optional(),
  /** Memory note ids or vault paths this task relates to. */
  memoryLinks: z.array(z.string().max(300)).max(20).default([]),
});
export type CareerTaskMeta = z.infer<typeof CareerTaskMetaSchema>;

export const CareerTaskMetaPatchSchema = CareerTaskMetaSchema.omit({ taskId: true }).partial().strict();
export type CareerTaskMetaPatch = z.infer<typeof CareerTaskMetaPatchSchema>;

// ------------------------------------------------------------ current work

export const CurrentWorkSchema = z.object({
  project: z.string().trim().max(160).default(""),
  objective: z.string().trim().max(1000).default(""),
  progress: z.string().trim().max(2000).default(""),
  updatedAt: z.string().optional(),
});
export type CurrentWork = z.infer<typeof CurrentWorkSchema>;
export const CurrentWorkInputSchema = CurrentWorkSchema.omit({ updatedAt: true }).strict();
export type CurrentWorkInput = z.infer<typeof CurrentWorkInputSchema>;

// ---------------------------------------------------------------- work log

export const WorkLogEntrySchema = z.object({
  id: ID,
  date: DAY,
  /** The client or project the work was for, e.g. "Standard Bank". */
  client: z.string().trim().max(80).optional(),
  workedOn: z.array(LINE).max(30).default([]),
  learned: z.array(LINE).max(30).default([]),
  blockedBy: z.array(LINE).max(30).default([]),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type WorkLogEntry = z.infer<typeof WorkLogEntrySchema>;

export const WorkLogInputSchema = z
  .object({
    date: DAY,
    client: z.string().trim().max(80).optional(),
    workedOn: z.array(LINE).max(30).default([]),
    learned: z.array(LINE).max(30).default([]),
    blockedBy: z.array(LINE).max(30).default([]),
  })
  .strict()
  .refine((entry) => entry.workedOn.length + entry.learned.length + entry.blockedBy.length > 0, "Write at least one line.");
export type WorkLogInput = z.infer<typeof WorkLogInputSchema>;

/** A week of the log, derived — for summaries, reviews and CV material. */
export interface WorkLogWeek {
  weekStart: string;
  days: number;
  clients: string[];
  workedOn: string[];
  learned: string[];
  blockedBy: string[];
}

// ------------------------------------------------------------------ growth

export const CareerGoalSchema = z.object({
  id: ID,
  text: LINE,
  status: z.enum(["active", "done", "dropped"]).default("active"),
  createdAt: z.string(),
});
export type CareerGoal = z.infer<typeof CareerGoalSchema>;

export const EVIDENCE_KINDS = ["project", "problem", "feedback", "responsibility", "achievement"] as const;
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const CareerEvidenceSchema = z.object({
  id: ID,
  kind: EvidenceKindSchema,
  text: z.string().trim().min(1).max(2000),
  date: DAY,
  /** The memory note it was promoted to, once it was. */
  memoryTarget: z.string().optional(),
});
export type CareerEvidence = z.infer<typeof CareerEvidenceSchema>;

/**
 * Something Hermes noticed. Never applied on its own: a person accepts it
 * (which adds the goal or growth area) or dismisses it.
 */
export const GrowthSuggestionSchema = z.object({
  id: ID,
  kind: z.enum(["skill-gap", "next-step", "achievement", "mismatch"]),
  text: LINE,
  /** For `next-step` and `skill-gap`: the goal or growth area accepting it would add. */
  proposedGoal: z.string().trim().max(500).optional(),
  createdAt: z.string(),
});
export type GrowthSuggestion = z.infer<typeof GrowthSuggestionSchema>;

export const CareerGrowthSchema = z.object({
  role: z.string().trim().max(120).default("Software Engineer"),
  nextMilestone: z.string().trim().max(300).default(""),
  growthAreas: z.array(LINE).max(20).default([]),
  goals: z.array(CareerGoalSchema).default([]),
  evidence: z.array(CareerEvidenceSchema).default([]),
  suggestions: z.array(GrowthSuggestionSchema).default([]),
  suggestionsAt: z.string().optional(),
});
export type CareerGrowth = z.infer<typeof CareerGrowthSchema>;

export const GrowthProfileInputSchema = z
  .object({
    role: z.string().trim().max(120).optional(),
    nextMilestone: z.string().trim().max(300).optional(),
    growthAreas: z.array(LINE).max(20).optional(),
  })
  .strict();
export type GrowthProfileInput = z.infer<typeof GrowthProfileInputSchema>;

export const EvidenceInputSchema = z.object({ kind: EvidenceKindSchema, text: z.string().trim().min(1).max(2000), date: DAY }).strict();
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;

// ---------------------------------------------------------------- routines

export const ROUTINE_IDS = ["timesheet", "soccer"] as const;
export const RoutineIdSchema = z.enum(ROUTINE_IDS);
export type RoutineId = z.infer<typeof RoutineIdSchema>;

/** 0 = Sunday … 6 = Saturday, as `Date#getDay`. */
export const WeekdaySchema = z.number().int().min(0).max(6);

export const CareerRoutineSchema = z.object({
  id: RoutineIdSchema,
  name: z.string(),
  weekday: WeekdaySchema,
  enabled: z.boolean().default(true),
  /** The day it was last done, local date. */
  lastCompletedOn: DAY.optional(),
  /** A Hermes cron job that reminds or runs it, when one is linked. */
  automationId: z.string().max(120).optional(),
});
export type CareerRoutine = z.infer<typeof CareerRoutineSchema>;

export const RoutinePatchSchema = z
  .object({
    weekday: WeekdaySchema.optional(),
    enabled: z.boolean().optional(),
    automationId: z.string().trim().max(120).nullable().optional(),
  })
  .strict();
export type RoutinePatch = z.infer<typeof RoutinePatchSchema>;

/** A routine as Today and the Overview read it. */
export interface RoutineStatus extends CareerRoutine {
  /** The date it is next (or currently) due. */
  dueOn: string;
  /** Due today or overdue, and not yet done for this cycle. */
  due: boolean;
  doneThisCycle: boolean;
}

// --------------------------------------------------------------- timesheet

/** One row as the Entelect timesheet upload expects it (the Colab script's columns). */
export const TimesheetRowSchema = z.object({
  date: DAY,
  project: z.string(),
  category: z.string(),
  hours: z.number().int().min(0),
  minutes: z.number().int().min(0).max(59),
  billable: z.boolean(),
  description: z.string(),
  ticketNumber: z.string().default(""),
  sentiment: z.string().default("Neutral"),
  workedFrom: z.string().default("Home"),
  /** Mapped to an Entelect project and category, or flagged for review. */
  mapped: z.boolean(),
  /** Why it is not mapped, in words. */
  issue: z.string().optional(),
  /** Exact recorded seconds before rounding. */
  recordedSeconds: z.number().int().min(0),
});
export type TimesheetRow = z.infer<typeof TimesheetRowSchema>;

export const TimesheetTotalsSchema = z.object({
  recordedMinutes: z.number().int().min(0),
  mappedMinutes: z.number().int().min(0),
  unmappedMinutes: z.number().int().min(0),
  /** Rounded minutes, as they will be submitted. */
  submittedMinutes: z.number().int().min(0),
});
export type TimesheetTotals = z.infer<typeof TimesheetTotalsSchema>;

export const TimesheetRunSchema = z.object({
  id: ID,
  weekStart: DAY,
  weekEnd: DAY,
  /** ISO week number, for the card header. */
  week: z.number().int().min(1).max(53),
  status: z.enum(["extracted", "reviewed", "submitted"]),
  rows: z.array(TimesheetRowSchema),
  totals: TimesheetTotalsSchema,
  /** Weekdays in range with no time recorded at all. */
  missingDays: z.array(DAY).default([]),
  /** Entries still running in Toggl, left out of the sheet. */
  runningEntries: z.number().int().min(0).default(0),
  warnings: z.array(z.string()).default([]),
  /** The upload file the script wrote, when it could. Relative to the script's output folder. */
  uploadFile: z.string().optional(),
  createdAt: z.string(),
  reviewedAt: z.string().optional(),
  submittedAt: z.string().optional(),
});
export type TimesheetRun = z.infer<typeof TimesheetRunSchema>;

export const RunTimesheetRequestSchema = z.object({ weekStart: DAY.optional() }).strict();

// ------------------------------------------------------------------ soccer

export const SoccerDefaultsSchema = z.object({
  eventType: z.string().trim().max(120).default("Indoor Soccer"),
  weekday: WeekdaySchema.default(2),
  time: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  venue: z.string().trim().max(200).default(""),
  maxParticipants: z.number().int().min(1).max(200).optional(),
  notes: z.string().trim().max(1000).default(""),
});
export type SoccerDefaults = z.infer<typeof SoccerDefaultsSchema>;
export const SoccerDefaultsInputSchema = SoccerDefaultsSchema.partial().strict();

export const SoccerEventSchema = z.object({
  id: ID,
  date: DAY,
  link: URL,
  createdAt: z.string(),
});
export type SoccerEvent = z.infer<typeof SoccerEventSchema>;
export const RecordSoccerEventSchema = z.object({ date: DAY, link: URL }).strict();

// ---------------------------------------------------------------- linkedin

export const LinkedInPostStatusSchema = z.enum(["idea", "draft", "approved", "published"]);
export type LinkedInPostStatus = z.infer<typeof LinkedInPostStatusSchema>;

export const LinkedInPostSchema = z.object({
  id: ID,
  idea: z.string().trim().min(1).max(1000),
  draft: z.string().max(3000).default(""),
  status: LinkedInPostStatusSchema,
  /** A memory note, work-log entry or evidence item it grew out of. */
  source: z.string().max(300).optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  approvedAt: z.string().optional(),
  publishedAt: z.string().optional(),
  /** LinkedIn's id for the post, once published. */
  postUrn: z.string().optional(),
  url: z.string().optional(),
});
export type LinkedInPost = z.infer<typeof LinkedInPostSchema>;

export const LinkedInPostInputSchema = z
  .object({ idea: z.string().trim().min(1).max(1000), source: z.string().max(300).optional() })
  .strict();
export const LinkedInPostPatchSchema = z
  .object({
    idea: z.string().trim().min(1).max(1000).optional(),
    draft: z.string().max(3000).optional(),
    /** Only idea → draft → approved here (and back). Publishing is its own request. */
    status: z.enum(["idea", "draft", "approved"]).optional(),
  })
  .strict();

// ------------------------------------------------------------------ memory

/**
 * The kinds of career memory, and the memory type each is saved as. Memory's
 * own vocabulary is fixed, so the career kind travels as the title prefix.
 */
export const CAREER_MEMORY_KINDS = ["lesson", "achievement", "feedback", "career-goal", "skill", "process", "preference"] as const;
export const CareerMemoryKindSchema = z.enum(CAREER_MEMORY_KINDS);
export type CareerMemoryKind = z.infer<typeof CareerMemoryKindSchema>;

export const CAREER_MEMORY_TYPE: Record<CareerMemoryKind, "lesson" | "fact" | "decision" | "pattern"> = {
  lesson: "lesson",
  achievement: "fact",
  feedback: "fact",
  "career-goal": "decision",
  skill: "fact",
  process: "pattern",
  preference: "fact",
};

export const CAREER_MEMORY_LABELS: Record<CareerMemoryKind, string> = {
  lesson: "Lesson",
  achievement: "Achievement",
  feedback: "Feedback",
  "career-goal": "Career goal",
  skill: "Skill",
  process: "Process",
  preference: "Preference",
};

/** A person approves a career memory. The request is the proposal they saw and edited. */
export const CareerMemoryRequestSchema = z
  .object({
    kind: CareerMemoryKindSchema,
    title: z.string().trim().min(3).max(140),
    body: z.string().trim().min(1).max(4000),
    /** Where it came from: `worklog:<id>`, `evidence:<id>`. */
    source: z.string().max(120).optional(),
    acknowledgedDuplicates: z.boolean().optional(),
  })
  .strict();
export type CareerMemoryRequest = z.infer<typeof CareerMemoryRequestSchema>;

// --------------------------------------------------------------- resources

/** A Career link, backed by a connector capability rather than a hard-coded href. */
export interface CareerResource {
  id: string;
  label: string;
  url: string;
  /** The capability that opening it represents, e.g. `entelect.timesheet.open`. */
  capabilityId: string;
  available: boolean;
}

// ---------------------------------------------------------------- response

export interface CareerTodayItem {
  id: string;
  kind: "routine" | "task";
  title: string;
  detail?: string;
  href: string;
}

export interface CareerData {
  today: string;
  currentWork: CurrentWork;
  taskMeta: CareerTaskMeta[];
  workLog: WorkLogEntry[];
  weeks: WorkLogWeek[];
  growth: CareerGrowth;
  routines: RoutineStatus[];
  timesheet: {
    latest?: TimesheetRun;
    lastSubmittedAt?: string;
    /** Whether the extraction script and Toggl token are in place. */
    ready: boolean;
    readyDetail?: string;
  };
  soccer: {
    defaults: SoccerDefaults;
    events: SoccerEvent[];
    nextDate: string;
  };
  linkedin: {
    posts: LinkedInPost[];
    canPublish: boolean;
    publishDetail?: string;
    profileUrl: string;
    messagesUrl: string;
  };
  resources: CareerResource[];
  todayItems: CareerTodayItem[];
}
