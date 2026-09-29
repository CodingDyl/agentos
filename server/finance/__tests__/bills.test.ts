import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { Transaction } from "../../../shared/finance-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-bills-"));
process.env.AGENTOS_UI_DIR = directory;
delete process.env.INVESTEC_CLIENT_ID;
delete process.env.INVESTEC_SECRET;
delete process.env.INVESTEC_API_KEY;

const { closeFinanceDatabase } = await import("../db");
const store = await import("../store");
const { getFinance } = await import("../finance");
const { buildBillStatuses, billTotals, dueDateFor, paymentMatchesBill, suggestBills } = await import("../bills");
const { computeFinance, categorise, detectRecurring, isCancellable } = await import("../engine");
const { cleanMerchant } = await import("../categorise");

after(() => {
  closeFinanceDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

let n = 0;
const tx = (date: string, description: string, amount: number): Transaction => ({ id: `b${(n += 1)}`, accountId: "a", date, description, amount, merchant: cleanMerchant(description) });
const bill = (over: Partial<import("../store").StoredBill> = {}) => ({ id: "b1", name: "Rent", amount: 9_500, dueDay: 2, category: "Housing" as const, ...over });

describe("matching a payment to a bill", () => {
  it("matches a whole word, and not the middle of another word", () => {
    assert.equal(paymentMatchesBill(bill(), { amount: -9500, description: "RENT CAPE TOWN", merchant: "Rent Cape" }), true);
    assert.equal(paymentMatchesBill(bill(), { amount: -50, description: "CURRENT ACCOUNT FEE", merchant: "Current Account" }), false);
    assert.equal(paymentMatchesBill(bill(), { amount: -50, description: "PARENTAL LEAVE", merchant: "Parental" }), false);
  });

  it("uses the match word when one is set, and copes with punctuation in it", () => {
    const b = bill({ name: "Electricity", match: "city of cape town" });
    assert.equal(paymentMatchesBill(b, { amount: -1200, description: "CITY OF CAPE TOWN MUNICIPAL", merchant: "City Of Cape" }), true);
    assert.equal(paymentMatchesBill(bill({ match: "a.b(c" }), { amount: -1, description: "x", merchant: "x" }), false);
  });

  it("never matches money coming in", () => {
    assert.equal(paymentMatchesBill(bill(), { amount: 9500, description: "RENT REFUND", merchant: "Rent" }), false);
  });
});

describe("dueDateFor", () => {
  it("clamps to the end of a short month", () => {
    assert.equal(dueDateFor("2026-02", 31), "2026-02-28");
    assert.equal(dueDateFor("2026-09", 31), "2026-09-30");
    assert.equal(dueDateFor("2026-09", 5), "2026-09-05");
  });
});

describe("a bill's status this month", () => {
  const ledger = [tx("2026-08-02", "RENT CAPE TOWN", -9_500), tx("2026-09-02", "RENT CAPE TOWN", -9_500)];

  it("is paid when the payment is there, with what it cost against what you said", () => {
    const [status] = buildBillStatuses([bill()], [], [tx("2026-09-02", "RENT CAPE TOWN", -9_800)], "2026-09-29");
    assert.equal(status.status, "paid");
    assert.equal(status.paidAmount, 9_800);
    assert.equal(status.variance, 300);
    assert.equal(status.marked, false);
  });

  it("is upcoming before the date, due soon within three days, and only 'missing' after a grace period", () => {
    const at = (today: string, dueDay: number) => buildBillStatuses([bill({ dueDay })], [], [], today)[0].status;
    assert.equal(at("2026-09-10", 25), "upcoming");
    assert.equal(at("2026-09-23", 25), "due-soon");
    assert.equal(at("2026-09-27", 25), "due-soon");
    assert.equal(at("2026-09-29", 25), "missing");
  });

  it("adds two part-payments in a month", () => {
    const [status] = buildBillStatuses([bill()], [], [tx("2026-09-02", "RENT", -6_000), tx("2026-09-05", "RENT", -3_500)], "2026-09-29");
    assert.equal(status.paidAmount, 9_500);
  });

  it("counts a payment you marked by hand, and says so", () => {
    const [status] = buildBillStatuses([bill()], [{ billId: "b1", month: "2026-09", amount: 9_500, paidOn: "2026-09-02" }], [], "2026-09-29");
    assert.equal(status.status, "paid");
    assert.equal(status.marked, true);
  });

  it("keeps the last months and their average, with a gap left as a gap", () => {
    const [status] = buildBillStatuses([bill()], [], ledger, "2026-09-29");
    assert.deepEqual(status.history.map((h) => [h.month, h.amount]), [["2026-06", undefined], ["2026-07", undefined], ["2026-08", 9_500], ["2026-09", 9_500]]);
    assert.equal(status.average, 9_500);
  });
});

describe("totals and suggestions", () => {
  it("totals what is committed, paid and still to come, and the share of income", () => {
    const items = buildBillStatuses([bill(), bill({ id: "b2", name: "Wifi", amount: 900, dueDay: 28 })], [], [tx("2026-09-02", "RENT", -9_500)], "2026-09-10");
    const totals = billTotals(items, 40_000);
    assert.equal(totals.committedMonthly, 10_400);
    assert.equal(totals.paidThisMonth, 9_500);
    assert.equal(totals.remaining, 900);
    assert.ok(Math.abs((totals.incomeShare ?? 0) - 0.26) < 1e-9);
  });

  it("does not suggest a restaurant or fuel just because they recur monthly", () => {
    const rows = ["2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m) => [tx(`${m}-08`, "NANDOS SANDTON", -2_800), tx(`${m}-14`, "ENGEN SANDTON", -1_400), tx(`${m}-02`, "RENT", -9_500)]);
    const recurring = detectRecurring(categorise(rows, new Map()), "2026-09-29");
    assert.ok(recurring.length >= 3);
    assert.deepEqual(suggestBills(recurring, [], isCancellable).map((s) => s.merchant), ["Rent"]);
  });

  it("suggests fixed recurring payments you are not tracking, and not subscriptions or tracked ones", () => {
    const rows = ["2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m) => [tx(`${m}-02`, "RENT CAPE TOWN", -9_500), tx(`${m}-03`, "DISCOVERY HEALTH", -3_150), tx(`${m}-05`, "NETFLIX.COM", -229)]);
    const ledger = categorise(rows, new Map());
    const recurring = detectRecurring(ledger, "2026-09-29");
    const found = suggestBills(recurring, [], isCancellable);
    assert.deepEqual(found.map((s) => s.merchant), ["Rent", "Discovery Health"]);
    assert.equal(found[0].dueDay, 2);
    assert.deepEqual(suggestBills(recurring, [{ name: "Rent", match: "rent" }], isCancellable).map((s) => s.merchant), ["Discovery Health"]);
  });
});


describe("in the finished picture", () => {
  it("raises an attention item for a bill not seen, and a fixed-costs finding once there is income", () => {
    const rows = [tx("2026-09-01", "SALARY ACME", 30_000), tx("2026-08-01", "SALARY ACME", 30_000), tx("2026-08-02", "RENT", -9_000)];
    const output = computeFinance({
      accounts: [],
      transactions: rows,
      corrections: new Map(),
      decisions: new Map(),
      assessments: new Map(),
      goals: [],
      bills: [bill({ amount: 9_000, dueDay: 2 })],
      billMarks: [],
      today: "2026-09-29",
    });
    assert.ok(output.attention.some((a) => a.id === "bill:b1" && a.tab === "bills" && /not seen yet/.test(a.text)));
    assert.equal(output.findings.find((f) => f.id === "fixed-costs")?.status, "good");
  });

  it("stores, marks and removes a bill, and shows the sample bills only until you add your own", () => {
    assert.ok(getFinance().bills.items.every((b) => b.id.startsWith("sample-")));
    const created = store.createBill({ name: "Wifi", amount: 899, dueDay: 25, category: "Utilities" });
    assert.deepEqual(getFinance().bills.items.map((b) => b.name), ["Wifi"]);

    store.markBillPaid(created.id, getFinance().month, 899, getFinance().today);
    assert.equal(getFinance().bills.items[0].status, "paid");
    store.unmarkBillPaid(created.id, getFinance().month);
    assert.notEqual(getFinance().bills.items[0].status, "paid");

    assert.equal(store.updateBill(created.id, { amount: 949, match: "afrihost" }).match, "afrihost");
    assert.equal(store.updateBill(created.id, { match: null }).match, undefined);
    store.deleteBill(created.id);
    assert.throws(() => store.readBill(created.id), store.FinanceNotFoundError);
  });
});
