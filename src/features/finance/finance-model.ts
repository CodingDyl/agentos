import type { Category, FinanceData, FinanceTab, Subscription } from "@shared/finance-types";
import { formatRandAmount } from "@shared/finance-types";

/** Finance's presentation rules, as plain functions. */

export const money = (value: number, cents = false) => formatRandAmount(value, { cents });

export const FINANCE_TAB_OPTIONS: readonly { value: FinanceTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "cash-flow", label: "Cash flow" },
  { value: "spending", label: "Spending" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "goals", label: "Goals" },
  { value: "investments", label: "Investments" },
  { value: "insights", label: "Insights" },
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

/** The categories a person can move a payment into. Income and Transfer are included: a refund is not spending. */
export const CATEGORY_CHOICES: readonly Category[] = [
  "Housing",
  "Groceries",
  "Dining",
  "Transport",
  "Subscriptions",
  "Health",
  "Shopping",
  "Travel",
  "Business",
  "Insurance",
  "Fees",
  "Other",
  "Transfer",
  "Income",
];

export interface UpcomingPayment {
  merchant: string;
  date: string;
  amount: number;
}

function addOneMonth(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Recurring payments expected in the next `days`, from the rhythm already
 * detected. A monthly charge is expected one month after it last cleared; an
 * annual one is left out (a year's notice is not "coming up"). It is a
 * projection of a pattern, not a schedule the bank gave us, and is labelled so.
 */
export function upcomingPayments(data: Pick<FinanceData, "subscriptions" | "today">, days = 14): UpcomingPayment[] {
  const horizon = new Date(`${data.today}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + days);
  const limit = horizon.toISOString().slice(0, 10);

  return data.subscriptions
    .filter((subscription) => subscription.frequency === "monthly")
    .map((subscription) => ({ merchant: subscription.merchant, date: addOneMonth(subscription.lastPaid), amount: subscription.monthly }))
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

export function sourceLabel(source: FinanceData["source"]): string {
  if (source.kind === "sample") return "Sample data";
  if (source.kind === "none") return "No accounts yet";
  return "Investec, read-only";
}
