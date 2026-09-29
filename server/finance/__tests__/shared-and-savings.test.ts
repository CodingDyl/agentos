import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { FinancialAccount, GoalProgress, Transaction } from "../../../shared/finance-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-shared-"));
process.env.AGENTOS_UI_DIR = directory;
delete process.env.INVESTEC_CLIENT_ID;
delete process.env.INVESTEC_SECRET;
delete process.env.INVESTEC_API_KEY;

const { closeFinanceDatabase } = await import("../db");
const store = await import("../store");
const { getFinance } = await import("../finance");
const { computeFinance, categorise } = await import("../engine");
const { buildShared } = await import("../shared-costs");
const { planSavings } = await import("../savings");
const { cleanMerchant } = await import("../categorise");

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

const TODAY = "2026-09-29";
let n = 0;
const tx = (date: string, description: string, amount: number, accountId = "cur"): Transaction => ({ id: `s${(n += 1)}`, accountId, date, description, amount, merchant: cleanMerchant(description) });

const partner = { name: "Sam", match: "sam jones", sinceMonth: "2026-09" };
const rules = [
  { id: "r1", label: "Rent", kind: "merchant" as const, value: "rent", share: 0.5 },
  { id: "r2", label: "Groceries", kind: "category" as const, value: "Groceries", share: 0.5 },
];

/** You pay rent 14,000, groceries 6,000 and wifi 900. She has sent 6,000. */
const month = [
  tx("2026-09-01", "SALARY ACME", 40_000),
  tx("2026-09-02", "RENT CAPE TOWN", -14_000),
  tx("2026-09-05", "WOOLWORTHS 0329", -4_000),
  tx("2026-09-12", "CHECKERS 4451", -2_000),
  tx("2026-09-14", "AFRIHOST FIBRE", -900),
  tx("2026-09-20", "PAYMENT SAM JONES", 6_000),
];

describe("her payments are not your income", () => {
  const categorised = categorise(month, new Map(), "sam jones");

  it("files them as a reimbursement, and leaves everything else alone", () => {
    assert.equal(categorised.find((t) => t.amount === 6_000)?.category, "Reimbursement");
    assert.equal(categorised.find((t) => t.description.startsWith("SALARY"))?.category, "Income");
  });

  it("lowers what you spent and does not raise what you earned", () => {
    const withPartner = computeFinance({ accounts: [], transactions: month, corrections: new Map(), decisions: new Map(), assessments: new Map(), goals: [], partner, splitRules: rules, today: TODAY });
    const without = computeFinance({ accounts: [], transactions: month, corrections: new Map(), decisions: new Map(), assessments: new Map(), goals: [], today: TODAY });

    assert.equal(withPartner.summary.income, 40_000);
    assert.equal(withPartner.summary.spent, 20_900 - 6_000);
    // Without telling Finance who she is, her money would look like income.
    assert.equal(without.summary.income, 46_000);
    assert.equal(withPartner.split.reimbursed, 6_000);
  });

  it("only matches her name as a whole word", () => {
    const rows = categorise([tx("2026-09-20", "SAM JONESTOWN CAFE REFUND", 100)], new Map(), "sam jones");
    assert.equal(rows[0].category, "Income");
  });
});

describe("what she owes you", () => {
  const ledger = categorise(month, new Map(), partner.match);
  const shared = buildShared({ partner, rules, settlements: [], ledger, today: TODAY });

  it("takes her half of rent and groceries, and none of the wifi", () => {
    const [current] = shared.months;
    assert.deepEqual(current.rows.map((r) => [r.label, r.paid, r.herShare]), [["Rent", 14_000, 7_000], ["Groceries", 6_000, 3_000]]);
    assert.equal(current.herShare, 10_000);
  });

  it("subtracts what she has sent, and the balance is what you are still owed", () => {
    assert.equal(shared.months[0].received, 6_000);
    assert.equal(shared.owedBack, 4_000);
    assert.equal(shared.payments[0].amount, 6_000);
  });

  it("counts a payment you record by hand, and goes negative if she paid ahead", () => {
    const settled = buildShared({ partner, rules, settlements: [{ id: "x", month: "2026-09", amount: 4_000 }], ledger, today: TODAY });
    assert.equal(settled.owedBack, 0);
    const ahead = buildShared({ partner, rules, settlements: [{ id: "x", month: "2026-09", amount: 5_000 }], ledger, today: TODAY });
    assert.equal(ahead.owedBack, -1_000);
  });

  it("does not count one payment under two rules", () => {
    const both = [...rules, { id: "r3", label: "Housing", kind: "category" as const, value: "Housing", share: 0.5 }];
    const result = buildShared({ partner, rules: both, settlements: [], ledger, today: TODAY });
    assert.equal(result.months[0].herShare, 10_000);
  });

  it("carries a balance across months, and ignores months before you started counting", () => {
    const earlier = [tx("2026-07-02", "RENT CAPE TOWN", -14_000), tx("2026-08-02", "RENT CAPE TOWN", -14_000), ...month];
    const result = buildShared({ partner: { ...partner, sinceMonth: "2026-08" }, rules, settlements: [], ledger: categorise(earlier, new Map(), partner.match), today: TODAY });
    assert.deepEqual(result.months.map((m) => m.month), ["2026-08", "2026-09"]);
    assert.equal(result.owedBack, 7_000 + 4_000);
  });

  it("has nothing to say without a partner", () => {
    const result = buildShared({ partner: undefined, rules, settlements: [], ledger, today: TODAY });
    assert.equal(result.owedBack, 0);
    assert.deepEqual(result.months, []);
  });
});

describe("shared costs end to end", () => {
  it("stores a partner and rules, and raises the owed-back attention", () => {
    store.savePartner(partner);
    store.createSplitRule(rules[0]);
    store.createSplitRule(rules[1]);
    const data = getFinance();
    assert.equal(data.shared.partner?.name, "Sam");
    assert.equal(data.shared.rules.length, 2);
    store.removePartner();
    assert.equal(getFinance().shared.partner, undefined);
    assert.equal(getFinance().shared.rules.length, 0);
  });

  it("rejects a category rule that is not a category", () => {
    assert.throws(() => store.createSplitRule({ label: "x", kind: "category", value: "Nonsense", share: 0.5 }), store.FinanceConflictError);
  });
});

describe("the savings plan", () => {
  const accounts = (savings: number): FinancialAccount[] => [
    { id: "cur", provider: "manual", name: "Current", type: "current", currency: "ZAR", balance: 5_000 },
    { id: "sav", provider: "manual", name: "Savings", type: "savings", currency: "ZAR", balance: savings },
  ];
  const months = ["2026-06", "2026-07", "2026-08", "2026-09"].map((m) => ({ month: m, income: 40_000, spent: 30_000, saved: 10_000, savingsRate: 0.25 }));
  const goal = (over: Partial<GoalProgress>): GoalProgress => ({ id: "g", name: "UK Trip", targetAmount: 30_000, currentAmount: 0, type: "travel", kind: "goal", remaining: 30_000, progress: 0, status: "behind", requiredMonthly: 2_500, ...over }) as GoalProgress;
  const plan = (over: Partial<Parameters<typeof planSavings>[0]> = {}) =>
    planSavings({ month: "2026-09", months, accounts: accounts(0), goals: [], debts: [], averageMonthlySpend: 30_000, ledger: [], ...over });

  it("says it is not ready without a complete month to go on", () => {
    assert.equal(plan({ months: [{ month: "2026-09", income: 1, spent: 1, saved: 0 }], averageMonthlySpend: undefined }).ready, false);
  });

  it("works out what there is to save and, with no debt, funds the buffer first", () => {
    const result = plan();
    assert.equal(result.capacity, 10_000);
    assert.equal(result.steps[0].id, "starter");
    assert.equal(result.steps[0].needed, 10_000);
    assert.equal(result.steps[0].funded, 10_000);
    assert.equal(result.recommended, 10_000);
  });

  it("asks for more than you have, and says by how much, rather than pretending", () => {
    const result = plan({ debts: [{ accountId: "c", name: "Card", owed: 31_400, interestRate: 0.22, paidThisMonth: 0, hasStatement: false, options: [] }], goals: [goal({})] });
    assert.ok(result.totalNeeded > result.capacity);
    assert.equal(result.gap, result.totalNeeded - result.capacity);
    assert.equal(result.recommended, result.capacity);
    const unfunded = result.steps.filter((s) => s.funded < s.needed);
    assert.ok(unfunded.length > 0);
    // Whatever runs out, it runs out at the bottom of the list, not the top.
    assert.equal(result.steps[0].funded, result.steps[0].needed);
    assert.equal(result.steps[0].id, "debt");
  });

  it("puts expensive debt ahead of the starter buffer, so the buffer only gets what debt leaves", () => {
    const result = plan({ debts: [{ accountId: "c", name: "Card", owed: 20_000, interestRate: 0.22, paidThisMonth: 0, hasStatement: false, options: [] }] });
    assert.deepEqual(result.steps.slice(0, 2).map((s) => s.id), ["debt", "starter"]);
    const debt = result.steps[0];
    assert.equal(debt.funded, Math.min(debt.needed, result.capacity));
    assert.equal(result.steps[1].funded, Math.min(result.steps[1].needed, result.capacity - debt.funded));
  });

  it("does not count an emergency goal on top of the buffer, or a cheap loan as expensive", () => {
    const result = plan({
      accounts: accounts(90_000),
      goals: [goal({ id: "e", type: "emergency", name: "Emergency", requiredMonthly: 3_000 })],
      debts: [{ accountId: "c", name: "Card", owed: 20_000, interestRate: 0.08, paidThisMonth: 0, hasStatement: false, options: [] }],
    });
    assert.equal(result.steps.some((s) => s.id === "goal:e"), false);
    assert.equal(result.steps.find((s) => s.id === "debt")?.needed, 0);
  });

  it("asks for six months of buffer when income swings", () => {
    const uneven = ["2026-06", "2026-07", "2026-08"].map((m, i) => ({ month: m, income: [20_000, 60_000, 25_000][i], spent: 30_000, saved: 0 }));
    const result = plan({ months: [...uneven, { month: "2026-09", income: 1, spent: 1, saved: 0 }] });
    assert.equal(result.bufferTargetMonths, 6);
  });

  it("tops up to 20% of income only when the other steps come to less", () => {
    const result = plan({ accounts: accounts(200_000) });
    assert.equal(result.steps.find((s) => s.id === "long-term")?.needed, 8_000);
  });

  it("counts what moved into a savings account this month", () => {
    const result = plan({ ledger: categorise([tx("2026-09-03", "TRANSFER IN", 3_000, "sav"), tx("2026-09-04", "TRANSFER OUT", -3_000, "cur")], new Map()) });
    assert.equal(result.movedToSavingsThisMonth, 3_000);
  });
});
