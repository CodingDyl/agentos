import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MRR_GOAL_RAND,
  selectRevenueStrip,
} from "../revenue-strip-model";

describe("revenue and pipeline strip", () => {
  it("pins the monthly goal at R100k, never a guessed number", () => {
    assert.equal(MRR_GOAL_RAND, 100_000);
  });

  it("asks to connect Virtec when there is no CRM, rather than inventing MRR or overdue figures", () => {
    const strip = selectRevenueStrip({});
    assert.equal(strip.mrr.kind, "connect");
    assert.equal(strip.overdue.kind, "connect");
    if (strip.mrr.kind === "connect") {
      assert.match(strip.mrr.label, /connect/i);
      assert.equal(strip.mrr.href, "/traction?tab=crm");
    }
    if (strip.overdue.kind === "connect") {
      assert.match(strip.overdue.label, /connect/i);
      assert.equal(strip.overdue.href, "/traction?tab=crm");
    }
  });

  it("shows MRR against the goal when Virtec reports it, including a true zero", () => {
    const strip = selectRevenueStrip({
      virtecConfigured: true,
      revenue: { monthlyRecurringRevenue: 38_000 },
    });
    assert.deepEqual(strip.mrr, { kind: "ready", amount: 38_000, goal: 100_000, progress: 0.38 });

    const zero = selectRevenueStrip({
      virtecConfigured: true,
      revenue: { monthlyRecurringRevenue: 0 },
    });
    assert.equal(zero.mrr.kind, "ready");
    if (zero.mrr.kind === "ready") assert.equal(zero.mrr.amount, 0);
  });

  it("does not treat a connected CRM with no MRR field as R0", () => {
    const strip = selectRevenueStrip({
      virtecConfigured: true,
      revenue: { overdueInvoiceCount: 2 },
    });
    assert.equal(strip.mrr.kind, "connect");
    if (strip.mrr.kind === "connect") {
      assert.match(strip.mrr.label, /no mrr|not reported|connect/i);
    }
  });

  it("shows overdue invoice count from Virtec and sums amounts only from overdue invoice follow-ups", () => {
    const strip = selectRevenueStrip({
      virtecConfigured: true,
      revenue: { overdueInvoiceCount: 2 },
      followUps: [
        { id: "a", type: "invoice_overdue", amount: 12_500, overdue: true },
        { id: "b", type: "invoice_overdue", amount: 7_500, overdue: true },
        { id: "c", type: "quote_pending", amount: 80_000, overdue: true },
      ],
    });
    assert.equal(strip.overdue.kind, "ready");
    if (strip.overdue.kind === "ready") {
      assert.equal(strip.overdue.count, 2);
      assert.equal(strip.overdue.amount, 20_000);
    }
  });

  it("shows the count without inventing an amount when follow-ups have none", () => {
    const strip = selectRevenueStrip({
      virtecConfigured: true,
      revenue: { overdueInvoiceCount: 3 },
      followUps: [{ id: "a", type: "invoice_overdue", overdue: true }],
    });
    assert.equal(strip.overdue.kind, "ready");
    if (strip.overdue.kind === "ready") {
      assert.equal(strip.overdue.count, 3);
      assert.equal(strip.overdue.amount, undefined);
    }
  });

  it("counts inbound leads and rebuilds waiting on the operator, without inventing either", () => {
    const strip = selectRevenueStrip({
      virtecConfigured: true,
      inboundWaiting: 4,
      rebuildsWaiting: 2,
    });
    assert.equal(strip.waiting.kind, "ready");
    if (strip.waiting.kind === "ready") {
      assert.equal(strip.waiting.leads, 4);
      assert.equal(strip.waiting.rebuilds, 2);
    }
  });

  it("still reports rebuilds waiting when Virtec is not connected", () => {
    const strip = selectRevenueStrip({ rebuildsWaiting: 1 });
    assert.equal(strip.waiting.kind, "ready");
    if (strip.waiting.kind === "ready") {
      assert.equal(strip.waiting.leads, undefined);
      assert.equal(strip.waiting.rebuilds, 1);
    }
  });

  it("asks to connect a source when neither leads nor rebuilds can be read", () => {
    const strip = selectRevenueStrip({});
    assert.equal(strip.waiting.kind, "connect");
    if (strip.waiting.kind === "connect") {
      assert.match(strip.waiting.label, /connect/i);
    }
  });

  it("points Send invoice at the existing invoices tab and never claims to send", () => {
    const strip = selectRevenueStrip({});
    assert.equal(strip.sendInvoice.href, "/business?tab=invoices");
    assert.equal(strip.sendInvoice.sends, false);
  });

  it("opens Follow up on a drafted message when one exists, otherwise the follow-ups list", () => {
    const withDraft = selectRevenueStrip({
      virtecConfigured: true,
      followUps: [
        {
          id: "fu-1",
          type: "invoice_overdue",
          overdue: true,
          customerName: "Jo",
          companyName: "Acme",
          customerEmail: "jo@acme.test",
          suggestedSubject: "Overdue invoice",
          suggestedMessage: "Hi Jo, the invoice is still open.",
        },
      ],
    });
    assert.equal(withDraft.followUp?.kind, "draft");
    if (withDraft.followUp?.kind === "draft") {
      assert.equal(withDraft.followUp.id, "fu-1");
      assert.equal(withDraft.followUp.message, "Hi Jo, the invoice is still open.");
      assert.equal(withDraft.followUp.sends, false);
    }

    const none = selectRevenueStrip({ virtecConfigured: true, followUps: [] });
    assert.equal(none.followUp?.kind, "list");
    if (none.followUp?.kind === "list") {
      assert.equal(none.followUp.href, "/business?tab=follow-ups");
      assert.equal(none.followUp.sends, false);
    }
  });
});
