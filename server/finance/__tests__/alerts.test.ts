import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-alerts-"));
process.env.AGENTOS_UI_DIR = directory;
delete process.env.INVESTEC_CLIENT_ID;
delete process.env.INVESTEC_SECRET;
delete process.env.INVESTEC_API_KEY;

const { closeFinanceDatabase, financeDatabase } = await import("../db");
const store = await import("../store");
const { getFinance } = await import("../finance");

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  financeDatabase().exec("DELETE FROM dismissed_alerts");
});

describe("where an alert comes from", () => {
  it("names its source and says why it is showing", () => {
    const { attention } = getFinance();
    assert.ok(attention.length > 0, "the sample ledger raises alerts");
    for (const item of attention) {
      assert.ok(item.source.length > 0);
      assert.ok(item.detail.length > 10, `${item.id} explains itself`);
      assert.equal(item.dismissible, true);
    }
  });
});

describe("dismissing an alert", () => {
  it("hides it everywhere it is read from, and lists it so it can come back", () => {
    const before = getFinance();
    const target = before.attention[0];
    store.saveDismissal(target.id, "month", before.today.slice(0, 7));

    const after = getFinance();
    assert.ok(!after.attention.some((item) => item.id === target.id));
    assert.ok(!after.anomalies.some((item) => item.id === target.id));
    assert.deepEqual(after.dismissedAlerts.map((item) => item.id), [target.id]);
    assert.equal(after.dismissedAlerts[0].source, target.source);

    store.deleteDismissal(target.id);
    assert.ok(getFinance().attention.some((item) => item.id === target.id));
  });

  it("lasts the month only, unless you said always", () => {
    const month = getFinance().today.slice(0, 7);
    const dismissals = [
      { id: "a", scope: "month" as const, month: "2000-01" },
      { id: "b", scope: "always" as const, month: "2000-01" },
    ];
    assert.equal(store.isDismissed(dismissals, "a", month), false);
    assert.equal(store.isDismissed(dismissals, "b", month), true);
    assert.equal(store.isDismissed(dismissals, "a", "2000-01"), true);
  });

  it("clears out month dismissals from earlier months when a new one is saved", () => {
    store.saveDismissal("old", "month", "2000-01");
    store.saveDismissal("forever", "always", "2000-01");
    store.saveDismissal("new", "month", "2000-02");
    assert.deepEqual(store.readDismissals().map((e) => e.id).sort(), ["forever", "new"]);
  });

  it("upgrades a month dismissal to always without a duplicate row", () => {
    store.saveDismissal("x", "month", "2000-01");
    store.saveDismissal("x", "always", "2000-01");
    assert.deepEqual(store.readDismissals(), [{ id: "x", scope: "always", month: "2000-01" }]);
  });
});
