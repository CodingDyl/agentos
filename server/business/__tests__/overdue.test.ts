import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BusinessLedgerRecord } from "../../../shared/business-ledger-types";
import { billingToday, findOverdueInvoices, overdueInvoicesReport, type BusinessLedgerSnapshot } from "../overdue";

/** "Which invoices are overdue?" must mean what the Billing tab means. */

const invoice = (id: string, fields: Record<string, unknown>) =>
  ({ kind: "invoice", id, title: `Invoice ${id}`, status: "issued", amountMinor: 100_000, dueOn: "2026-10-01", ...fields }) as unknown as BusinessLedgerRecord;
const payment = (invoiceId: string, amountMinor: number, fields: Record<string, unknown> = {}) =>
  ({ kind: "payment", id: `pay-${invoiceId}-${amountMinor}`, receivedOn: "2026-10-02", amountMinor, allocations: [{ invoiceId, amountMinor }], ...fields }) as unknown as BusinessLedgerRecord;
const client = { kind: "client", id: "c1", name: "Sam", companyName: "Acme" } as unknown as BusinessLedgerRecord;

const ledger = (records: BusinessLedgerRecord[], name = "Virtec"): BusinessLedgerSnapshot => ({ entity: { id: name.toLowerCase(), name }, records });

describe("overdue invoices", () => {
  it("lists issued, unvoided, past-due invoices with a balance, oldest first", () => {
    const report = findOverdueInvoices(
      [
        ledger([
          client,
          invoice("late", { clientId: "c1", number: "INV-2", dueOn: "2026-10-10" }),
          invoice("older", { clientName: "Bob", dueOn: "2026-09-01" }),
          invoice("part-paid", { dueOn: "2026-10-05" }),
          payment("part-paid", 40_000),
          invoice("paid", {}),
          payment("paid", 100_000),
          invoice("void", { voided: { at: "2026-10-03T00:00:00.000Z", reason: "duplicate" } }),
          invoice("draft", { status: "draft" }),
          invoice("due-today", { dueOn: "2026-10-29" }),
          invoice("no-due", { dueOn: undefined }),
        ]),
      ],
      "2026-10-29",
    );
    assert.deepEqual(report.invoices.map((entry) => entry.title), ["Invoice older", "Invoice part-paid", "Invoice late"]);
    assert.equal(report.invoices[2].client, "Acme", "the client's company, from the linked client");
    assert.equal(report.invoices[1].balanceMinor, 60_000);
    assert.equal(report.totalMinor, 260_000);
    assert.equal(report.hasInvoices, true);
  });

  it("ignores a voided payment", () => {
    const report = findOverdueInvoices([ledger([invoice("a", {}), payment("a", 100_000, { voided: { at: "2026-10-03T00:00:00.000Z", reason: "bounced" } })])], "2026-10-29");
    assert.equal(report.invoices.length, 1);
  });

  it("tells an empty ledger apart from one with nothing overdue", () => {
    assert.equal(findOverdueInvoices([ledger([client])], "2026-10-29").hasInvoices, false);
    assert.equal(findOverdueInvoices([ledger([invoice("a", { dueOn: "2026-12-01" })])], "2026-10-29").hasInvoices, true);
  });

  it("covers every business", async () => {
    const report = await overdueInvoicesReport(new Date("2026-10-29T08:00:00Z"), async () => [ledger([invoice("a", {})]), ledger([invoice("b", {})], "Pantry Pilot")]);
    assert.deepEqual(report.invoices.map((entry) => entry.business).sort(), ["Pantry Pilot", "Virtec"]);
  });

  it("reckons today in Johannesburg, not the server's zone", () => {
    assert.equal(billingToday(new Date("2026-10-28T22:30:00Z")), "2026-10-29");
  });
});
