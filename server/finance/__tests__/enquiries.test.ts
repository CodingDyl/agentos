import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-enquiries-"));
process.env.AGENTOS_UI_DIR = directory;

const { closeFinanceDatabase } = await import("../db");
const store = await import("../store");

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("payments to look into", () => {
  const payment = { transactionId: "t1", date: "2026-10-01", description: "POS PURCHASE ODD SHOP", merchant: "Odd Shop", amount: -129.5, accountName: "Cheque" };

  it("keeps a copy of the payment, updates only the note when flagged again, and forgets it when resolved", () => {
    store.saveEnquiry(payment);
    store.saveEnquiry({ ...payment, amount: -1, note: "Asked the bank" });
    const [saved] = store.readEnquiries();
    assert.equal(saved.amount, -129.5, "the copy is from when it was first flagged");
    assert.equal(saved.note, "Asked the bank");
    assert.equal(saved.merchant, "Odd Shop");

    assert.equal(store.updateEnquiryNote("t1", "Refund on the way"), true);
    assert.equal(store.readEnquiries()[0].note, "Refund on the way");
    assert.equal(store.updateEnquiryNote("nope", "x"), false);

    store.deleteEnquiry("t1");
    assert.deepEqual(store.readEnquiries(), []);
  });
});
