import { formatRandAmount, type Debt, type FinancialAccount, type GoalProgress, type MonthSummary, type SavingsPlan } from "../../shared/finance-types";
import { paymentToClear } from "../../shared/finance-debt";
import { monthOf, type CategorisedTransaction } from "./engine";

/**
 * How much to save each month, and in what order.
 *
 * Not a single rule of thumb. It asks what your money needs to do, in an order
 * most people would defend, and hands your spare money down that list until it
 * runs out:
 *
 * 1. Expensive debt: cleared over twelve months, because a card charging 20%
 *    costs more than savings earn. It comes first, ahead of any buffer.
 * 2. A starter buffer: one month of spending, within three months.
 * 3. The full buffer: three months of spending (six if your income swings a
 *    lot), built over twelve months.
 * 4. Your dated goals, each at the monthly amount it needs.
 * 5. Long-term saving: whatever it takes to reach 20% of income, if anything
 *    is still unfunded.
 *
 * What there is to save is what you actually have left after spending, on
 * average. The plan can ask for more than that; when it does, the gap is
 * shown, and the steps at the bottom are the ones left unfunded. It never
 * pretends there is money that is not there. The horizons (three months,
 * twelve months) are assumptions, and the page says so.
 */

const r0 = (value: number) => Math.round(value);
const R = (value: number) => formatRandAmount(value);
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: readonly number[]) => (values.length === 0 ? 0 : sum(values) / values.length);

const HIGH_RATE = 0.12;

export function planSavings(input: {
  month: string;
  months: readonly MonthSummary[];
  accounts: readonly FinancialAccount[];
  goals: readonly GoalProgress[];
  debts: readonly Debt[];
  averageMonthlySpend: number | undefined;
  ledger: readonly CategorisedTransaction[];
}): SavingsPlan {
  const savingsAccounts = input.accounts.filter((a) => a.type === "savings" && a.balance > 0).map((a) => ({ name: a.name, balance: a.balance }));
  const savingsBalance = sum(savingsAccounts.map((a) => a.balance));
  const emergency = input.goals.find((goal) => goal.type === "emergency");
  const liquidSavings = Math.max(savingsBalance, emergency?.currentAmount ?? 0);

  const typeById = new Map(input.accounts.map((a) => [a.id, a.type]));
  const moved = sum(input.ledger.filter((t) => monthOf(t.date) === input.month && typeById.get(t.accountId) === "savings").map((t) => t.amount));

  const complete = input.months.filter((m) => m.month < input.month && (m.income > 0 || m.spent > 0)).slice(-3);
  const base = { liquidSavings: r0(liquidSavings), bufferTargetMonths: 3, movedToSavingsThisMonth: r0(Math.max(0, moved)), savingsAccounts };

  if (complete.length === 0 || input.averageMonthlySpend === undefined || input.averageMonthlySpend <= 0) {
    return { ready: false, income: 0, spending: 0, capacity: 0, idealRate: 0, steps: [], totalNeeded: 0, recommended: 0, gap: 0, ...base };
  }

  const incomes = complete.map((m) => m.income).filter((value) => value > 0);
  const income = mean(incomes);
  const spending = input.averageMonthlySpend;
  const capacity = Math.max(0, income - spending);

  // Income that swings needs a bigger buffer: the bad month is the one you are saving for.
  const spread = incomes.length >= 3 ? Math.sqrt(mean(incomes.map((v) => (v - income) ** 2))) / income : 0;
  const bufferTargetMonths = spread > 0.25 ? 6 : 3;

  const needs: { id: string; label: string; principle: string; needed: number; note: string }[] = [];

  const dear = input.debts.filter((debt) => debt.interestRate === undefined || debt.interestRate >= HIGH_RATE);
  const debtNeeded = sum(dear.map((debt) => paymentToClear(debt.owed, debt.interestRate ?? 0, 12)));
  if (input.debts.length > 0) {
    needs.push({
      id: "debt",
      label: "Clear expensive debt",
      principle: "Clear expensive debt first",
      needed: debtNeeded,
      note:
        dear.length === 0
          ? "None of your debt charges a high rate."
          : `Clear ${dear.length === 1 ? "it" : "them"} over twelve months.${dear.some((debt) => debt.interestRate === undefined) ? " At least one has no rate set, so this understates the cost." : ""}`,
    });
  }

  const starterShortfall = Math.max(0, spending - liquidSavings);
  needs.push({
    id: "starter",
    label: "Starter buffer",
    principle: "Emergency buffer",
    needed: starterShortfall / 3,
    note: starterShortfall > 0 ? `Reach one month of spending (${R(spending)}) in savings within three months. You have ${R(liquidSavings)}.` : "You already hold a month of spending in savings.",
  });

  const target = spending * bufferTargetMonths;
  const beyondStarter = Math.max(0, target - Math.max(liquidSavings, spending));
  needs.push({
    id: "buffer",
    label: `Full buffer (${bufferTargetMonths} months)`,
    principle: "Emergency buffer",
    needed: beyondStarter / 12,
    note: bufferTargetMonths === 6 ? "Six months, because your income varies from month to month. Built over twelve months." : "Three months of spending, built over twelve months.",
  });

  // An emergency goal is the buffer already, so it is not counted twice.
  for (const goal of input.goals.filter((g) => g.type !== "emergency" && g.requiredMonthly !== undefined && g.status !== "done")) {
    needs.push({ id: `goal:${goal.id}`, label: goal.name, principle: "Give every rand a job", needed: goal.requiredMonthly ?? 0, note: goal.targetDate ? `Needs this each month to arrive by ${goal.targetDate}.` : "Needs this each month." });
  }

  const idealRate = income * 0.2;
  const before = sum(needs.map((n) => n.needed));
  needs.push({
    id: "long-term",
    label: "Long-term saving",
    principle: "Pay yourself first",
    needed: Math.max(0, idealRate - before),
    note: `Tops the total up to 20% of income (${R(idealRate)}), a common aim, if the steps above come to less.`,
  });

  let remaining = capacity;
  const steps = needs.map((step) => {
    const funded = Math.min(step.needed, remaining);
    remaining -= funded;
    return { ...step, needed: r0(step.needed), funded: r0(funded) };
  });

  const totalNeeded = sum(steps.map((step) => step.needed));
  return {
    ready: true,
    income: r0(income),
    spending: r0(spending),
    capacity: r0(capacity),
    idealRate: r0(idealRate),
    steps,
    totalNeeded,
    recommended: r0(Math.min(totalNeeded, capacity)),
    gap: r0(Math.max(0, totalNeeded - capacity)),
    ...base,
    bufferTargetMonths,
    bufferMonths: spending > 0 ? liquidSavings / spending : undefined,
  };
}
