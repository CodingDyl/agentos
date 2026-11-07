import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DASH, formatMinutes, formatRandMinor, formatRate, formatUsd, monthLabel } from "../outcomes-model";

describe("outcomes formatting", () => {
  it("writes rand from minor units, and a dash for unknown, never R0", () => {
    assert.equal(formatRandMinor(10_000_000), "R100,000");
    assert.equal(formatRandMinor(118_882), "R1,188.82");
    assert.equal(formatRandMinor(0), "R0");
    assert.equal(formatRandMinor(null), DASH);
    assert.equal(formatRandMinor(undefined), DASH);
  });

  it("keeps dollars separate and dashes an unknown cost", () => {
    assert.equal(formatUsd(0.756), "$0.76");
    assert.equal(formatUsd(42.4), "$42");
    assert.equal(formatUsd(null), DASH);
  });

  it("writes durations plainly", () => {
    assert.equal(formatMinutes(45), "45m");
    assert.equal(formatMinutes(60), "1h");
    assert.equal(formatMinutes(90), "1h 30m");
  });

  it("writes a rate as a percentage, and a dash for none", () => {
    assert.equal(formatRate(0.9795), "98%");
    assert.equal(formatRate(null), DASH);
  });

  it("names the month", () => {
    assert.equal(monthLabel("2026-11"), "November 2026");
  });
});
