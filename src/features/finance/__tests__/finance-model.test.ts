import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChange, goalStatusLabel, upcomingPayments } from "../finance-model";

describe("formatChange", () => {
  it("signs a change and admits when there is nothing to compare", () => {
    assert.equal(formatChange(0.63), "+63%");
    assert.equal(formatChange(-0.12), "-12%");
    assert.equal(formatChange(undefined), "-");
  });
});

describe("upcomingPayments", () => {
  const sub = (merchant: string, lastPaid: string, frequency: "monthly" | "annual" = "monthly") =>
    ({ merchant, lastPaid, frequency, monthly: 100, annual: 1200, payments: 3, kind: "other", tier: "unassessed" }) as never;

  it("expects a monthly charge one month after it last cleared, inside the window", () => {
    const result = upcomingPayments({ today: "2026-09-29", subscriptions: [sub("Netflix", "2026-09-05"), sub("Adobe", "2026-09-20"), sub("Annual", "2026-03-01", "annual")] }, 14);
    assert.deepEqual(
      result.map((payment) => [payment.merchant, payment.date]),
      [["Netflix", "2026-10-05"]],
    );
  });

  it("clamps to the end of a short month", () => {
    const result = upcomingPayments({ today: "2026-02-20", subscriptions: [sub("Gym", "2026-01-31")] }, 14);
    assert.equal(result[0]?.date, "2026-02-28");
  });
});

describe("goalStatusLabel", () => {
  it("names the shortfall when behind", () => {
    assert.equal(goalStatusLabel({ status: "behind", shortfall: 3_800 } as never), "Behind by R 3,800");
  });
});
