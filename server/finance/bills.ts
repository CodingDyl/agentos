import type { BillStatus, BillSuggestion, Category, Transaction } from "../../shared/finance-types";
import { addMonths, monthOf, type RecurringMerchant } from "./engine";
import type { BillMarkRow, StoredBill } from "./store";
import { merchantKey } from "./categorise";

/**
 * Bills: the fixed monthly payments you keep track of.
 *
 * You tell Finance what a bill is and about what it costs; each month it looks
 * for the payment. Pure functions: bills, what was paid, and today in; a status
 * for each out.
 *
 * Two honesty rules. A bill past its date that has not turned up is "not seen
 * yet", never "unpaid", because a payment can lag, or leave from an account
 * Finance cannot see. And an amount that differs from what you said is shown
 * as it is: electricity is meant to vary, and the average is there for that.
 */

/** Days after the due date before "not seen yet" becomes the status. Debit orders often land a day or two late. */
const GRACE_DAYS = 3;
const HISTORY_MONTHS = 4;

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);

/** This month's due date: the due day, or the month's last day if it has fewer days. */
export function dueDateFor(month: string, dueDay: number): string {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does this payment belong to the bill? A whole-word match of the bill's match
 * word (its name, if none was set) in the description or merchant. Whole-word
 * is the point: "rent" must not find "current account fee".
 */
export function paymentMatchesBill(bill: Pick<StoredBill, "name" | "match">, transaction: Pick<Transaction, "amount" | "description" | "merchant">): boolean {
  if (transaction.amount >= 0) return false;
  const term = (bill.match?.trim() || bill.name).toLowerCase();
  if (!term) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i");
  return pattern.test(transaction.description) || pattern.test(transaction.merchant ?? "");
}

const r2 = (value: number) => Math.round(value * 100) / 100;

export function buildBillStatuses(
  bills: readonly StoredBill[],
  marks: readonly BillMarkRow[],
  transactions: readonly Transaction[],
  today: string,
): BillStatus[] {
  const month = monthOf(today);
  const months = Array.from({ length: HISTORY_MONTHS }, (_, index) => addMonths(month, index - (HISTORY_MONTHS - 1)));

  return bills.map((bill): BillStatus => {
    const found = transactions.filter((t) => paymentMatchesBill(bill, t));

    const amountFor = (target: string): { amount: number; paidOn?: string; marked: boolean } | undefined => {
      const rows = found.filter((t) => monthOf(t.date) === target);
      if (rows.length > 0) {
        return { amount: r2(-rows.reduce((total, t) => total + t.amount, 0)), paidOn: rows.map((t) => t.date).sort()[rows.length - 1], marked: false };
      }
      const mark = marks.find((entry) => entry.billId === bill.id && entry.month === target);
      return mark ? { amount: mark.amount, paidOn: mark.paidOn, marked: true } : undefined;
    };

    const history = months.map((target) => ({ month: target, amount: amountFor(target)?.amount }));
    const seen = history.map((entry) => entry.amount).filter((value): value is number => value !== undefined);
    const paid = amountFor(month);

    const dueDate = dueDateFor(month, bill.dueDay);
    const daysUntil = dayNumber(dueDate) - dayNumber(today);
    const status: BillStatus["status"] = paid ? "paid" : daysUntil < -GRACE_DAYS ? "missing" : daysUntil <= GRACE_DAYS ? "due-soon" : "upcoming";

    return {
      id: bill.id,
      name: bill.name,
      amount: bill.amount,
      dueDay: bill.dueDay,
      category: bill.category,
      match: bill.match,
      status,
      dueDate,
      daysUntil,
      paidAmount: paid?.amount,
      paidOn: paid?.paidOn,
      marked: paid?.marked ?? false,
      variance: paid ? r2(paid.amount - bill.amount) : undefined,
      history,
      average: seen.length > 0 ? r2(seen.reduce((a, b) => a + b, 0) / seen.length) : undefined,
    };
  });
}

/** What the tracked bills come to, this month. */
export function billTotals(items: readonly BillStatus[], income: number) {
  const committedMonthly = r2(items.reduce((total, bill) => total + bill.amount, 0));
  const paidThisMonth = r2(items.reduce((total, bill) => total + (bill.paidAmount ?? 0), 0));
  const remaining = r2(items.filter((bill) => bill.status !== "paid").reduce((total, bill) => total + bill.amount, 0));
  return { committedMonthly, paidThisMonth, remaining, incomeShare: income > 0 ? committedMonthly / income : undefined };
}

/**
 * The categories a fixed bill can be in. A restaurant or a petrol station can
 * recur monthly without being a bill, so recurrence alone is not enough: the
 * category has to be one where payments are commitments.
 */
const BILL_CATEGORIES: ReadonlySet<Category> = new Set<Category>(["Housing", "Utilities", "Insurance", "Debt", "Education", "Health", "Fees"]);

/**
 * Recurring payments Finance found that are not tracked yet. Subscriptions are
 * left out (they have their own tab, and `cancellable` is how to tell); what is
 * left is the fixed stuff: rent, insurance, utilities, loan repayments.
 */
export function suggestBills(
  recurring: readonly RecurringMerchant[],
  tracked: readonly Pick<StoredBill, "name" | "match">[],
  cancellable: (entry: { category: Category; merchant: string }) => boolean,
): BillSuggestion[] {
  const trackedKeys = tracked.flatMap((bill) => [merchantKey(bill.match?.trim() || bill.name)]).filter(Boolean);

  return recurring
    .filter((entry) => entry.frequency === "monthly" && BILL_CATEGORIES.has(entry.category) && !cancellable(entry))
    .filter((entry) => {
      const key = merchantKey(entry.merchant);
      return !trackedKeys.some((tracked) => key.includes(tracked) || tracked.includes(key));
    })
    .map((entry) => ({
      merchant: entry.merchant,
      amount: Math.round(entry.amounts[entry.amounts.length - 1]),
      dueDay: Number(entry.lastPaid.slice(8, 10)),
      category: entry.category,
    }))
    .sort((a, b) => b.amount - a.amount);
}
