import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinancialGoal, Transaction } from "../../../shared/finance-types";
import { cleanMerchant, merchantKey } from "../categorise";
import { addMonths, categorise, computeFinance, detectRecurring, goalProgress, summariseMonth } from "../engine";
import { sampleAccounts, sampleGoals, sampleTransactions } from "../sample";

const TODAY = "2026-09-29";

let counter = 0;
const tx = (date: string, description: string, amount: number): Transaction => ({
  id: `t${(counter += 1)}`,
  accountId: "a",
  date,
  description,
  amount,
  merchant: cleanMerchant(description),
});

const none = { corrections: new Map(), decisions: new Map(), assessments: new Map(), goals: [] as never[] };

describe("merchants", () => {
  it("reduces a bank description to a merchant", () => {
    assert.equal(cleanMerchant("WOOLWORTHS 00329 CAPE TOWN ZA"), "Woolworths");
    assert.equal(merchantKey(cleanMerchant("TAKEALOT.COM")), merchantKey("Takealot"));
    assert.equal(merchantKey("Woolworths"), merchantKey("WOOLWORTHS 00329"));
  });
});

describe("monthly summary", () => {
  it("counts income, spending and saving without counting transfers", () => {
    const ledger = categorise(
      [
        tx("2026-09-01", "SALARY ACME", 42_000),
        tx("2026-09-02", "RENT CAPE TOWN", -9_500),
        tx("2026-09-03", "WOOLWORTHS 00329", -1_500),
        tx("2026-09-04", "TRANSFER TO SAVINGS POCKET", -5_500),
        tx("2026-09-05", "EASYEQUITIES CONTRIBUTION", -3_000),
      ],
      new Map(),
    );
    const summary = summariseMonth(ledger, "2026-09");
    assert.equal(summary.income, 42_000);
    assert.equal(summary.spent, 11_000);
    assert.equal(summary.saved, 31_000);
    assert.ok(Math.abs((summary.savingsRate ?? 0) - 31_000 / 42_000) < 1e-9);
  });

  it("has no savings rate when nothing came in", () => {
    const summary = summariseMonth(categorise([tx("2026-09-03", "WOOLWORTHS", -100)], new Map()), "2026-09");
    assert.equal(summary.savingsRate, undefined);
  });

  it("lets a correction beat a rule", () => {
    const ledger = categorise([tx("2026-09-03", "WOOLWORTHS 00329", -900)], new Map([[merchantKey("Woolworths"), "Shopping" as const]]));
    assert.equal(ledger[0].category, "Shopping");
    assert.equal(ledger[0].categorySource, "you");
  });
});

describe("recurring detection", () => {
  it("finds a monthly charge and the price change", () => {
    const ledger = categorise(
      [tx("2026-06-05", "NETFLIX.COM", -199), tx("2026-07-05", "NETFLIX.COM", -199), tx("2026-08-05", "NETFLIX.COM", -229), tx("2026-09-05", "NETFLIX.COM", -229)],
      new Map(),
    );
    const found = detectRecurring(ledger, TODAY);
    assert.equal(found.length, 1);
    assert.equal(found[0].frequency, "monthly");
  });

  it("does not treat a supermarket as a subscription", () => {
    const ledger = categorise(
      [tx("2026-08-03", "CHECKERS 1", -500), tx("2026-08-10", "CHECKERS 2", -600), tx("2026-09-03", "CHECKERS 3", -700), tx("2026-09-10", "CHECKERS 4", -400)],
      new Map(),
    );
    assert.equal(detectRecurring(ledger, TODAY).length, 0);
  });

  it("never calls a single payment recurring", () => {
    assert.equal(detectRecurring(categorise([tx("2026-09-05", "NETFLIX.COM", -229)], new Map()), TODAY).length, 0);
  });

  it("drops a subscription that stopped billing", () => {
    const ledger = categorise([tx("2026-03-05", "NETFLIX.COM", -199), tx("2026-04-05", "NETFLIX.COM", -199)], new Map());
    assert.equal(detectRecurring(ledger, TODAY).length, 0);
  });
});

describe("goals", () => {
  const goal = (over: Partial<FinancialGoal> = {}) => ({ id: "g", name: "UK Trip", targetAmount: 35_000, currentAmount: 18_500, targetDate: "2027-03-29", type: "travel" as const, kind: "goal" as const, ...over });

  it("computes the required monthly contribution and the shortfall", () => {
    const [progress] = goalProgress([goal()], 2_000, TODAY);
    assert.equal(progress.remaining, 16_500);
    // Six months out: 16,500 / ~6 months.
    assert.ok((progress.requiredMonthly ?? 0) > 2_700 && (progress.requiredMonthly ?? 0) < 2_900);
    assert.equal(progress.status, "behind");
    assert.ok((progress.shortfall ?? 0) > 0);
    assert.ok((progress.extraMonthlyNeeded ?? 0) > 0);
  });

  it("is on track when free cash flow covers it", () => {
    const [progress] = goalProgress([goal()], 13_000, TODAY);
    assert.equal(progress.status, "on-track");
    assert.equal(progress.shortfall, 0);
  });

  it("does not invent a projection with no free cash flow", () => {
    const [progress] = goalProgress([goal()], undefined, TODAY);
    assert.equal(progress.paceMonthly, undefined);
    assert.equal(progress.projected, 18_500);
  });

  it("handles no date, done and overdue", () => {
    const results = goalProgress([goal({ targetDate: undefined }), goal({ currentAmount: 35_000 }), goal({ targetDate: "2026-01-01" })], 1_000, TODAY);
    assert.deepEqual(
      results.map((entry) => entry.status),
      ["no-date", "done", "overdue"],
    );
  });
});

describe("computeFinance on the sample ledger", () => {
  const output = computeFinance({ ...none, accounts: sampleAccounts(), transactions: sampleTransactions(TODAY), goals: sampleGoals(TODAY), today: TODAY });

  it("nets cash across current, savings and credit, and leaves investments out", () => {
    assert.equal(output.netCash, 84_320);
    assert.equal(output.investments.portfolioValue, 74_200);
    assert.equal(output.investments.monthlyContribution, 3_000);
  });

  it("finds the recurring services and totals them", () => {
    const merchants = output.subscriptions.map((s) => s.merchant);
    assert.ok(merchants.includes("Adobe Creative"));
    assert.ok(merchants.includes("Netflix"));
    assert.ok(output.subscriptionMonthly > 0);
    assert.equal(output.subscriptionAnnual, Math.round(output.subscriptionMonthly * 12 * 100) / 100);
    // Nothing has been assessed, so nothing is ranked and nothing is a saving.
    assert.ok(output.subscriptions.every((s) => s.tier === "unassessed"));
    assert.equal(output.subscriptionReview.monthly, 0);
  });

  it("notices the dining spike and the large first-time Apple charge", () => {
    assert.ok(output.anomalies.some((a) => a.kind === "category" && /Dining/.test(a.title)));
    assert.ok(output.anomalies.some((a) => a.kind === "transaction" && /Apple/i.test(a.merchant ?? "")));
  });

  it("flags a subscription price rise", () => {
    assert.ok(output.attention.some((a) => /increased/.test(a.text)));
  });

  it("never mixes this month into its own 'typical'", () => {
    const dining = output.categories.find((c) => c.category === "Dining");
    assert.ok(dining?.typical !== undefined && dining.typical < dining.amount);
  });
});

describe("more categories", () => {
  const category = (description: string, amount = -500) => categorise([tx("2026-09-03", description, amount)], new Map())[0].category;

  it("puts car finance and loans under Debt, and a bond under Housing", () => {
    assert.equal(category("WESBANK VEHICLE FINANCE"), "Debt");
    assert.equal(category("PERSONAL LOAN REPAYMENT"), "Debt");
    assert.equal(category("BOND INSTALMENT ABSA"), "Housing");
  });

  it("puts medical aid under Health and car insurance under Insurance", () => {
    assert.equal(category("DISCOVERY HEALTH"), "Health");
    assert.equal(category("DISCOVERY INSURE"), "Insurance");
    assert.equal(category("OUTSURANCE PREMIUM"), "Insurance");
  });

  it("recognises entertainment, utilities and the rest", () => {
    assert.equal(category("STER-KINEKOR"), "Entertainment");
    assert.equal(category("COMPUTICKET"), "Entertainment");
    assert.equal(category("VODACOM"), "Utilities");
    assert.equal(category("ESKOM PREPAID"), "Utilities");
    assert.equal(category("UNISA TUITION"), "Education");
    assert.equal(category("SALON 27 HAIR"), "Personal care");
    assert.equal(category("SPCA DONATION"), "Giving");
  });

  it("leaves streaming in Subscriptions, where it can be reviewed", () => {
    assert.equal(category("NETFLIX.COM"), "Subscriptions");
  });
});

describe("where the money goes", () => {
  it("splits income into needs, wants, business and what was left", () => {
    const output = computeFinance({
      ...none,
      accounts: [],
      transactions: [
        tx("2026-09-01", "SALARY ACME", 20_000),
        tx("2026-09-02", "RENT CAPE TOWN", -8_000),
        tx("2026-09-03", "STER-KINEKOR", -300),
        tx("2026-09-04", "AWS EMEA", -400),
        tx("2026-09-05", "MYSTERY THING", -100),
      ],
      today: TODAY,
    });
    assert.deepEqual(output.split, { income: 20_000, needs: 8_000, wants: 300, business: 400, unsorted: 100, saved: 11_200, reimbursed: 0 });
  });

  it("lists the biggest merchants inside a category", () => {
    const ledger = categorise([tx("2026-09-03", "WOOLWORTHS 1", -900), tx("2026-09-10", "WOOLWORTHS 2", -300), tx("2026-09-12", "CHECKERS", -600)], new Map());
    const output = computeFinance({ ...none, accounts: [], transactions: ledger, today: TODAY });
    const groceries = output.categories.find((c) => c.category === "Groceries");
    assert.deepEqual(groceries?.merchants.map((m) => [m.merchant, m.amount, m.payments]), [["Woolworths", 1200, 2], ["Checkers", 600, 1]]);
  });

  it("shows a budgeted category before anything is spent in it, with its limit", () => {
    const output = computeFinance({ ...none, accounts: [], transactions: [tx("2026-09-03", "WOOLWORTHS", -900)], budgets: new Map([["Dining", 2_000]]), today: TODAY });
    const dining = output.categories.find((c) => c.category === "Dining");
    assert.equal(dining?.amount, 0);
    assert.equal(dining?.budget, 2_000);
  });
});

describe("a goal with a profile", () => {
  const goal = { id: "g", name: "Deposit", targetAmount: 120_000, currentAmount: 10_000, targetDate: "2030-09-29", type: "purchase" as const, kind: "goal" as const };

  it("needs less each month than the same goal with no growth assumed", () => {
    const [plain, growth] = goalProgress([goal, { ...goal, id: "h", riskProfile: "balanced" }], undefined, TODAY);
    assert.equal(plain.assumedReturn, 0);
    assert.equal(growth.assumedReturn, 0.095);
    assert.ok((growth.requiredMonthly ?? 0) < (plain.requiredMonthly ?? 0));
    assert.equal(growth.requiredMonthlyNoGrowth, plain.requiredMonthly);
  });

  it("lets an explicit return override the profile's", () => {
    const [entry] = goalProgress([{ ...goal, riskProfile: "growth", annualReturn: 0.03 }], undefined, TODAY);
    assert.equal(entry.assumedReturn, 0.03);
  });
});

describe("dates", () => {
  it("steps months across a year boundary", () => {
    assert.equal(addMonths("2026-01", -1), "2025-12");
    assert.equal(addMonths("2026-11", 3), "2027-02");
  });
});
