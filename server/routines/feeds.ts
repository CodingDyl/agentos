import type { MailData } from "../../shared/mail-types";
import type { FollowUpRow } from "../../shared/outreach-follow-ups";
import type { RoutineId } from "../../shared/routine-types";
import type { DayWrap } from "../../shared/today-types";
import { overdueInvoicesReport, type OverdueInvoicesReport } from "../business/overdue";
import { readMailData } from "../mail/store";
import { computeFollowUps } from "../outreach/follow-ups";
import { getDayWrap } from "../today/wrap";
import { readState } from "../traction/store";

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

/** The message a routine would send right now. Empty when it has nothing to say. */
export async function buildFeed(id: RoutineId, now: Date = new Date()): Promise<string> {
  switch (id) {
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
