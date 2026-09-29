import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareProfiles,
  futureValueOfContributions,
  futureValueOfLump,
  inflateTarget,
  monthsBetween,
  recommendProfile,
  requiredMonthly,
} from "../../../shared/finance-profiler";

describe("requiredMonthly", () => {
  it("is plain division when nothing grows", () => {
    assert.equal(requiredMonthly({ target: 12_000, saved: 0, annualReturn: 0, months: 12 }), 1_000);
    assert.equal(requiredMonthly({ target: 12_000, saved: 6_000, annualReturn: 0, months: 12 }), 500);
  });

  it("asks for less when the money grows, and paying that amount really does reach the target", () => {
    const input = { target: 100_000, saved: 10_000, annualReturn: 0.09, months: 60 };
    const withGrowth = requiredMonthly(input);
    assert.ok(withGrowth < requiredMonthly({ ...input, annualReturn: 0 }));

    const reached = futureValueOfLump(input.saved, input.annualReturn, input.months) + futureValueOfContributions(withGrowth, input.annualReturn, input.months);
    assert.ok(Math.abs(reached - input.target) < 0.01, `reached ${reached}`);
  });

  it("is zero when what is saved already grows to the target", () => {
    assert.equal(requiredMonthly({ target: 10_000, saved: 9_900, annualReturn: 0.12, months: 24 }), 0);
  });
});

describe("monthsBetween", () => {
  it("rounds up and never returns less than one", () => {
    assert.equal(monthsBetween("2026-09-29", "2027-03-29"), 6);
    assert.equal(monthsBetween("2026-09-29", "2026-09-30"), 1);
    assert.equal(monthsBetween("2026-09-29", "2026-01-01"), 1);
  });
});

describe("recommendProfile", () => {
  const base = { goalType: "travel", reaction: "hold", date: "flexible" } as const;

  it("lets time decide first", () => {
    assert.equal(recommendProfile({ ...base, months: 12 }).profile, "cash");
    assert.equal(recommendProfile({ ...base, months: 36 }).profile, "conservative");
    assert.equal(recommendProfile({ ...base, months: 84 }).profile, "balanced");
    assert.equal(recommendProfile({ ...base, months: 180 }).profile, "growth");
  });

  it("keeps an emergency fund in cash whatever else you say", () => {
    assert.equal(recommendProfile({ goalType: "emergency", reaction: "add", date: "flexible", months: 240 }).profile, "cash");
  });

  it("pulls down for someone who would sell, and for a date that cannot move", () => {
    assert.equal(recommendProfile({ ...base, months: 180, reaction: "sell" }).profile, "balanced");
    assert.equal(recommendProfile({ ...base, months: 180, date: "firm" }).profile, "balanced");
    assert.equal(recommendProfile({ ...base, months: 180, reaction: "sell", date: "firm" }).profile, "conservative");
  });

  it("never talks anyone up on a short horizon", () => {
    assert.equal(recommendProfile({ ...base, months: 36, reaction: "add" }).profile, "conservative");
    assert.equal(recommendProfile({ ...base, months: 84, reaction: "add" }).profile, "growth");
  });

  it("never goes below cash", () => {
    assert.equal(recommendProfile({ ...base, months: 6, reaction: "sell", date: "firm" }).profile, "cash");
  });

  it("always says why", () => {
    assert.ok(recommendProfile({ ...base, months: 84 }).reasons.length > 0);
  });
});

describe("compareProfiles", () => {
  const rows = compareProfiles({ target: 60_000, saved: 5_000, months: 48 });

  it("asks for less from a higher assumed return, and more if the return comes in lower", () => {
    const monthly = rows.map((row) => row.monthly);
    assert.deepEqual([...monthly].sort((a, b) => b - a), monthly);
    for (const row of rows) assert.ok(row.monthlyIfLower >= row.monthly);
  });

  it("lets a return be overridden", () => {
    const [cash] = compareProfiles({ target: 60_000, saved: 0, months: 24, returns: { cash: 0 } });
    assert.equal(cash.monthly, 2_500);
    assert.equal(cash.growthShare, 0);
  });
});

describe("inflateTarget", () => {
  it("costs more later", () => {
    assert.ok(Math.abs(inflateTarget(100_000, 0.05, 24) - 110_250) < 1);
  });
});
