import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-finance-"));
process.env.AGENTOS_UI_DIR = directory;
delete process.env.INVESTEC_CLIENT_ID;
delete process.env.INVESTEC_SECRET;
delete process.env.INVESTEC_API_KEY;

const { closeFinanceDatabase } = await import("../db");
const store = await import("../store");
const { getFinance } = await import("../finance");

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("with Investec not connected", () => {
  it("shows the labelled sample and writes none of it to disk", () => {
    const data = getFinance();
    assert.equal(data.source.kind, "sample");
    assert.equal(data.source.configured, false);
    assert.equal(store.countTransactions(), 0);
    assert.equal(store.readAccounts().length, 0);
  });
});

describe("goals, corrections and decisions", () => {
  it("adds, updates and removes a goal", () => {
    const goal = store.createGoal({ name: "Car service", targetAmount: 8_000, currentAmount: 0, type: "purchase", kind: "sinking" });
    assert.equal(store.updateGoal(goal.id, { currentAmount: 1_000 }).currentAmount, 1_000);
    store.deleteGoal(goal.id);
    assert.throws(() => store.readGoal(goal.id), store.FinanceNotFoundError);
  });

  it("remembers a correction by merchant and applies it to the sample ledger", () => {
    store.saveCorrection({ merchant: "Takealot", category: "Business" });
    const row = () => getFinance().transactions.find((t) => /takealot/i.test(t.description));
    assert.equal(row()?.category, "Business");
    assert.equal(row()?.categorySource, "you");
    store.deleteCorrection("Takealot");
    assert.equal(row()?.category, "Shopping");
    assert.equal(store.readCorrections().length, 0);
  });

  it("stores keep, and takes it back", () => {
    store.saveDecision({ merchant: "Adobe Creative", decision: "keep", note: "essential for business" });
    const sub = getFinance().subscriptions.find((s) => /adobe/i.test(s.merchant));
    assert.equal(sub?.decision, "keep");
    store.saveDecision({ merchant: "Adobe Creative", decision: null });
    assert.equal(getFinance().subscriptions.find((s) => /adobe/i.test(s.merchant))?.decision, undefined);
  });
});

describe("saving a snapshot", () => {
  it("is idempotent: the same row twice is one row", () => {
    const account = { id: "a", provider: "investec" as const, name: "Current", type: "current" as const, currency: "ZAR", balance: 10 };
    const row = { id: "t1", accountId: "a", date: "2026-09-01", description: "SALARY", amount: 100 };
    store.saveSnapshot([account], [row]);
    store.saveSnapshot([account], [row]);
    assert.equal(store.countTransactions(), 1);
  });
});
