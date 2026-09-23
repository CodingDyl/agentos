import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Automation,
  AutomationExecution,
  AutomationHealth,
  AutomationRunStatus,
  AutomationRunSummary,
  AutomationState,
} from "../../shared/agentos-types";
import { HermesError } from "./client";

/**
 * Hermes' scheduled jobs, read through its CLI.
 *
 * Automations are Hermes' own cron jobs — the console schedules nothing and
 * owns no execution engine. This module shells out to `hermes cron` and
 * translates its output into the model React consumes, so no CLI table, cron
 * expression or job record ever crosses the wire.
 *
 * The output format is not contractual, so every reader here is tolerant: an
 * unfamiliar line is skipped rather than failing the listing, and a job that
 * cannot be named is dropped while the rest still reach the screen.
 */

const execFileAsync = promisify(execFile);

/** Overridable so a non-standard install still works. */
const HERMES_CLI = process.env.HERMES_CLI_PATH ?? "hermes";

const CLI_TIMEOUT_MS = 20_000;

/** History is a browsing surface, not an archive. */
const RUN_HISTORY_LIMIT = 25;

/**
 * Runs one `hermes cron` subcommand and returns its stdout.
 *
 * A non-zero exit is not automatically a failure: `cron doctor` exits 1 when it
 * finds issues, which is a result rather than an error. Output is kept whenever
 * there is output, and only a CLI that produced none is treated as unreachable.
 */
async function runCron(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(HERMES_CLI, ["cron", ...args], {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const failure = error as { stdout?: string; code?: string };

    if (typeof failure.stdout === "string" && failure.stdout.trim().length > 0) {
      return failure.stdout;
    }

    throw new HermesError(
      `Could not run \`${HERMES_CLI} cron ${args.join(" ")}\`.`,
      failure.code === "ENOENT" ? "not-configured" : "offline",
    );
  }
}

/** The CLI colours its output when it is attached to a terminal. */
function stripAnsi(value: string): string {
  // The escape byte is the point: this matches SGR colour codes and nothing
  // else, so a job whose name happens to contain brackets survives intact.
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

/**
 * The badge `cron list` prints beside a job id.
 *
 * `completed` is a job that has finished its repeat count — it is not disabled,
 * and the difference is between "you turned this off" and "this is done".
 */
const STATE_BADGES: Record<string, AutomationState> = {
  active: "active",
  paused: "paused",
  disabled: "disabled",
  completed: "completed",
};

const JOB_HEADER = /^ {2}(\S+) +\[([a-z]+)]\s*$/;
const JOB_FIELD = /^ {4}([A-Za-z][A-Za-z ]*):\s*(.*)$/;
const JOB_WARNING = /^ {4}(⚠.*)$/;

/** One job, as the CLI's label/value rows describe it. */
interface JobBlock {
  id: string;
  state: AutomationState;
  fields: Map<string, string>;
  warnings: string[];
}

/** Splits the listing into one block per job. Anything else is ignored. */
function readJobBlocks(stdout: string): JobBlock[] {
  const blocks: JobBlock[] = [];
  let current: JobBlock | undefined;

  for (const raw of stripAnsi(stdout).split("\n")) {
    const line = raw.replace(/\s+$/, "");

    const header = JOB_HEADER.exec(line);
    if (header) {
      current = {
        id: header[1],
        // An unfamiliar badge is not a reason to hide the job; it is simply
        // not a state the console can claim is running.
        state: STATE_BADGES[header[2]] ?? "disabled",
        fields: new Map(),
        warnings: [],
      };
      blocks.push(current);
      continue;
    }

    if (!current) continue;

    const field = JOB_FIELD.exec(line);
    if (field) {
      current.fields.set(field[1].trim().toLowerCase(), field[2].trim());
      continue;
    }

    const warning = JOB_WARNING.exec(line);
    if (warning) current.warnings.push(warning[1].trim());
  }

  return blocks;
}

function present(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "?" ? trimmed : undefined;
}

/** `start-day, google-workspace` → `["start-day", "google-workspace"]`. */
function readSkills(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^\/+/, ""))
    .filter((entry) => entry.length > 0);
}

/**
 * Reads the `Last run` row: a timestamp, then how it went.
 *
 * The verdict is either `ok` or `<status>: <reason>`. The reason is carried
 * through untouched — a failing automation should say what Hermes said, not a
 * paraphrase of it.
 */
export function readLastRun(
  value: string | undefined,
): AutomationRunSummary | undefined {
  const line = present(value);
  if (!line) return undefined;

  // The CLI separates the timestamp from the verdict with two spaces.
  const [timestamp, ...rest] = line.split(/ {2,}/);
  if (!present(timestamp)) return undefined;

  const verdict = rest.join("  ").trim();

  if (verdict.length === 0 || verdict === "ok") {
    return { status: "success", timestamp };
  }

  return { status: "failed", timestamp, detail: verdict };
}

/** Reads `hermes cron list` into the automations the console shows. */
export function readAutomations(stdout: string): Automation[] {
  return readJobBlocks(stdout).flatMap((block) => {
    const name = present(block.fields.get("name"));
    if (!name) return [];

    const skills = readSkills(block.fields.get("skills"));

    return [
      {
        id: block.id,
        name,
        schedule: present(block.fields.get("schedule")) ?? "Schedule unknown",
        enabled: block.state === "active",
        state: block.state,
        skill: skills[0],
        skills,
        lastRun: readLastRun(block.fields.get("last run")),
        nextRun: present(block.fields.get("next run")),
        warnings: block.warnings,
      },
    ];
  });
}

/**
 * Execution statuses Hermes records, mapped onto the three the console shows.
 *
 * `unknown` is an attempt whose process vanished: Hermes cannot say it
 * succeeded, so neither does the console — but calling it "failed" and leaving
 * it there would overstate what is known, so the raw word is kept too.
 */
const EXECUTION_STATUSES: Record<string, AutomationRunStatus> = {
  completed: "success",
  failed: "failed",
  unknown: "failed",
  running: "running",
  claimed: "running",
};

/** Words the three console statuses represent faithfully. */
const FAITHFUL_STATUSES = new Set(["completed", "failed", "running", "claimed"]);

const EXECUTION_ROW = /^(\S+) {2,}(\S+) +job=(\S+) +source=(\S+) +(\S+)\s*$/;

/**
 * Reads `hermes cron runs` into a run history.
 *
 * A failed attempt is followed by an indented reason line, which is attached to
 * the row above it.
 */
export function readAutomationRuns(stdout: string): AutomationExecution[] {
  const runs: AutomationExecution[] = [];

  for (const raw of stripAnsi(stdout).split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const row = EXECUTION_ROW.exec(line);

    if (row) {
      const status = row[2];
      runs.push({
        id: row[1],
        automationId: row[3],
        status: EXECUTION_STATUSES[status] ?? "failed",
        timestamp: row[5],
        rawStatus: FAITHFUL_STATUSES.has(status) ? undefined : status,
      });
      continue;
    }

    // An error line belongs to the attempt it follows.
    const detail = line.trim();
    const previous = runs.at(-1);

    if (detail.length > 0 && line.startsWith("    ") && previous && !previous.error) {
      previous.error = detail;
    }
  }

  return runs;
}

const DOCTOR_ISSUE = /^ {4}- +(.*)$/;
const DOCTOR_JOB = /^ {2}(\S+) +(.*)$/;

/**
 * Reads `hermes cron doctor` as a verdict.
 *
 * Health is only claimed when the doctor actually says so: output this cannot
 * read reports as unhealthy with nothing listed, never as a clean bill.
 */
export function readAutomationHealth(stdout: string): AutomationHealth {
  const lines = stripAnsi(stdout).split("\n");

  if (lines.some((line) => line.includes("found no issues"))) {
    return { ok: true, issues: [] };
  }

  const issues: string[] = [];
  let job: string | undefined;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    const issue = DOCTOR_ISSUE.exec(line);
    if (issue) {
      issues.push(job ? `${job}: ${issue[1]}` : issue[1]);
      continue;
    }

    // Job headers are indented exactly two spaces; summary and hint lines are
    // not indented at all.
    const header = DOCTOR_JOB.exec(line);
    if (header && !line.startsWith("   ")) job = header[2].trim();
  }

  return { ok: false, issues };
}

export interface AutomationsResult {
  automations: Automation[];
  health: AutomationHealth;
}

/**
 * Every scheduled job Hermes has, with its health.
 *
 * Disabled jobs are included: an automation that is off is still something the
 * operator needs to see, and hiding it would make the screen lie about what
 * exists.
 */
export async function getAutomations(): Promise<AutomationsResult> {
  const [listing, doctor] = await Promise.all([
    runCron(["list", "--all"]),
    // The doctor is advisory: a health check that fails must not empty the list.
    runCron(["doctor"]).catch(() => ""),
  ]);

  return {
    automations: readAutomations(listing),
    health: doctor
      ? readAutomationHealth(doctor)
      : { ok: false, issues: ["Hermes could not report automation health."] },
  };
}

/**
 * Recent execution attempts across every job.
 *
 * One CLI call rather than one per automation — the activity timeline wants
 * the newest attempts overall, not the newest attempts of each job.
 */
export async function getRecentExecutions(
  limit: number,
): Promise<AutomationExecution[]> {
  return readAutomationRuns(await runCron(["runs", "--limit", String(limit)]));
}

export interface AutomationDetailResult {
  automation: Automation;
  runs: AutomationExecution[];
}

/** One automation and its recent execution attempts. */
export async function getAutomation(
  id: string,
): Promise<AutomationDetailResult | undefined> {
  const { automations } = await getAutomations();
  const automation = automations.find((entry) => entry.id === id);

  if (!automation) return undefined;

  // The id is matched against the listing before it reaches the CLI, so an
  // unknown id never becomes a subcommand argument.
  const history = await runCron([
    "runs",
    automation.id,
    "--limit",
    String(RUN_HISTORY_LIMIT),
  ]).catch(() => "");

  return { automation, runs: readAutomationRuns(history) };
}
