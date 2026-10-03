import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MaintenanceQuoteInputSchema, priceQuote, ProjectQuoteInputSchema } from "../../../shared/business-quote-pricing";

const project = (extra: Record<string, unknown>) => ProjectQuoteInputSchema.parse({ kind: "project", projectType: "Website", estimatedHours: 40, ...extra });

describe("project quote pricing (Virtec parity)", () => {
  it("multiplies hours, rate, complexity, urgency and priced features", () => {
    // 40 × 300 × 1.5 (Medium) × 1.2 (Rush) × 1.8 (E-Commerce) × 1.5 (Payments)
    const price = priceQuote(project({ urgency: "Rush", features: ["E-Commerce", "Payment Gateways", "SEO Friendly"] }));
    assert.equal(price.total, 58320);
  });

  it("adds hosting and maintenance after the multipliers, not inside them", () => {
    const price = priceQuote(project({ complexity: "High", hostingCost: 1000, maintenanceCost: 500 }));
    assert.equal(price.total, 40 * 300 * 2 + 1500);
  });

  it("applies each discount type the way Virtec does", () => {
    assert.equal(priceQuote(project({ discountType: "percentage", discountValue: 10 })).total, 40 * 300 * 1.5 * 0.9);
    assert.equal(priceQuote(project({ discountType: "hourly", discountValue: 50 })).total, 40 * 250 * 1.5);
    assert.equal(priceQuote(project({ discountType: "hours", discountValue: 4 })).total, 36 * 300 * 1.5);
  });

  it("never lets a discount go below zero", () => {
    assert.equal(priceQuote(project({ discountType: "hours", discountValue: 400 })).total, 0);
    assert.equal(priceQuote(project({ discountType: "percentage", discountValue: 250 })).total, 0);
  });

  it("shows the discount as a line", () => {
    const lines = priceQuote(project({ discountType: "percentage", discountValue: 10 })).lines;
    assert.deepEqual(lines.find((line) => line.type === "discount"), { label: "Discount", value: -1800, type: "discount" });
  });
});

describe("maintenance quote pricing", () => {
  const maintenance = (extra: Record<string, unknown>) => MaintenanceQuoteInputSchema.parse({ kind: "maintenance", ...extra });

  it("charges a locked SKU per month across the cycle", () => {
    const price = priceQuote(maintenance({ serviceSku: "bundle", frequency: "quarterly", hoursPerCycle: 99 }));
    assert.equal(price.total, 5490 * 3);
    assert.equal(price.monthly, 5490);
  });

  it("prices custom work as hours per cycle and reports its monthly value", () => {
    const price = priceQuote(maintenance({ hoursPerCycle: 6, frequency: "quarterly" }));
    assert.equal(price.total, 1800);
    assert.equal(price.monthly, 600);
  });
});
