import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, it } from "node:test";
import type { BusinessEntity } from "../../../shared/business-types";
import type { Category, Transaction } from "../../../shared/finance-types";
import { financeBusinessExpenses, financeExpenseRecordId, importFinanceExpenses, type FinanceSource } from "../finance-import";
import { closeBusinessLedger, getBusinessLedgerStatus } from "../ledger-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-finance-import-"));
const virtue: BusinessEntity = { id: "virtec", name: "Virtue", kind: "agency", source: "virtec", workspaces: [] };
const pantry: BusinessEntity = { id: "pantry-pilot", name: "Pantry Pilot", kind: "product", source: "local", workspaces: [] };

beforeEach(() => {
  closeBusinessLedger();
  process.env.AGENTOS_UI_DIR = fs.mkdtempSync(path.join(root, "case-"));
});
after(() => {
  closeBusinessLedger();
  fs.rmSync(root, { recursive: true, force: true });
});

const transactions: Transaction[] = [
  { id: "t-hosting", accountId: "a", date: "2026-09-20", description: "CARD AWS EMEA", merchant: "AWS", amount: -450.5 },
  { id: "t-figma", accountId: "a", date: "2026-09-22", description: "FIGMA MONTHLY", merchant: "Figma", amount: -300 },
  { id: "t-groceries", accountId: "a", date: "2026-09-21", description: "WOOLWORTHS", merchant: "Woolworths", amount: -800 },
  { id: "t-refund", accountId: "a", date: "2026-09-23", description: "AWS REFUND", merchant: "AWS", amount: 50 },
];

function source(overrides: Partial<FinanceSource> = {}): FinanceSource {
  return {
    available: () => true,
    transactions: () => transactions,
    // AWS is filed under Business; Figma stays under Subscriptions but its merchant is marked as business.
    corrections: () => new Map<string, Category>([["aws", "Business"], ["figma", "Subscriptions"], ["woolworths", "Groceries"]]),
    businessMerchants: () => new Set(["figma"]),
    partnerMatch: () => undefined,
    ...overrides,
  };
}

it("lists money out marked as business, by category or by merchant, and nothing else", () => {
  const listed = financeBusinessExpenses(source());
  assert.equal(listed.available, true);
  assert.deepEqual(
    listed.candidates.map((candidate) => [candidate.transactionId, candidate.amountMinor, candidate.category]),
    [["t-figma", 30000, "Subscriptions"], ["t-hosting", 45050, "Business"]],
  );
});

it("refuses while Finance only has sample data", () => {
  const listed = financeBusinessExpenses(source({ available: () => false }));
  assert.equal(listed.available, false);
  assert.equal(listed.candidates.length, 0);
  assert.throws(() => importFinanceExpenses(virtue, { revision: 0, transactionIds: ["t-hosting"] }, source({ available: () => false })));
});

it("imports chosen transactions as expenses, once, into one business", () => {
  const status = importFinanceExpenses(virtue, { revision: getBusinessLedgerStatus(virtue.id).revision, transactionIds: ["t-hosting"] }, source());
  const expense = status.records.find((record) => record.id === financeExpenseRecordId("t-hosting"));
  assert.ok(expense && expense.kind === "expense");
  assert.equal(expense.vendor, "AWS");
  assert.equal(expense.amountMinor, 45050);
  assert.equal(expense.paidOn, "2026-09-20");
  assert.equal(status.audit[0]?.action, "finance-import");

  const listed = financeBusinessExpenses(source());
  assert.equal(listed.candidates.find((candidate) => candidate.transactionId === "t-hosting")?.importedInto, virtue.id);

  // Already imported: a second import of the same transaction, here or in another business, adds nothing.
  assert.throws(
    () => importFinanceExpenses(virtue, { revision: status.revision, transactionIds: ["t-hosting"] }, source()),
    /already imported/,
  );
  assert.throws(
    () => importFinanceExpenses(pantry, { revision: status.revision, transactionIds: ["t-hosting"] }, source()),
    /already imported/,
  );

  // A mixed selection imports only what is new.
  const next = importFinanceExpenses(pantry, { revision: status.revision, transactionIds: ["t-hosting", "t-figma"] }, source());
  assert.deepEqual(next.records.filter((record) => record.kind === "expense").map((record) => record.id), [financeExpenseRecordId("t-figma")]);
});

it("refuses a transaction Finance does not mark as business", () => {
  assert.throws(
    () => importFinanceExpenses(virtue, { revision: getBusinessLedgerStatus(virtue.id).revision, transactionIds: ["t-groceries"] }, source()),
    /no longer marked as business/,
  );
});
