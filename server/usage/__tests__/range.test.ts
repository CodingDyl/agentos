import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageRecord } from "../../../shared/usage-types";
import { rangeWindow, usageSeries } from "../operations";

const NOW = new Date("2026-09-24T15:30:00.000Z");

function record(timestamp: string, tokens: number, costUsd?: number): UsageRecord {
  return {
    id: timestamp,
    timestamp,
    source: "hermes",
    operation: "chat",
    agent: "hermes",
    tokens: { total: tokens },
    costUsd,
    status: "exact",
    costStatus: costUsd === undefined ? "unknown" : "exact",
  };
}

describe("rangeWindow", () => {
  it("covers the calendar month for month", () => {
    const window = rangeWindow("month", NOW);
    assert.equal(window.from, "2026-09-01T00:00:00.000Z");
    assert.equal(window.to, "2026-10-01T00:00:00.000Z");
    assert.equal(window.label, "September");
  });

  it("covers today from midnight for today", () => {
    const window = rangeWindow("today", NOW);
    assert.equal(window.from, "2026-09-24T00:00:00.000Z");
    assert.equal(window.to, "2026-09-25T00:00:00.000Z");
    assert.equal(window.label, "Today");
  });

  it("covers seven whole calendar days, including today, for 7d", () => {
    const window = rangeWindow("7d", NOW);
    assert.equal(window.from, "2026-09-18T00:00:00.000Z");
    assert.equal(window.to, "2026-09-25T00:00:00.000Z");
  });

  it("reaches back into last month when the week spans it", () => {
    const window = rangeWindow("7d", new Date("2026-10-02T09:00:00.000Z"));
    assert.equal(window.from, "2026-09-26T00:00:00.000Z");
  });
});

describe("usageSeries", () => {
  it("buckets today by the hour, stopping at now", () => {
    const series = usageSeries([], rangeWindow("today", NOW), "today", NOW);
    // 00:00 through 15:00 — sixteen hours have started, none past now.
    assert.equal(series.length, 16);
  });

  it("buckets a week by the day", () => {
    const series = usageSeries([], rangeWindow("7d", NOW), "7d", NOW);
    assert.equal(series.length, 7);
    assert.equal(series[0].from, "2026-09-18T00:00:00.000Z");
  });

  it("adds tokens and cost into the right bucket", () => {
    const series = usageSeries(
      [
        record("2026-09-24T09:10:00.000Z", 100, 0.5),
        record("2026-09-24T09:50:00.000Z", 50, 0.25),
        record("2026-09-24T11:00:00.000Z", 20),
      ],
      rangeWindow("today", NOW),
      "today",
      NOW,
    );

    assert.equal(series[9].tokens, 150);
    assert.equal(series[9].costUsd, 0.75);
    assert.equal(series[11].tokens, 20);
  });

  it("leaves cost absent, never zero, where nothing was priced", () => {
    const series = usageSeries([record("2026-09-24T11:00:00.000Z", 20)], rangeWindow("today", NOW), "today", NOW);

    assert.equal(series[11].costUsd, undefined);
    assert.equal(series[3].costUsd, undefined);
  });

  it("ignores records outside the window", () => {
    const series = usageSeries([record("2026-09-23T23:59:00.000Z", 999, 9)], rangeWindow("today", NOW), "today", NOW);
    assert.equal(series.reduce((sum, bucket) => sum + bucket.tokens, 0), 0);
  });
});
