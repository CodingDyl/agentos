import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Subscription } from "../../../shared/finance-types";
import { buildAssessmentRequest, stripIdentifiers, subscriptionFacts } from "../jev";
import { accountTypeFor, normaliseAccount, normaliseTransaction, transactionId } from "../investec";

const sub: Subscription = {
  merchant: "Adobe Creative",
  monthly: 899,
  annual: 10_788,
  frequency: "monthly",
  lastPaid: "2026-09-07",
  payments: 5,
  kind: "software",
  tier: "unassessed",
};

describe("what a model is allowed to see", () => {
  it("strips card numbers, account numbers, emails and IBANs", () => {
    assert.equal(stripIdentifiers("PAYMENT 1001234567890 to jo@example.com"), "PAYMENT to");
    assert.equal(stripIdentifiers("ref GB29NWBK60161331926819 ok"), "ref ok");
    assert.equal(stripIdentifiers("Adobe Creative"), "Adobe Creative");
  });

  it("puts only merchant, amount, rhythm and history in a subscription request", () => {
    const request = JSON.stringify(buildAssessmentRequest(sub, [sub]));
    for (const forbidden of ["accountId", "accountNumber", "balance", "token", "secret", "2026-09-07"]) {
      assert.equal(request.toLowerCase().includes(forbidden.toLowerCase()), false, `${forbidden} reached the model`);
    }
    assert.deepEqual(Object.keys(subscriptionFacts(sub, [sub])).sort(), ["charge_per_period", "currency", "frequency", "merchant", "other_recurring_services", "payments_seen"]);
  });
});

describe("Investec normalising", () => {
  it("keeps only the last four digits of an account number", () => {
    const account = normaliseAccount({ accountId: "abc", accountNumber: "10012345678", productName: "Private Bank Account" }, { currentBalance: 1200, currency: "ZAR" });
    assert.equal(account.mask, "5678");
    assert.equal(JSON.stringify(account).includes("10012345678"), false);
  });

  it("classifies products and treats a card balance as owed", () => {
    assert.equal(accountTypeFor("Private Bank Credit Card"), "credit");
    assert.equal(accountTypeFor("Notice Deposit"), "savings");
    assert.equal(accountTypeFor("Private Bank Account"), "current");
    const card = normaliseAccount({ accountId: "c", productName: "Credit Card" }, { currentBalance: 500 });
    assert.equal(card.balance, -500);
  });

  it("signs a transaction by its direction and gives the same row the same id", () => {
    const raw = { type: "DEBIT", description: "WOOLWORTHS 00329", postingDate: "2026-09-03", amount: 120.5, postedOrder: 4 };
    const a = normaliseTransaction("acc", raw, 0);
    assert.equal(a?.amount, -120.5);
    // The id is what the row is, not where it sat in the list or the bank's own ordering number.
    assert.equal(a?.id, transactionId("acc", raw));
    assert.equal(a?.id, transactionId("acc", { ...raw, postedOrder: 99 }));
    assert.equal(normaliseTransaction("acc", { ...raw, type: "CREDIT" }, 0)?.amount, 120.5);
  });

  it("skips pending rows and rows it cannot read", () => {
    assert.equal(normaliseTransaction("acc", { type: "DEBIT", status: "PENDING", postingDate: "2026-09-03", amount: 10 }, 0), undefined);
    assert.equal(normaliseTransaction("acc", { type: "DEBIT", description: "x" }, 0), undefined);
  });
});
