import type { CompassGoal } from "../../shared/compass-types";
import type { ClientOutcome, OutcomesResponse, OwnerHoursEntry } from "../../shared/outcomes-types";

/**
 * The scorecard's arithmetic. Plain arrays in, one response out: no I/O here,
 * so every figure can be pinned by a test and none of them depends on the
 * machine's clock or time zone.
 *
 * Rand amounts are integer minor units. AI cost stays in USD and is never
 * converted. Absent is not zero: an unknown rate or cost is null.
 */

export interface OutcomeInputs {
  goals: readonly CompassGoal[];
  clients: ReadonlyArray<{ id: string; name: string; workspace: string | null }>;
  /** `clientKey` is the business client the payment was matched to, or undefined when none could be. */
  payments: ReadonlyArray<{ id: string; receivedOn: string; amountMinor: number; clientKey?: string }>;
  jobs: ReadonlyArray<{ id: string; project: string; status: string; attempt: number; completedAt?: string }>;
  usage: ReadonlyArray<{ project?: string; costUsd?: number }>;
  hours: readonly OwnerHoursEntry[];
  warnings: readonly string[];
}

const TIME_ZONE = "Africa/Johannesburg";
const DAY_MS = 24 * 60 * 60 * 1000;
const PAYING_DAYS = 90;
const MAX_ENTRIES = 50;

function datePartsIn(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** YYYY-MM in South African time: 22:30 UTC on the 31st is already the next month there. */
export function currentMonth(now: Date): string {
  const { year, month } = datePartsIn(now);
  return `${year}-${pad(month)}`;
}

/** Today as YYYY-MM-DD in South African time. */
function today(now: Date): string {
  const { year, month, day } = datePartsIn(now);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** A timestamp's month in South African time. */
function monthOfInstant(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : currentMonth(date);
}

function shiftDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function shiftMonths(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** "R100,000+", "R100k", "R 85 000" → minor units. Anything else is null, never a guess. */
export function parseTargetMinor(target: string): number | null {
  const match = /^\s*R\s*([0-9][0-9\s,]*(?:\.[0-9]+)?)\s*(k|m)?\s*\+?\s*$/i.exec(target);
  if (!match) return null;
  const amount = Number(match[1].replace(/[\s,]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return Math.round(amount * multiplier * 100);
}

function findTarget(goals: readonly CompassGoal[], warnings: string[]): OutcomesResponse["target"] {
  const moneyGoals = goals.filter((goal) => /monthly income/i.test(goal.measure));
  for (const goal of moneyGoals) {
    const minor = parseTargetMinor(goal.target);
    if (minor !== null) return { goalId: goal.id, minor };
  }
  if (moneyGoals.length > 0) warnings.push(`The target on ${moneyGoals[0].id} in Compass can't be read as a rand amount, so there is no gap to show.`);
  return null;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function computeOutcomes(input: OutcomeInputs, now: Date): OutcomesResponse {
  const warnings = [...input.warnings];
  const month = currentMonth(now);
  const todayDate = today(now);
  const payingSince = shiftDays(todayDate, -PAYING_DAYS);
  const weekSince = shiftDays(todayDate, -6);

  const target = findTarget(input.goals, warnings);
  const paidInMonth = (payment: { receivedOn: string }) => payment.receivedOn.slice(0, 7) === month;
  const paidMinor = sum(input.payments.filter(paidInMonth).map((payment) => payment.amountMinor));

  // Last three full months, zero months included. Null only when nothing was ever paid.
  const trailingMonths = [1, 2, 3].map((back) => shiftMonths(month, -back));
  const trailingAverageMinor =
    input.payments.length === 0
      ? null
      : Math.round(sum(input.payments.filter((payment) => trailingMonths.includes(payment.receivedOn.slice(0, 7))).map((payment) => payment.amountMinor)) / 3);

  const landedJobs = input.jobs.filter((job) => job.status === "completed" && job.completedAt !== undefined && monthOfInstant(job.completedAt) === month);
  const monthHours = input.hours.filter((entry) => entry.on.slice(0, 7) === month);

  const payingClientIds = new Set(
    input.payments.filter((payment) => payment.clientKey && payment.receivedOn >= payingSince && payment.receivedOn <= todayDate).map((payment) => payment.clientKey as string),
  );
  const workspaceOwners = new Map<string, string[]>();
  for (const client of input.clients) {
    if (client.workspace) workspaceOwners.set(client.workspace, [...(workspaceOwners.get(client.workspace) ?? []), client.id]);
  }
  const clientIds = new Set(input.clients.map((client) => client.id));

  const clients: ClientOutcome[] = [];
  for (const client of input.clients) {
    const mine = input.payments.filter((payment) => payment.clientKey === client.id);
    const myJobs = client.workspace ? landedJobs.filter((job) => job.project === client.workspace) : [];
    const myUsage = client.workspace ? input.usage.filter((record) => record.project === client.workspace) : [];
    const myHours = monthHours.filter((entry) => entry.clientId === client.id || (entry.clientId === undefined && client.workspace !== null && entry.workspace === client.workspace));
    const costs = myUsage.flatMap((record) => (typeof record.costUsd === "number" ? [record.costUsd] : []));
    const ownerMinutes = sum(myHours.map((entry) => entry.minutes));
    const monthPaid = sum(mine.filter(paidInMonth).map((payment) => payment.amountMinor));
    const trailing90 = sum(mine.filter((payment) => payment.receivedOn >= payingSince && payment.receivedOn <= todayDate).map((payment) => payment.amountMinor));

    // Show a client only once something has happened with them.
    if (mine.length === 0 && myJobs.length === 0 && ownerMinutes === 0) continue;
    clients.push({
      clientId: client.id,
      name: client.name,
      workspace: client.workspace,
      paidMinor: monthPaid,
      paidTrailing90Minor: trailing90,
      landedJobs: myJobs.length,
      sendBacks: sum(myJobs.map((job) => Math.max(0, job.attempt - 1))),
      aiCostUsd: costs.length > 0 ? sum(costs) : null,
      ownerMinutes,
      randPerHourMinor: ownerMinutes > 0 ? Math.round(monthPaid / (ownerMinutes / 60)) : null,
    });
  }
  clients.sort((a, b) => b.paidMinor - a.paidMinor || b.paidTrailing90Minor - a.paidTrailing90Minor || a.name.localeCompare(b.name));

  const unattributedLanded = landedJobs.filter((job) => !workspaceOwners.has(job.project));
  const unattributedMinutes = sum(
    monthHours
      .filter((entry) => !(entry.clientId && clientIds.has(entry.clientId)) && !(entry.workspace && workspaceOwners.has(entry.workspace)))
      .map((entry) => entry.minutes),
  );
  const onPayingClients = landedJobs.filter((job) => (workspaceOwners.get(job.project) ?? []).some((id) => payingClientIds.has(id))).length;

  const byKind: Record<string, number> = {};
  for (const entry of monthHours) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + entry.minutes;

  return {
    month,
    target,
    paidMinor,
    gapMinor: target ? Math.max(0, target.minor - paidMinor) : null,
    trailingAverageMinor,
    clients,
    unattributed: {
      paidMinor: sum(input.payments.filter((payment) => paidInMonth(payment) && !(payment.clientKey && clientIds.has(payment.clientKey))).map((payment) => payment.amountMinor)),
      landedJobs: unattributedLanded.length,
      ownerMinutes: unattributedMinutes,
    },
    agentWork: {
      landedJobs: landedJobs.length,
      onPayingClients,
      firstPassRate: landedJobs.length > 0 ? landedJobs.filter((job) => job.attempt === 1).length / landedJobs.length : null,
    },
    ownerHours: {
      monthMinutes: sum(monthHours.map((entry) => entry.minutes)),
      weekMinutes: sum(input.hours.filter((entry) => entry.on >= weekSince && entry.on <= todayDate).map((entry) => entry.minutes)),
      byKind,
      entries: [...monthHours].sort((a, b) => b.on.localeCompare(a.on) || b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_ENTRIES),
    },
    choices: { clients: input.clients.map((client) => ({ ...client })).sort((a, b) => a.name.localeCompare(b.name)) },
    warnings,
  };
}
