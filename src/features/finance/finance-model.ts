import { CATEGORIES, formatRandAmount, type Category, type FinanceData, type FinanceTab, type Subscription } from "@shared/finance-types";

/** Finance's presentation rules, as plain functions. */

export const money = (value: number, cents = false) => formatRandAmount(value, { cents });

export const FINANCE_TAB_OPTIONS: readonly { value: FinanceTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "cash-flow", label: "Cash flow" },
  { value: "spending", label: "Spending" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "bills", label: "Bills" },
  { value: "shared", label: "Shared" },
  { value: "goals", label: "Goals" },
  { value: "savings", label: "Savings" },
  { value: "investments", label: "Investments" },
  { value: "insights", label: "Insights" },
  { value: "analyser", label: "Analyser" },
  { value: "settings", label: "Settings" },
];

export function isFinanceTab(value: string | null): value is FinanceTab {
  return FINANCE_TAB_OPTIONS.some((tab) => tab.value === value);
}

/** `+63%`, `-12%`, or an em-dash-free `-` when there is nothing to compare with. */
export function formatChange(change: number | undefined): string {
  if (change === undefined) return "-";
  const percent = Math.round(change * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

export const formatMonthShort = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

export const formatDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const TIER_LABEL: Record<Subscription["tier"], string> = {
  high: "High savings opportunity",
  medium: "Medium",
  low: "Low",
  unassessed: "Not assessed yet",
};

/**
 * The categories a person can move a payment into. Spending categories first;
 * Transfer and Income last, because moving a payment there takes it out of
 * spending altogether.
 */
export const CATEGORY_CHOICES: readonly Category[] = [...CATEGORIES.filter((category) => category !== "Income" && category !== "Transfer" && category !== "Reimbursement"), "Reimbursement", "Transfer", "Income"];

export interface UpcomingPayment {
  merchant: string;
  date: string;
  amount: number;
}

/** `date` plus a number of months, clamped to the end of a shorter month (31 Jan + 1 month is 28 Feb). */
function addMonthsTo(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

const addOneMonth = (date: string) => addMonthsTo(date, 1);

/**
 * Payments expected in the next `days`: subscriptions from the rhythm already
 * detected, and the bills you track. A monthly charge is expected one month after it last cleared; an
 * annual one is left out (a year's notice is not "coming up"). It is a
 * projection of a pattern, not a schedule the bank gave us, and is labelled so.
 */
export function upcomingPayments(data: Pick<FinanceData, "subscriptions" | "today"> & { bills?: FinanceData["bills"] }, days = 14): UpcomingPayment[] {
  const horizon = new Date(`${data.today}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + days);
  const limit = horizon.toISOString().slice(0, 10);

  const projected = data.subscriptions
    .filter((subscription) => subscription.frequency === "monthly")
    .map((subscription) => ({ merchant: subscription.merchant, date: addOneMonth(subscription.lastPaid), amount: subscription.monthly }));

  // A tracked bill is not a projection: you told Finance its due day, and it
  // is still to come only if this month's payment has not been seen.
  const bills = (data.bills?.items ?? [])
    .filter((bill) => bill.status !== "paid" && bill.status !== "missing")
    .map((bill) => ({ merchant: bill.name, date: bill.dueDate, amount: bill.amount }));

  return [...projected, ...bills]
    .filter((payment) => payment.date > data.today && payment.date <= limit)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** How a goal's status reads, in words a person would say. */
export function goalStatusLabel(goal: FinanceData["goals"][number]): string {
  switch (goal.status) {
    case "done":
      return "Reached";
    case "on-track":
      return "On track";
    case "behind":
      return `Behind by ${formatRandAmount(goal.shortfall ?? 0)}`;
    case "overdue":
      return "Past its date";
    case "no-date":
      return "No date set";
  }
}

export function sourceLabel(source: FinanceData["source"], accounts: FinanceData["accounts"] = []): string {
  if (source.kind === "sample") return "Sample data";
  if (source.kind === "none") return "No accounts yet";
  if (source.kind === "manual") return "Accounts you added";
  return accounts.some((account) => account.provider === "manual") ? "Investec, read-only, and accounts you added" : "Investec, read-only";
}

/** Real money is on the page: Investec's, or an account you added. Sample data and an empty page are not. */
export const isLiveSource = (source: FinanceData["source"]) => source.kind === "investec" || source.kind === "manual";

// ------------------------------------------------------------- pay state

export type PayState = "paid" | "due" | "late" | "unknown";

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);

/** Days after the expected date before a payment that has not turned up counts as "not seen". Debit orders land a day or two late. */
const GRACE_DAYS = 3;

/**
 * Has this subscription been paid, is it due, or has it not turned up?
 *
 * Worked out from the last payment Finance saw and its rhythm, so it is as good
 * as the statement: a payment from an account Finance cannot see reads as "not
 * seen". A monthly one is paid if it cleared this month; a yearly one is paid
 * until the month before its anniversary.
 */
export function subscriptionPayState(subscription: Pick<Subscription, "lastPaid" | "frequency">, today: string): { state: PayState; label: string } {
  const { lastPaid, frequency } = subscription;

  if (frequency === "monthly") {
    if (lastPaid.slice(0, 7) === today.slice(0, 7)) return { state: "paid", label: `Paid ${formatDay(lastPaid)}` };
    const nextDue = addOneMonth(lastPaid);
    const late = daysBetween(nextDue, today);
    if (late > GRACE_DAYS) return { state: "late", label: `Not seen since ${formatDay(lastPaid)}` };
    return { state: "due", label: late <= 0 ? `Due ${formatDay(nextDue)}` : `Was due ${formatDay(nextDue)}` };
  }

  const nextDue = addMonthsTo(lastPaid, 12);
  const untilDue = daysBetween(today, nextDue);
  if (untilDue < -GRACE_DAYS) return { state: "late", label: `Not seen since ${formatDay(lastPaid)}` };
  if (untilDue <= 30) return { state: "due", label: `Due ${formatDay(nextDue)}` };
  return { state: "paid", label: `Paid ${formatDay(lastPaid)}, yearly` };
}

/** How a card's payment this month reads. Without its statement, "no payment" is not known, so it says so. */
export function debtPayState(debt: Pick<FinanceData["debts"][number], "paidThisMonth" | "hasStatement">): { state: PayState; label: string } {
  if (!debt.hasStatement) return { state: "unknown", label: "No statement imported" };
  if (debt.paidThisMonth > 0) return { state: "paid", label: `${money(debt.paidThisMonth)} paid this month` };
  return { state: "late", label: "No payment this month" };
}

/** How worried to be about the share of a limit in use: under 30% is comfortable, over 75% is a problem. */
export function utilisationTone(utilisation: number): "good" | "watch" | "act" {
  return utilisation < 0.3 ? "good" : utilisation < 0.75 ? "watch" : "act";
}
