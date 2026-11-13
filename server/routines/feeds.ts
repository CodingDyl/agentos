import type { MailData } from "../../shared/mail-types";
import type { FollowUpRow } from "../../shared/outreach-follow-ups";
import type { RoutineId } from "../../shared/routine-types";
import type { DayWrap, TodayCalendar } from "../../shared/today-types";
import type { WaitingOn } from "../../shared/traction-types";
import type { WorkerJob } from "../../shared/worker-types";
import { statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { overdueInvoicesReport, type OverdueInvoicesReport } from "../business/overdue";
import { readMailData } from "../mail/store";
import { computeFollowUps } from "../outreach/follow-ups";
import { getTodayCalendar } from "../today/calendar";
import { getDayWrap } from "../today/wrap";
import { chasesDue, daysBetween, isoDate } from "../traction/engine";
import { readState } from "../traction/store";
import { listJobs } from "../workers/job-store";

/**
 * The message each routine sends, written by AgentOS from its own records.
 *
 * Hermes delivers this text as it is and no model reads it. So a subject line
 * or a company name that someone else wrote can never act as an instruction.
 *
 * An empty message means there is nothing to report. Hermes then sends
 * nothing, which is what keeps a routine from becoming noise.
 */

/** Long enough to scan on a phone, short enough to read in one look. */
const LIST_LIMIT = 6;
const DAY = 86_400_000;

function oneLine(text: string, limit = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** The first few as bullets, then how many were left out. `total` is for a list that arrives already cut. */
function listed<T>(items: readonly T[], line: (item: T) => string, total: number = items.length): string[] {
  const shown = items.slice(0, LIST_LIMIT);
  const lines = shown.map((item) => `- ${line(item)}`);
  if (total > shown.length) lines.push(`and ${total - shown.length} more`);
  return lines;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function rand(minor: number): string {
  return `R ${(minor / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatFollowUps(rows: readonly FollowUpRow[], now: Date): string {
  const replied = rows.filter((row) => row.state === "replied");
  const due = rows.filter((row) => row.state === "due");
  if (replied.length === 0 && due.length === 0) return "";

  const who = (row: FollowUpRow) => oneLine(row.contact ? `${row.company} (${row.contact})` : row.company);
  const lines = ["Outreach today"];

  if (replied.length > 0) {
    lines.push("", `${plural(replied.length, "business", "businesses")} wrote back. Reply to them first:`, ...listed(replied, who));
  }
  if (due.length > 0) {
    lines.push(
      "",
      `${plural(due.length, "follow-up is", "follow-ups are")} due:`,
      ...listed(due, (row) => {
        const late = row.dueAt ? Math.floor((now.getTime() - Date.parse(row.dueAt)) / DAY) : 0;
        return `${who(row)}: email ${row.nextTouch ?? row.touches + 1}${late > 0 ? `, ${plural(late, "day", "days")} late` : ""}`;
      }),
    );
  }

  return [...lines, "", "Open AgentOS, Outreach."].join("\n");
}

export function formatInbox(mail: Pick<MailData, "needsYou">): string {
  if (mail.needsYou.length === 0) return "";

  return [
    `Inbox: ${plural(mail.needsYou.length, "email needs", "emails need")} you`,
    ...listed(mail.needsYou, (thread) => oneLine(`${thread.fromName ?? thread.fromEmail ?? "Unknown sender"}: ${thread.subject || "(no subject)"}`)),
    "",
    "Open AgentOS, Mail.",
  ].join("\n");
}

export function formatWrap(wrap: DayWrap): string {
  if (wrap.done.length === 0 && wrap.carryOverTotal === 0) return "";

  const lines = ["Day wrap", ""];
  if (wrap.done.length > 0) {
    lines.push(`Done today (${wrap.done.length}):`, ...listed(wrap.done, (item) => oneLine(item.project ? `${item.title} (${item.project})` : item.title)));
  } else {
    lines.push("Nothing was marked done in AgentOS today.");
  }

  if (wrap.carryOverTotal > 0) {
    lines.push(
      "",
      `Still open in Now (${wrap.carryOverTotal}):`,
      ...listed(wrap.carryOver, (item) => oneLine(`${item.title} (${item.projectName})`), wrap.carryOverTotal),
    );
  }

  return lines.join("\n");
}

export function formatOverdue(report: OverdueInvoicesReport): string {
  if (report.invoices.length === 0) return "";

  return [
    `Money check: ${plural(report.invoices.length, "invoice is", "invoices are")} overdue, ${rand(report.totalMinor)} owed`,
    ...listed(report.invoices, (invoice) =>
      oneLine([invoice.number ?? invoice.title, invoice.client, `due ${invoice.dueOn}`, rand(invoice.balanceMinor)].filter(Boolean).join(", "), 120),
    ),
    "",
    "Open AgentOS, Business.",
  ].join("\n");
}

/** Silent when the calendar is not connected: that is said in AgentOS, not every morning on the phone. */
export function formatDayAhead(calendar: TodayCalendar): string {
  if (calendar.status !== "ready" || calendar.today.length === 0) return "";

  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return [
    `Day ahead: ${plural(calendar.today.length, "event", "events")} today`,
    ...listed(calendar.today, (event) => {
      const when = event.allDay ? "All day" : event.end ? `${time(event.start)} to ${time(event.end)}` : time(event.start);
      // A link as the place is a call link. The words are shorter on a phone than the address.
      const link = /^https?:/.test(event.location ?? "");
      const where = [link ? undefined : event.location, link || event.meetingUrl ? "video call" : undefined].filter(Boolean).join(", ");
      return oneLine(`${when}: ${event.title}${where ? ` (${where})` : ""}`, 120);
    }),
  ].join("\n");
}

/** `due` is what `chasesDue` returned: open items whose chase date has arrived, longest-overdue first. */
export function formatWaitingOn(due: readonly WaitingOn[], today: string): string {
  if (due.length === 0) return "";

  return [
    `Waiting on others: ${plural(due.length, "chase is", "chases are")} due`,
    ...listed(due, (item) => oneLine(`${item.who}: ${item.what} (${plural(Math.max(0, daysBetween(item.since, today)), "day", "days")})`, 120)),
    "",
    "Open AgentOS, Traction.",
  ].join("\n");
}

/** A failed job is said for one day. After that it is old news, and repeating it would be noise. */
export function formatReviewQueue(jobs: readonly Pick<WorkerJob, "status" | "project" | "objective" | "createdAt" | "completedAt">[], now: Date): string {
  const review = jobs.filter((job) => job.status === "awaiting_review");
  const failed = jobs.filter((job) => job.status === "failed" && now.getTime() - Date.parse(job.completedAt ?? job.createdAt) < DAY);
  if (review.length === 0 && failed.length === 0) return "";

  const what = (job: Pick<WorkerJob, "project" | "objective">) => oneLine(`${job.project}: ${job.objective}`);
  const lines = ["Worker jobs"];
  if (review.length > 0) lines.push("", `${plural(review.length, "job waits", "jobs wait")} for your review:`, ...listed(review, what));
  if (failed.length > 0) lines.push("", `${plural(failed.length, "job", "jobs")} failed in the last day:`, ...listed(failed, what));

  return [...lines, "", "Open AgentOS, Operations."].join("\n");
}

const GB = 1024 ** 3;
/** Under this, builds and browser tests on this Mac start to fail with "no space left on device". */
const LOW_DISK_BYTES = 10 * GB;

export function formatStorage(disk: { freeBytes: number; totalBytes: number }): string {
  if (disk.freeBytes >= LOW_DISK_BYTES) return "";

  const gb = (bytes: number) => (bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0);
  return [
    `Mac storage is low: ${gb(disk.freeBytes)} GB free of ${gb(disk.totalBytes)} GB`,
    "Builds and tests fail when the disk is full. Free some space.",
  ].join("\n");
}

async function readDisk(): Promise<{ freeBytes: number; totalBytes: number }> {
  const stats = await statfs(homedir());
  return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
}

/** The message a routine would send right now. Empty when it has nothing to say. */
export async function buildFeed(id: RoutineId, now: Date = new Date()): Promise<string> {
  switch (id) {
    case "day-ahead":
      return formatDayAhead(await getTodayCalendar(now));
    case "waiting-on": {
      const today = isoDate(now);
      return formatWaitingOn(chasesDue((await readState()).waiting, today), today);
    }
    case "review-queue":
      return formatReviewQueue(await listJobs(200), now);
    case "storage":
      return formatStorage(await readDisk());
    case "follow-ups":
      return formatFollowUps(computeFollowUps(await readState(), now), now);
    case "inbox":
      return formatInbox(readMailData());
    case "evening-wrap":
      return formatWrap(await getDayWrap(now));
    case "overdue-invoices":
      return formatOverdue(await overdueInvoicesReport(now));
  }
}
