import type { Shared } from "../../shared/finance-types";
import { wholeWord } from "./categorise";
import { addMonths, monthOf, type CategorisedTransaction } from "./engine";
import type { StoredPartner, StoredSettlement, StoredSplitRule } from "./store";

/**
 * Costs shared with a partner, and what she owes you.
 *
 * You pay for rent and groceries in full; she sends her half. This works out,
 * for each month since you started counting, what you paid on the shared costs,
 * her part of that, what she has actually sent, and the balance.
 *
 * Her payments are the ones in the `Reimbursement` category (found by her name
 * on your statement, or set by hand), plus anything you record as settled
 * another way. Neither is treated as income.
 *
 * Costs are not counted twice: a payment that matches two rules (rent is both
 * a "rent" payment and in Housing) belongs to the first rule that claims it.
 */

const r2 = (value: number) => Math.round(value * 100) / 100;
/** How far back a running balance reaches, so an old start date cannot make a page of twelve years. */
const MAX_MONTHS = 12;

function ruleMatches(rule: StoredSplitRule, transaction: CategorisedTransaction): boolean {
  if (transaction.amount >= 0) return false;
  if (rule.kind === "category") return transaction.category === rule.value;
  const pattern = wholeWord(rule.value);
  return pattern.test(transaction.description) || pattern.test(transaction.merchant);
}

export function buildShared(input: {
  partner: StoredPartner | undefined;
  rules: readonly StoredSplitRule[];
  settlements: readonly StoredSettlement[];
  ledger: readonly CategorisedTransaction[];
  today: string;
}): Shared {
  const rules = input.rules.map((rule) => ({ id: rule.id, label: rule.label, kind: rule.kind, value: rule.value, share: rule.share }));
  const settlements = input.settlements.map((entry) => ({ id: entry.id, month: entry.month, amount: entry.amount, note: entry.note }));

  if (!input.partner) return { rules, months: [], owedBack: 0, payments: [], settlements };

  const current = monthOf(input.today);
  const floor = addMonths(current, -(MAX_MONTHS - 1));
  const start = input.partner.sinceMonth > floor ? input.partner.sinceMonth : floor;

  const months: Shared["months"] = [];
  for (let month = start; month <= current; month = addMonths(month, 1)) {
    const inMonth = input.ledger.filter((t) => monthOf(t.date) === month);
    const claimed = new Set<string>();

    const rows = input.rules.map((rule) => {
      const matched = inMonth.filter((t) => !claimed.has(t.id) && ruleMatches(rule, t));
      matched.forEach((t) => claimed.add(t.id));
      const paid = -matched.reduce((total, t) => total + t.amount, 0);
      return { ruleId: rule.id, label: rule.label, paid: r2(paid), herShare: r2(paid * rule.share) };
    });

    const herShare = r2(rows.reduce((total, row) => total + row.herShare, 0));
    const received = r2(
      inMonth.filter((t) => t.amount > 0 && t.category === "Reimbursement").reduce((total, t) => total + t.amount, 0) +
        input.settlements.filter((entry) => entry.month === month).reduce((total, entry) => total + entry.amount, 0),
    );
    months.push({ month, rows, herShare, received, balance: r2(herShare - received) });
  }

  const payments = input.ledger
    .filter((t) => t.amount > 0 && t.category === "Reimbursement" && monthOf(t.date) >= start)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((t) => ({ date: t.date, description: t.description, amount: t.amount }));

  return { partner: input.partner, rules, months, owedBack: r2(months.reduce((total, entry) => total + entry.balance, 0)), payments, settlements };
}
