import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { FinancialAccount, Transaction } from "../../../shared/finance-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-analyser-"));
process.env.AGENTOS_UI_DIR = directory;
delete process.env.INVESTEC_CLIENT_ID;
delete process.env.INVESTEC_SECRET;
delete process.env.INVESTEC_API_KEY;

const { closeFinanceDatabase } = await import("../db");
const store = await import("../store");
const { getFinance } = await import("../finance");
const { computeFinance } = await import("../engine");
const { buildAnalysisPacket } = await import("../analyser");
const { readStatement } = await import("../csv-import");

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

const TODAY = "2026-09-29";
let n = 0;
const tx = (date: string, description: string, amount: number): Transaction => ({ id: `a${(n += 1)}`, accountId: "cur", date, description, amount, merchant: description });
const account = (over: Partial<FinancialAccount>): FinancialAccount => ({ id: "cur", provider: "manual", name: "Current", type: "current", currency: "ZAR", balance: 10_000, ...over });

/** Four complete months and this one: 40k in, 38k out. */
function ledger(): Transaction[] {
  const rows: Transaction[] = [];
  for (const month of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
    rows.push(tx(`${month}-01`, "SALARY ACME", 40_000), tx(`${month}-02`, "RENT", -15_000), tx(`${month}-03`, "WOOLWORTHS", -8_000), tx(`${month}-10`, "RESTAURANT", -15_000));
  }
  return rows;
}

const compute = (accounts: FinancialAccount[], transactions = ledger()) =>
  computeFinance({ accounts, transactions, corrections: new Map(), decisions: new Map(), assessments: new Map(), goals: [], today: TODAY });

describe("findings", () => {
  const output = compute([account({ balance: 5_000 }), account({ id: "card", type: "credit", name: "Discovery Card", balance: -30_000, interestRate: 0.22, creditLimit: 40_000 })]);
  const find = (id: string) => output.findings.find((f) => f.id === id);

  it("flags a thin savings rate and a thin buffer, with the numbers behind them", () => {
    assert.equal(find("savings-rate")?.status, "act");
    assert.match(find("savings-rate")?.evidence.join(" ") ?? "", /R 40,000/);
    assert.equal(find("buffer")?.status, "act");
  });

  it("calls out expensive debt, with its cost and utilisation, and puts it in focus", () => {
    const debt = find("debt");
    assert.equal(debt?.status, "act");
    assert.match(debt?.evidence.join(" ") ?? "", /75% of the limit/);
    assert.match(debt?.evidence.join(" ") ?? "", /interest a month/);
    assert.ok(output.focus.includes("debt"));
    assert.ok(output.focus.length <= 3);
  });

  it("says when a card has no rate, rather than pretending the cost", () => {
    const noRate = compute([account({}), account({ id: "card", type: "credit", balance: -5_000 })]);
    assert.match(noRate.findings.find((f) => f.id === "debt")?.summary ?? "", /no interest rate/);
    assert.equal(noRate.debts[0].monthlyInterest, undefined);
  });

  it("does not raise debt when there is none", () => {
    assert.equal(compute([account({})]).findings.some((f) => f.id === "debt"), false);
  });

  it("orders debts by rate, highest first", () => {
    const two = compute([account({}), account({ id: "a", type: "credit", name: "Low", balance: -9_000, interestRate: 0.1 }), account({ id: "b", type: "credit", name: "High", balance: -3_000, interestRate: 0.25 })]);
    assert.deepEqual(two.debts.map((d) => d.name), ["High", "Low"]);
  });

  it("finds nothing to say about an empty ledger", () => {
    assert.deepEqual(compute([account({})], []).findings, []);
  });
});

describe("what Hermes is handed", () => {
  it("has totals and rounded balances, and no merchants, account names or numbers", () => {
    store.createManualAccount({ name: "Discovery Card 4123 9876 5432 1000", type: "credit", balance: 30_249, interestRate: 0.22, creditLimit: 40_000 });
    const packet = buildAnalysisPacket(getFinance());

    assert.match(packet, /Card A owes R 30,200/);
    for (const forbidden of ["Discovery", "4123", "WOOLWORTHS", "Woolworths", "Netflix", "Adobe", "Private Bank", "investec"]) {
      assert.equal(packet.toLowerCase().includes(forbidden.toLowerCase()), false, `${forbidden} reached the model`);
    }
  });
});

describe("accounts and import", () => {
  it("stores a card's balance as what is owed, and keeps the rate through updates", () => {
    const card = store.createManualAccount({ name: "Card", type: "credit", balance: 1_000, interestRate: 0.2 });
    assert.equal(card.balance, -1_000);
    assert.equal(store.updateAccount(card.id, { balance: 800 }).balance, -800);
    assert.equal(store.updateAccount(card.id, { balance: 800 }).interestRate, 0.2);
    assert.equal(store.updateAccount(card.id, { interestRate: null }).interestRate, undefined);
    store.deleteManualAccount(card.id);
  });

  it("imports a statement once, ignores a second import, and removes payments with the account", () => {
    const card = store.createManualAccount({ name: "Card", type: "credit", balance: 5_000 });
    const csv = "Date,Description,Amount\n2026-09-03,FLYSAFAIR,2450.00\n2026-09-04,WOOLWORTHS 1,300.00\n";
    const first = store.insertTransactions(readStatement(csv, card).transactions);
    const second = store.insertTransactions(readStatement(csv, card).transactions);
    assert.equal(first, 2);
    assert.equal(second, 0);
    assert.ok(store.readTransactions().some((t) => t.accountId === card.id && t.amount === -2450));
    store.deleteManualAccount(card.id);
    assert.equal(store.readTransactions().some((t) => t.accountId === card.id), false);
  });

  it("will not remove an Investec account or edit its balance", () => {
    store.saveSnapshot([{ id: "inv-1", provider: "investec", name: "Private", type: "current", currency: "ZAR", balance: 1 }], []);
    assert.throws(() => store.deleteManualAccount("inv-1"), store.FinanceConflictError);
    assert.throws(() => store.updateAccount("inv-1", { balance: 99 }), store.FinanceConflictError);
    assert.equal(store.updateAccount("inv-1", { interestRate: 0.1 }).interestRate, 0.1);
  });

  it("keeps the rate you set when the bank syncs the account again", () => {
    store.saveSnapshot([{ id: "inv-1", provider: "investec", name: "Private", type: "current", currency: "ZAR", balance: 500 }], []);
    const after = store.readAccount("inv-1");
    assert.equal(after.balance, 500);
    assert.equal(after.interestRate, 0.1);
  });
});
