import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CAREER_SLUG,
  CareerGrowthSchema,
  CareerRoutineSchema,
  CareerTaskMetaSchema,
  CurrentWorkSchema,
  LinkedInPostSchema,
  SoccerDefaultsSchema,
  SoccerEventSchema,
  TimesheetRunSchema,
  WorkLogEntrySchema,
  type CareerRoutine,
} from "../../shared/career-types";
import { agentOSRoot } from "../agentos/filesystem";

/**
 * Career's own records, as one JSON file beside the career workspace's
 * TASKS.md in the vault: the work log and growth record are worth keeping
 * with the rest of the vault, not in UI state.
 *
 * Written atomically and serialised. Each collection is parsed item by item,
 * so one unreadable record is dropped rather than failing the page.
 */

const MAX_TIMESHEET_RUNS = 12;
const MAX_SOCCER_EVENTS = 26;
const MAX_WORK_LOG = 2000;

export const DEFAULT_ROUTINES: CareerRoutine[] = [
  { id: "timesheet", name: "Timesheet", weekday: 5, enabled: true },
  { id: "soccer", name: "Indoor soccer event", weekday: 2, enabled: true },
];

export interface CareerState {
  currentWork: z.infer<typeof CurrentWorkSchema>;
  taskMeta: z.infer<typeof CareerTaskMetaSchema>[];
  workLog: z.infer<typeof WorkLogEntrySchema>[];
  growth: z.infer<typeof CareerGrowthSchema>;
  routines: CareerRoutine[];
  timesheetRuns: z.infer<typeof TimesheetRunSchema>[];
  soccer: { defaults: z.infer<typeof SoccerDefaultsSchema>; events: z.infer<typeof SoccerEventSchema>[] };
  linkedinPosts: z.infer<typeof LinkedInPostSchema>[];
}

export function careerFile(): string {
  return path.join(agentOSRoot(), "projects", CAREER_SLUG, "career.json");
}

function items<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Missing or unreadable parts fall back to their defaults; nothing throws. */
export function normaliseState(raw: unknown): CareerState {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const soccer = (value.soccer && typeof value.soccer === "object" ? value.soccer : {}) as Record<string, unknown>;

  const stored = items(CareerRoutineSchema, value.routines);
  const routines = DEFAULT_ROUTINES.map((routine) => stored.find((item) => item.id === routine.id) ?? routine);

  return {
    currentWork: CurrentWorkSchema.safeParse(value.currentWork ?? {}).data ?? CurrentWorkSchema.parse({}),
    taskMeta: items(CareerTaskMetaSchema, value.taskMeta),
    workLog: items(WorkLogEntrySchema, value.workLog),
    growth: CareerGrowthSchema.safeParse(value.growth ?? {}).data ?? CareerGrowthSchema.parse({}),
    routines,
    timesheetRuns: items(TimesheetRunSchema, value.timesheetRuns),
    soccer: {
      defaults: SoccerDefaultsSchema.safeParse(soccer.defaults ?? {}).data ?? SoccerDefaultsSchema.parse({}),
      events: items(SoccerEventSchema, soccer.events),
    },
    linkedinPosts: items(LinkedInPostSchema, value.linkedinPosts),
  };
}

export async function readCareer(): Promise<CareerState> {
  try {
    return normaliseState(JSON.parse(await fs.readFile(careerFile(), "utf8")));
  } catch {
    return normaliseState({});
  }
}

async function writeCareer(state: CareerState): Promise<void> {
  const file = careerFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const trimmed: CareerState = {
    ...state,
    workLog: state.workLog.slice(0, MAX_WORK_LOG),
    timesheetRuns: state.timesheetRuns.slice(0, MAX_TIMESHEET_RUNS),
    soccer: { ...state.soccer, events: state.soccer.events.slice(0, MAX_SOCCER_EVENTS) },
  };
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(trimmed, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Read, change, write — one at a time. `change` may return a value for the
 * caller; throwing from it leaves the file untouched.
 */
export function mutateCareer<T>(change: (state: CareerState) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const state = await readCareer();
    const result = await change(state);
    await writeCareer(state);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
