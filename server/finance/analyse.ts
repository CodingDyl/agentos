import type { Debt, Finding, FinancialAccount, GoalProgress, MonthSummary, Subscription, Transaction } from "../../shared/finance-types";
import { formatRandAmount } from "../../shared/finance-types";
import { monthsToClear, monthlyInterest, payoffOptions } from "../../shared/finance-debt";

/**
 * The analyser's checks: well-known money principles, applied to your numbers.
 *
 * Every finding is arithmetic plus a named idea, with the evidence written out
 * so you can see how it got there. Nothing here calls a model. Hermes is asked
 * afterwards to put the findings in order and explain them, and is given these
 * findings rather than trusted to find its own.
 *
 * The principles are deliberately ordinary, and none is a rule for everyone:
 *
 * - Pay yourself first: save a share of income before spending the rest.
 * - Emergency buffer: three to six months of spending in cash, more when income
 *   is uneven.
 * - Expensive debt first: a balance charging 20% a year costs more than most
 *   savings earn, so it comes before adding to investments.
 * - 50/30/20: a rough guide to how income divides between needs, wants and saving.
 * - Lifestyle creep: spending that rises as fast as income leaves nothing extra.
 * - Idle cash: money in a current account above a month or two of spending is
 *   doing nothing.
 *
 * What it will not do is name a product or say what to buy, sell or cancel. It
 * says what deserves attention, and why.
 */

const R = (value: number) => formatRandAmount(value);
const pct = (value: number) => `${Math.round(value * 100)}%`;
const mean = (values: readonly number[]) => (values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length);

/** Each card or loan, with what it costs and what clearing it would take. */
export function buildDebts(
  accounts: readonly FinancialAccount[],
  freeCashFlow: number | undefined,
  ledger: readonly Pick<Transaction, "accountId" | "date" | "amount">[] = [],
  month = "",
): Debt[] {
  return accounts
    .filter((account) => account.type === "credit" && account.balance < 0)
    .map((account): Debt => {
      const owed = -account.balance;
      const rate = account.interestRate;
      return {
        accountId: account.id,
        name: account.name,
        owed,
        interestRate: rate,
        creditLimit: account.creditLimit,
        utilisation: account.creditLimit && account.creditLimit > 0 ? owed / account.creditLimit : undefined,
        monthlyInterest: rate === undefined ? undefined : Math.round(monthlyInterest(owed, rate)),
        monthsAtFreeCashFlow: freeCashFlow !== undefined && freeCashFlow > 0 ? monthsToClear(owed, rate ?? 0, freeCashFlow) : undefined,
        // Only the card's own statement can say what was paid into it, so a card with none is "not known".
        paidThisMonth: Math.round(ledger.filter((t) => t.accountId === account.id && t.amount > 0 && t.date.startsWith(month)).reduce((total, t) => total + t.amount, 0)),
        hasStatement: ledger.some((t) => t.accountId === account.id),
        options: payoffOptions(owed, rate ?? 0),
      };
    })
    .sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0) || b.owed - a.owed);
}

export interface AnalyseInput {
  accounts: readonly FinancialAccount[];
  summary: MonthSummary;
  months: readonly MonthSummary[];
  split: { income: number; needs: number; wants: number; business: number; unsorted: number; saved: number };
  categories: readonly { category: string; amount: number }[];
  subscriptions: readonly Subscription[];
  subscriptionMonthly: number;
  goals: readonly GoalProgress[];
  debts: readonly Debt[];
  bills: { committedMonthly: number; incomeShare?: number; count: number };
  /** What a partner owes you for shared costs, and her name as you entered it. */
  owedBack: number;
  partnerName?: string;
  averageMonthlySpend: number | undefined;
  freeCashFlow: number | undefined;
  /** `YYYY-MM`. */
  month: string;
}

type Status = Finding["status"];
const RANK: Record<Status, number> = { act: 0, watch: 1, good: 2 };

export function analyse(input: AnalyseInput): { findings: Finding[]; focus: string[] } {
  const findings: Finding[] = [];
  const { summary, split } = input;

  const complete = input.months.filter((entry) => entry.month < input.month && (entry.income > 0 || entry.spent > 0));
  const hasData = summary.income > 0 || summary.spent > 0 || complete.length > 0;
  if (!hasData) return { findings: [], focus: [] };

  const avgSpend = input.averageMonthlySpend;
  const liquid = input.accounts.filter((a) => (a.type === "current" || a.type === "savings") && a.balance > 0).reduce((total, a) => total + a.balance, 0);
  const current = input.accounts.filter((a) => a.type === "current" && a.balance > 0).reduce((total, a) => total + a.balance, 0);
  const owed = input.debts.reduce((total, debt) => total + debt.owed, 0);

  // ---- Pay yourself first
  if (summary.savingsRate !== undefined) {
    const rate = summary.savingsRate;
    const status: Status = rate >= 0.2 ? "good" : rate >= 0.1 ? "watch" : "act";
    findings.push({
      id: "savings-rate",
      principle: "Pay yourself first",
      title: "Savings rate",
      status,
      summary: rate >= 0 ? `You kept ${pct(rate)} of this month's income.` : `You spent ${R(-summary.saved)} more than came in this month.`,
      evidence: [`Income ${R(summary.income)}, spent ${R(summary.spent)}, kept ${R(summary.saved)}.`, "A common aim is to keep at least 20%."],
      action: status === "good" ? undefined : "Move a fixed amount to savings on payday, before spending, so saving is not what is left over.",
    });
  }

  // ---- Emergency buffer
  if (avgSpend !== undefined && avgSpend > 0) {
    const months = liquid / avgSpend;
    const incomes = complete.slice(-4).map((entry) => entry.income).filter((value) => value > 0);
    const spread = incomes.length >= 3 ? Math.sqrt((mean(incomes.map((v) => (v - (mean(incomes) ?? 0)) ** 2)) ?? 0)) / (mean(incomes) ?? 1) : 0;
    const uneven = spread > 0.25;
    const target = uneven ? 6 : 3;
    const status: Status = months >= (uneven ? 6 : 3) ? "good" : months >= 1.5 ? "watch" : "act";
    findings.push({
      id: "buffer",
      principle: "Emergency buffer",
      title: "Emergency buffer",
      status,
      summary: `Your current and savings accounts cover ${months.toFixed(1)} months of spending.`,
      evidence: [`${R(liquid)} in cash against about ${R(avgSpend)} spent a month.`, uneven ? "Your income varies month to month, so aim for six months, not three." : "Three to six months is the usual aim."],
      action: status === "good" ? undefined : `Build towards ${target} months (${R(avgSpend * target)}). A separate account you do not spend from helps.`,
    });
  }

  // ---- Expensive debt first
  if (input.debts.length > 0) {
    const debtRows = input.debts.map((debt) => {
      const bits = [`${debt.name}: ${R(debt.owed)} owed`];
      if (debt.interestRate !== undefined) bits.push(`${(debt.interestRate * 100).toFixed(1).replace(/\.0$/, "")}% a year, about ${R(debt.monthlyInterest ?? 0)} interest a month`);
      if (debt.utilisation !== undefined) bits.push(`${pct(debt.utilisation)} of the limit used`);
      return bits.join(", ");
    });
    const rateKnown = input.debts.every((debt) => debt.interestRate !== undefined);
    const dear = input.debts.some((debt) => (debt.interestRate ?? 0) >= 0.12 || (debt.utilisation ?? 0) >= 0.75);
    const twelve = input.debts.length === 1 ? input.debts[0].options.find((option) => option.months === 12) : undefined;
    const incomeYear = (mean(complete.slice(-3).map((entry) => entry.income)) ?? summary.income) * 12;

    findings.push({
      id: "debt",
      principle: "Clear expensive debt first",
      title: "Debt",
      status: dear ? "act" : "watch",
      summary: `You owe ${R(owed)} across ${input.debts.length} ${input.debts.length === 1 ? "account" : "accounts"}${rateKnown ? "" : ", and at least one has no interest rate set, so its cost is understated"}.`,
      evidence: [
        ...debtRows,
        ...(incomeYear > 0 ? [`That is ${pct(owed / incomeYear)} of a year's income.`] : []),
        ...(twelve ? [`Clearing it in 12 months would take ${R(twelve.monthly)} a month and cost about ${R(twelve.interest)} in interest.`] : []),
      ],
      action: rateKnown
        ? "Pay the highest-rate balance down first while covering the minimum on the rest (the avalanche method). Debt at a high rate usually costs more than savings or investments earn."
        : "Add each account's interest rate so the real cost shows, then decide the order to pay them.",
    });
  }

  // ---- Fixed costs
  if (input.bills.count > 0 && input.bills.incomeShare !== undefined) {
    const share = input.bills.incomeShare;
    findings.push({
      id: "fixed-costs",
      principle: "Keep fixed costs low",
      title: "Fixed monthly bills",
      status: share <= 0.4 ? "good" : share <= 0.55 ? "watch" : "act",
      summary: `Your ${input.bills.count} tracked bills come to ${R(input.bills.committedMonthly)} a month, ${pct(share)} of income.`,
      evidence: ["Bills are the hardest costs to cut in a bad month, so the lower their share, the more room you have. Under 40% is comfortable."],
      action: share <= 0.4 ? undefined : "Look at the biggest bill first. Renegotiating or replacing one large fixed cost usually saves more than trimming many small ones.",
    });
  }

  // ---- Money owed back
  if (input.owedBack >= 500) {
    findings.push({
      id: "owed-back",
      principle: "Count only the money you have",
      title: "Owed back to you",
      status: "watch",
      summary: `${input.partnerName ?? "Your partner"} owes you ${R(input.owedBack)} for shared costs.`,
      evidence: ["Money you are owed is not savings yet: it is not counted in your savings rate or your buffer until it arrives."],
      action: "Ask for it, or agree a regular date each month, so your own cash is not carrying her share.",
    });
  }

  // ---- 50/30/20
  if (split.income > 0) {
    const needs = split.needs / split.income;
    const wants = split.wants / split.income;
    findings.push({
      id: "needs",
      principle: "50/30/20",
      title: "Needs",
      status: needs <= 0.5 ? "good" : needs <= 0.65 ? "watch" : "act",
      summary: `Needs took ${pct(needs)} of your income. The rule of thumb is about 50%.`,
      evidence: [`${R(split.needs)} on housing, utilities, groceries, transport, debt, health, insurance and similar.`],
      action: needs <= 0.5 ? undefined : "Look for the largest need first: housing, debt repayments and transport are usually where a large share sits.",
    });
    findings.push({
      id: "wants",
      principle: "50/30/20",
      title: "Wants",
      status: wants <= 0.3 ? "good" : wants <= 0.4 ? "watch" : "act",
      summary: `Wants took ${pct(wants)} of your income. The rule of thumb is about 30%.`,
      evidence: [`${R(split.wants)} on dining, subscriptions, entertainment, shopping, travel and similar.`],
      action: wants <= 0.3 ? undefined : "The biggest wants category is the place to trim first, because it is the easiest to change.",
    });
  }

  // ---- Subscription creep
  if (input.subscriptions.length > 0 && split.income > 0) {
    const share = input.subscriptionMonthly / split.income;
    const status: Status = share <= 0.04 ? "good" : share <= 0.08 ? "watch" : "act";
    findings.push({
      id: "subscriptions",
      principle: "Subscription creep",
      title: "Subscriptions",
      status,
      summary: `${input.subscriptions.length} recurring services cost ${R(input.subscriptionMonthly)} a month, ${pct(share)} of income.`,
      evidence: [`${R(input.subscriptionMonthly * 12)} a year.`],
      action: status === "good" ? undefined : "Rank them on the Subscriptions tab and cancel anything you would not sign up for again today.",
    });
  }

  // ---- Lifestyle creep
  if (complete.length >= 4) {
    const recent = complete.slice(-2);
    const before = complete.slice(-4, -2);
    const spendNow = mean(recent.map((entry) => entry.spent)) ?? 0;
    const spendThen = mean(before.map((entry) => entry.spent)) ?? 0;
    const incomeNow = mean(recent.map((entry) => entry.income)) ?? 0;
    const incomeThen = mean(before.map((entry) => entry.income)) ?? 0;
    if (spendThen > 0 && incomeThen > 0) {
      const spendGrowth = spendNow / spendThen - 1;
      const incomeGrowth = incomeNow / incomeThen - 1;
      const creeping = spendGrowth >= 0.1 && spendGrowth > incomeGrowth + 0.05;
      findings.push({
        id: "lifestyle",
        principle: "Lifestyle creep",
        title: "Spending against income",
        status: creeping ? "watch" : "good",
        summary: creeping ? `Spending rose ${pct(spendGrowth)} in two months while income moved ${pct(incomeGrowth)}.` : "Spending has not outrun income recently.",
        evidence: [`Average spend ${R(spendThen)} then, ${R(spendNow)} now. Average income ${R(incomeThen)} then, ${R(incomeNow)} now.`],
        action: creeping ? "When income rises, decide in advance how much of the rise goes to saving, before it disappears into everyday spending." : undefined,
      });
    }
  }

  // ---- Idle cash
  if (avgSpend !== undefined && avgSpend > 0 && current > avgSpend * 2) {
    const excess = current - avgSpend * 1.5;
    findings.push({
      id: "idle-cash",
      principle: "Idle cash",
      title: "Cash sitting in your current account",
      status: "watch",
      summary: `${R(current)} sits in current accounts, more than two months of spending.`,
      evidence: [`About ${R(excess)} is above a month and a half of spending.`],
      action: owed > 0 ? "With a balance owing, the excess is better used to reduce it than left idle." : "Move the excess to a savings account or towards a goal so it earns something.",
    });
  }

  // ---- Goals
  const behind = input.goals.filter((goal) => goal.status === "behind" || goal.status === "overdue");
  if (input.goals.length > 0) {
    findings.push({
      id: "goals",
      principle: "Give every rand a job",
      title: "Goals",
      status: behind.length > 0 ? "watch" : "good",
      summary: behind.length > 0 ? `${behind.length} of ${input.goals.length} goals ${behind.length === 1 ? "is" : "are"} behind plan.` : `All ${input.goals.length} goals are on plan or done.`,
      evidence: behind.map((goal) => `${goal.name}: short by ${R(goal.shortfall ?? goal.remaining)}, needs ${R(goal.extraMonthlyNeeded ?? 0)} a month more.`),
      action: behind.length > 0 ? "Use Find opportunities on the Goals tab, or move the date, to close the gap." : undefined,
    });
  } else {
    findings.push({
      id: "goals",
      principle: "Give every rand a job",
      title: "Goals",
      status: "watch",
      summary: "You have no savings goals set.",
      evidence: [],
      action: "A goal with a date turns 'save more' into a monthly amount. Add one on the Goals tab.",
    });
  }

  // ---- Sinking funds
  const yearly = input.subscriptions.filter((s) => s.frequency === "annual");
  if (yearly.length > 0 && !input.goals.some((goal) => goal.kind === "sinking")) {
    findings.push({
      id: "sinking",
      principle: "Sinking funds",
      title: "Yearly payments",
      status: "watch",
      summary: `${yearly.length} yearly ${yearly.length === 1 ? "payment" : "payments"} (${R(yearly.reduce((t, s) => t + s.annual, 0))} in all) arrive as one-off hits.`,
      evidence: yearly.map((s) => `${s.merchant}: ${R(s.annual)} a year, ${R(s.monthly)} a month to set aside.`),
      action: "Set aside a twelfth each month in a sinking fund so the bill is already paid for.",
    });
  }

  // ---- Visibility
  const unsorted = split.unsorted;
  const spendTotal = split.needs + split.wants + split.business + split.unsorted;
  if (spendTotal > 0) {
    const share = unsorted / spendTotal;
    findings.push({
      id: "visibility",
      principle: "You cannot manage what you cannot see",
      title: "Uncategorised spending",
      status: share <= 0.05 ? "good" : share <= 0.15 ? "watch" : "act",
      summary: share <= 0.05 ? "Almost everything is categorised." : `${pct(share)} of this month's spending has no category.`,
      evidence: [`${R(unsorted)} of ${R(spendTotal)}.`],
      action: share <= 0.05 ? undefined : "Correct the largest uncategorised merchants on the Spending tab; each correction is remembered.",
    });
  }

  const focus = findings
    .filter((finding) => finding.status !== "good")
    .sort((a, b) => RANK[a.status] - RANK[b.status])
    .slice(0, 3)
    .map((finding) => finding.id);

  return { findings, focus };
}
