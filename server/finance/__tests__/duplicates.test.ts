import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { RawInvestecTransaction } from "../investec";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-dupes-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeFinanceDatabase, financeDatabase } = await import("../db");
const store = await import("../store");
const { normaliseTransactions } = await import("../investec");

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

const row = (description: string, amount: number, extra: Partial<RawInvestecTransaction> = {}): RawInvestecTransaction => ({
  type: "DEBIT",
  description,
  amount,
  postingDate: "2026-09-29",
  ...extra,
});

/** What the bank sent on the first sync of the day, and on the next, after two more payments landed on top. */
const first = [row("RENT CDM", 16_029), row("GROCERIES", 4_500), row("DISCOVERY", 3_000)];
const second = [row("COOL58620", 1_040), row("CHECKERS FOODS", 571.46), ...first];

const ids = (rows: RawInvestecTransaction[]) => normaliseTransactions("acc", rows).map((t) => t.id);

describe("the same payment read twice is the same payment", () => {
  it("keeps a payment's id when new payments arrive above it and push it down the list", () => {
    const before = new Map(normaliseTransactions("acc", first).map((t) => [t.description, t.id]));
    const after = new Map(normaliseTransactions("acc", second).map((t) => [t.description, t.id]));
    for (const [description, id] of before) assert.equal(after.get(description), id, `${description} got a new id`);
  });

  it("does not save a payment again on the next sync: two syncs, one row each", () => {
    store.saveSnapshot([{ id: "acc", provider: "investec", name: "Private", type: "current", currency: "ZAR", balance: 0 }], normaliseTransactions("acc", first));
    store.saveSnapshot([{ id: "acc", provider: "investec", name: "Private", type: "current", currency: "ZAR", balance: 0 }], normaliseTransactions("acc", second));
    const rent = store.readTransactions().filter((t) => t.description === "RENT CDM");
    assert.equal(rent.length, 1);
    assert.equal(store.countTransactions(), 5);
  });

  it("does not depend on the bank's own ordering number, which can change too", () => {
    assert.deepEqual(ids([row("RENT CDM", 16_029, { postedOrder: 1 })]), ids([row("RENT CDM", 16_029, { postedOrder: 7 })]));
    assert.deepEqual(ids([row("RENT CDM", 16_029)]), ids([row("RENT CDM", 16_029, { postedOrder: 3 })]));
  });

  it("still tells two genuinely identical payments on one day apart, and keeps them apart next time", () => {
    const twice = [row("COFFEE", 40), row("COFFEE", 40)];
    const [a, b] = ids(twice);
    assert.notEqual(a, b);
    assert.deepEqual(ids([row("OTHER", 5), ...twice]).slice(1), [a, b]);
  });

  it("does not mistake payments that differ in amount, day, direction or account for each other", () => {
    const base = ids([row("RENT", 100)])[0];
    assert.notEqual(ids([row("RENT", 101)])[0], base);
    assert.notEqual(ids([row("RENT", 100, { postingDate: "2026-09-30" })])[0], base);
    assert.notEqual(ids([row("RENT", 100, { type: "CREDIT" })])[0], base);
    assert.notEqual(normaliseTransactions("other", [row("RENT", 100)])[0].id, base);
  });
});

describe("clearing the duplicates already saved", () => {
  it("drops the cached Investec payments so the next sync brings them back once, and keeps everything else", () => {
    const db = financeDatabase();
    db.exec("DELETE FROM transactions; DELETE FROM accounts;");
    store.saveSnapshot(
      [
        { id: "inv", provider: "investec", name: "Private", type: "current", currency: "ZAR", balance: 10 },
        { id: "man", provider: "manual", name: "Card", type: "credit", currency: "ZAR", balance: -5 },
      ],
      [
        // The same rent twice under two old-style ids, as the bug left it.
        { id: "old-1", accountId: "inv", date: "2026-09-29", description: "RENT CDM", amount: -16_029 },
        { id: "old-2", accountId: "inv", date: "2026-09-29", description: "RENT CDM", amount: -16_029 },
        { id: "manual-1", accountId: "man", date: "2026-09-10", description: "FLYSAFAIR", amount: -2_450 },
      ],
    );
    store.writeMeta("lastSyncAt", new Date().toISOString());
    store.writeMeta("balancesAt", new Date().toISOString());
    store.saveCorrection({ merchant: "Rent", category: "Housing" });

    // Open the database as one that predates the fix.
    db.exec("PRAGMA user_version = 5");
    closeFinanceDatabase();
    const reopened = financeDatabase();

    const remaining = store.readTransactions();
    assert.deepEqual(remaining.map((t) => t.id), ["manual-1"]);
    assert.equal(store.readMeta("lastSyncAt"), undefined);
    assert.equal(store.readAccounts().length, 2);
    assert.equal(store.readCorrections().length, 1);
    assert.ok((reopened.prepare("PRAGMA user_version").get() as { user_version: number }).user_version >= 6, "migrated past the purge");
  });
});
