import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { missingWorkdays, isoWeek, timesheetTotals } from "../../shared/career-logic";
import { TimesheetRowSchema, type TimesheetRun } from "../../shared/career-types";
import { addDays, isoDate } from "../../shared/traction-dates";
import { agentOSRoot } from "../agentos/filesystem";
import { authorize } from "../connectors/policy";
import { mutateCareer, newId } from "./store";
import { readTogglWeek, togglToken } from "./toggl";

/**
 * The timesheet runbook:
 *
 * ```text
 * Toggl (toggl.read_time_entries)
 *   → extract.py (career.timesheet.transform)
 *   → stored run, previewed in Career (career.timesheet.preview)
 *   → Entelect timesheet opened by the person (entelect.timesheet.open)
 *   → marked submitted after they confirm (entelect.timesheet.submit)
 * ```
 *
 * Entelect's timesheet site has no API AgentOS knows of, so AgentOS never
 * submits it: it prepares and checks the rows and the upload file, and a
 * person submits. Marking it submitted is the approval step that records it.
 */

export class TimesheetError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const REPO_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/career/timesheet/extract.py");

/** Where extract.py is: the configured path, the vault's copy, else the repository's. */
export function timesheetScript(): string {
  const configured = process.env.AGENTOS_TIMESHEET_SCRIPT?.trim();
  if (configured && path.isAbsolute(configured)) return configured;
  const vault = path.join(agentOSRoot(), "scripts", "career", "timesheet", "extract.py");
  return fs.existsSync(vault) ? vault : REPO_SCRIPT;
}

function pythonBinary(): string {
  return process.env.AGENTOS_PYTHON_BIN?.trim() || "python3";
}

export function timesheetReadiness(): { ready: boolean; detail?: string } {
  if (!fs.existsSync(timesheetScript())) return { ready: false, detail: `The extraction script is missing at ${timesheetScript()}.` };
  if (!togglToken()) return { ready: false, detail: "Add TOGGL_API_TOKEN in Connectors → Toggl Track." };
  return { ready: true };
}

const ScriptOutputSchema = z.object({
  rows: z.array(TimesheetRowSchema.extend({ issue: z.string().nullable().optional().transform((value) => value ?? undefined) })),
  runningEntries: z.number().int().min(0).default(0),
  warnings: z.array(z.string()).default([]),
  uploadFile: z.string().nullable().optional(),
});

/** Runs the script with the payload on stdin. No shell: the arguments are fixed. */
function runScript(payload: unknown, outputDir: string): Promise<z.infer<typeof ScriptOutputSchema>> {
  const script = timesheetScript();
  return new Promise((resolve, reject) => {
    const child = execFile(
      pythonBinary(),
      [script, "--xlsx-dir", outputDir],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, cwd: path.dirname(script) },
      (error, stdout, stderr) => {
        if (error) {
          reject(new TimesheetError(`The extraction script failed: ${(stderr || error.message).trim().slice(-400)}`, 502));
          return;
        }
        try {
          const parsed = ScriptOutputSchema.safeParse(JSON.parse(stdout));
          if (!parsed.success) throw new Error("shape");
          resolve(parsed.data);
        } catch {
          reject(new TimesheetError("The extraction script answered, but not with rows AgentOS could read.", 502));
        }
      },
    );
    child.stdin?.end(JSON.stringify(payload));
  });
}

export function timesheetOutputDir(): string {
  return path.join(agentOSRoot(), "projects", "career", "timesheets");
}

/** Extracts a week: Monday `weekStart` to Sunday. Never submits anything. */
export async function runTimesheetExtraction(weekStart: string, now: Date = new Date()): Promise<TimesheetRun> {
  const readiness = timesheetReadiness();
  if (!readiness.ready) throw new TimesheetError(readiness.detail ?? "The timesheet runbook is not set up.");

  const transform = authorize("career.timesheet.transform", { initiator: "person", detail: `week of ${weekStart}` });
  if (!transform.allowed) throw new TimesheetError(transform.reason, 403);

  const weekEnd = addDays(weekStart, 6);
  let toggl;
  try {
    toggl = await readTogglWeek(weekStart, weekEnd);
  } catch (error) {
    throw new TimesheetError(error instanceof Error ? error.message : "Toggl could not be read.", 502);
  }

  const output = await runScript({ ...toggl, weekStart, weekEnd }, timesheetOutputDir());
  const today = isoDate(now);
  const warnings = [...output.warnings];
  if (output.runningEntries > 0) {
    warnings.push(`${output.runningEntries} Toggl ${output.runningEntries === 1 ? "timer is" : "timers are"} still running and left out.`);
  }

  const run: TimesheetRun = {
    id: newId("ts"),
    weekStart,
    weekEnd,
    week: isoWeek(weekStart),
    status: "extracted",
    rows: output.rows,
    totals: timesheetTotals(output.rows),
    missingDays: missingWorkdays(output.rows, weekStart, addDays(weekStart, 4), today),
    runningEntries: output.runningEntries,
    warnings,
    uploadFile: output.uploadFile ?? undefined,
    createdAt: now.toISOString(),
  };

  await mutateCareer((state) => {
    state.timesheetRuns = [run, ...state.timesheetRuns.filter((item) => item.weekStart !== weekStart || item.status === "submitted")];
  });
  return run;
}

/** The person has looked at the preview. */
export async function markTimesheetReviewed(id: string, now: Date = new Date()): Promise<TimesheetRun> {
  authorize("career.timesheet.preview", { initiator: "person", detail: id });
  return mutateCareer((state) => {
    const run = state.timesheetRuns.find((item) => item.id === id);
    if (!run) throw new TimesheetError("There is no timesheet run with that id.", 404);
    if (run.status === "extracted") {
      run.status = "reviewed";
      run.reviewedAt = now.toISOString();
    }
    return run;
  });
}

/**
 * Records that the person submitted it on Entelect's site. Refused before a
 * review, and while rows are still unmapped unless they say they handled them.
 * Completes the timesheet routine.
 */
export async function markTimesheetSubmitted(id: string, options: { acceptUnmapped: boolean }, now: Date = new Date()): Promise<TimesheetRun> {
  const decision = authorize("entelect.timesheet.submit", { initiator: "person", detail: id });
  if (!decision.allowed) throw new TimesheetError(decision.reason, 403);

  return mutateCareer((state) => {
    const run = state.timesheetRuns.find((item) => item.id === id);
    if (!run) throw new TimesheetError("There is no timesheet run with that id.", 404);
    if (run.status === "extracted") throw new TimesheetError("Review the extracted rows before marking it submitted.", 409);
    if (run.totals.unmappedMinutes > 0 && !options.acceptUnmapped) {
      throw new TimesheetError("Some time is still unmapped. Fix it in Toggl and run again, or confirm you handled it.", 409);
    }
    run.status = "submitted";
    run.submittedAt = now.toISOString();
    const routine = state.routines.find((item) => item.id === "timesheet");
    if (routine) routine.lastCompletedOn = isoDate(now);
    return run;
  });
}

/** The upload file, by name only, from the timesheets folder. Never a path from the request. */
export function uploadFilePath(name: string): string | undefined {
  if (!/^timesheet-\d{4}-\d{2}-\d{2}\.xlsx$/.test(name)) return undefined;
  const file = path.join(timesheetOutputDir(), name);
  return fs.existsSync(file) ? file : undefined;
}
