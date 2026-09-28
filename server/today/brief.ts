import fs from "node:fs/promises";
import path from "node:path";
import type { BriefPlan, MorningBrief } from "../../shared/today-types";
import { hermesHome } from "../hermes/automations";

/**
 * Hermes' morning brief, as Today shows it.
 *
 * The brief is a scheduled Hermes job (the `start-day` skill) whose output
 * Hermes writes to `cron/output/<job>/<timestamp>.md`. This reads the newest
 * one and pulls the reply apart into its plan. Read-only; no model call.
 */

interface JobRecord {
  id?: unknown;
  name?: unknown;
  skills?: unknown;
  skill?: unknown;
}

/** The job that writes the brief: named "morning brief", or else the one running `start-day`. */
export function findBriefJob(json: string): { id: string; name: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const container = parsed as { jobs?: unknown };
  const jobs: JobRecord[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(container?.jobs)
      ? container.jobs
      : container?.jobs && typeof container.jobs === "object"
        ? Object.values(container.jobs)
        : [];

  const valid = jobs.filter(
    (job): job is JobRecord & { id: string; name: string } => typeof job?.id === "string" && typeof job?.name === "string",
  );
  const skillsOf = (job: JobRecord) =>
    [...(Array.isArray(job.skills) ? job.skills : []), job.skill].filter((skill): skill is string => typeof skill === "string");

  const match =
    valid.find((job) => /morning brief/i.test(job.name)) ?? valid.find((job) => skillsOf(job).includes("start-day"));
  return match ? { id: match.id, name: match.name } : undefined;
}

/** `2026-09-28_07-30-35.md` → that moment in local time. */
export function runAtFromFilename(filename: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(filename);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

/** Everything after the last `## Response` heading: Hermes' actual reply. */
export function readResponse(markdown: string): string | undefined {
  const index = markdown.lastIndexOf("\n## Response");
  if (index === -1) return undefined;
  const after = markdown.slice(index + 1).split("\n").slice(1).join("\n").trim();
  return after.length > 0 ? after : undefined;
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
}

/**
 * The start-day reply, pulled apart by its bold labels: Main outcome, Top 3,
 * If there's time, Avoid. Anything else labelled (Calendar, Focus time) is
 * kept as a note. A reply with neither an outcome nor a top list isn't a plan.
 */
export function parseBriefPlan(response: string): BriefPlan | undefined {
  const sections: { label: string; lines: string[] }[] = [];
  for (const raw of response.split("\n")) {
    const line = raw.trim();
    if (!line || /^#\s/.test(line)) continue;
    const label = /^\*\*(.+?)\*\*:?\s*(.*)$/.exec(line);
    if (label) {
      sections.push({ label: label[1].trim(), lines: label[2] ? [label[2]] : [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const find = (pattern: RegExp) => sections.find((section) => pattern.test(section.label));
  const text = (section?: { lines: string[] }) =>
    section && section.lines.length > 0 ? section.lines.map(stripListMarker).join(" ") : undefined;
  const list = (section?: { lines: string[] }) => (section ? section.lines.map(stripListMarker).filter(Boolean) : []);

  const outcome = find(/^main outcome$/i);
  const top = find(/^top \d+$/i);
  const ifTime = find(/^if there'?s time$/i);
  const avoid = find(/^avoid$/i);
  const known = new Set([outcome, top, ifTime, avoid]);

  const plan: BriefPlan = {
    mainOutcome: text(outcome),
    top: list(top),
    ifTime: list(ifTime),
    avoid: text(avoid),
    notes: sections
      .filter((section) => !known.has(section) && section.lines.length > 0)
      .map((section) => ({ label: section.label, text: section.lines.map(stripListMarker).join(" ") })),
  };

  return plan.mainOutcome || plan.top.length > 0 ? plan : undefined;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export async function getMorningBrief(now: Date = new Date()): Promise<MorningBrief> {
  const home = hermesHome();

  let job: { id: string; name: string } | undefined;
  try {
    job = findBriefJob(await fs.readFile(path.join(home, "cron", "jobs.json"), "utf8"));
  } catch {
    job = undefined;
  }
  if (!job) return { status: "no-job" };

  // The id came from Hermes' own job record; refuse anything that could walk the tree.
  if (!/^[A-Za-z0-9_-]+$/.test(job.id)) return { status: "no-job" };

  let files: string[];
  try {
    files = (await fs.readdir(path.join(home, "cron", "output", job.id))).filter((file) => file.endsWith(".md")).sort();
  } catch {
    files = [];
  }
  const newest = files.at(-1);
  if (!newest) return { status: "none", jobId: job.id, jobName: job.name };

  const directory = path.join(home, "cron", "output", job.id);
  const markdown = await fs.readFile(path.join(directory, newest), "utf8");
  const runAt = runAtFromFilename(newest);
  const response = readResponse(markdown);
  const plan = response ? parseBriefPlan(response) : undefined;

  // A brief that failed (no calendar, say) shouldn't leave the day planless:
  // offer the most recent plan Hermes did write, from within the last week.
  let lastPlan: MorningBrief["lastPlan"];
  if (!plan) {
    for (const file of files.slice(0, -1).reverse().slice(0, 7)) {
      const earlier = readResponse(await fs.readFile(path.join(directory, file), "utf8").catch(() => ""));
      const earlierPlan = earlier ? parseBriefPlan(earlier) : undefined;
      const earlierAt = runAtFromFilename(file);
      if (earlierPlan && earlierAt) {
        lastPlan = { runAt: earlierAt.toISOString(), plan: earlierPlan };
        break;
      }
    }
  }

  return {
    status: runAt && sameLocalDay(runAt, now) ? "today" : "stale",
    jobId: job.id,
    jobName: job.name,
    runAt: runAt?.toISOString(),
    plan,
    response,
    lastPlan,
  };
}
