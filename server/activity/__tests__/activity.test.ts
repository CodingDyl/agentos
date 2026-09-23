import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../../../shared/agentos-types";
import {
  applyFilters,
  deduplicate,
  readLimit,
  readSource,
  sortNewestFirst,
  MAX_ACTIVITY_LIMIT,
  DEFAULT_ACTIVITY_LIMIT,
} from "../index";

/**
 * The timeline is an audit trail: it must not lose an event, invent an order,
 * or show the same happening twice. Every source is read independently, so the
 * merge is the only place those guarantees can be made.
 */

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "e1",
    timestamp: "2026-09-07T20:16:00+02:00",
    source: "hermes",
    level: "info",
    type: "run.started",
    title: "Hermes run started",
    ...overrides,
  };
}

describe("ordering", () => {
  it("puts the newest event first", () => {
    const ordered = sortNewestFirst([
      event({ id: "old", timestamp: "2026-09-05T10:00:00+02:00" }),
      event({ id: "new", timestamp: "2026-09-07T20:16:00+02:00" }),
      event({ id: "middle", timestamp: "2026-09-06T18:00:00+02:00" }),
    ]);

    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ["new", "middle", "old"],
    );
  });

  it("compares instants, not strings, across timezone offsets", () => {
    // 08:55Z is 10:55+02:00 — later than 10:32+02:00, despite reading smaller.
    const ordered = sortNewestFirst([
      event({ id: "local", timestamp: "2026-09-05T10:32:56+02:00" }),
      event({ id: "utc", timestamp: "2026-09-05T08:55:00.829Z" }),
    ]);

    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ["utc", "local"],
    );
  });

  it("drops an event it cannot place rather than guessing", () => {
    const ordered = sortNewestFirst([
      event({ id: "good" }),
      event({ id: "undated", timestamp: "sometime last week" }),
    ]);

    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ["good"],
    );
  });
});

describe("deduplication", () => {
  it("collapses a repeated id", () => {
    const events = deduplicate([event({ id: "same" }), event({ id: "same" })]);

    assert.equal(events.length, 1);
  });

  it("collapses two sources describing one happening identically", () => {
    const events = deduplicate([
      event({ id: "from-hermes" }),
      event({ id: "from-store" }),
    ]);

    assert.equal(events.length, 1);
    assert.equal(events[0].id, "from-hermes");
  });

  it("keeps two genuinely different events at the same instant", () => {
    const events = deduplicate([
      event({ id: "a", title: "Hermes run started" }),
      event({ id: "b", title: "Hermes run completed" }),
    ]);

    assert.equal(events.length, 2);
  });

  it("keeps the same title from different sources", () => {
    const events = deduplicate([
      event({ id: "a", source: "hermes" }),
      event({ id: "b", source: "user" }),
    ]);

    assert.equal(events.length, 2);
  });
});

describe("filters", () => {
  const events = [
    event({ id: "a", source: "hermes", project: "pantry-pilot" }),
    event({ id: "b", source: "automation" }),
    event({ id: "c", source: "hermes", project: "virtara" }),
  ];

  it("returns everything when nothing is asked for", () => {
    assert.equal(applyFilters(events, {}).length, 3);
  });

  it("filters by source", () => {
    assert.deepEqual(
      applyFilters(events, { source: "hermes" }).map((entry) => entry.id),
      ["a", "c"],
    );
  });

  it("filters by project", () => {
    assert.deepEqual(
      applyFilters(events, { project: "pantry-pilot" }).map((entry) => entry.id),
      ["a"],
    );
  });

  it("excludes events belonging to no project when one is named", () => {
    assert.equal(applyFilters(events, { project: "virtara" }).length, 1);
  });

  it("combines both filters", () => {
    assert.equal(
      applyFilters(events, { source: "automation", project: "virtara" }).length,
      0,
    );
  });
});

describe("reading a request", () => {
  it("defaults a missing or unusable limit", () => {
    assert.equal(readLimit(undefined), DEFAULT_ACTIVITY_LIMIT);
    assert.equal(readLimit("many"), DEFAULT_ACTIVITY_LIMIT);
    assert.equal(readLimit("0"), DEFAULT_ACTIVITY_LIMIT);
    assert.equal(readLimit("-10"), DEFAULT_ACTIVITY_LIMIT);
  });

  it("honours a limit inside the range", () => {
    assert.equal(readLimit("5"), 5);
    assert.equal(readLimit(25), 25);
  });

  it("never loads the whole history", () => {
    assert.equal(readLimit("100000"), MAX_ACTIVITY_LIMIT);
  });

  it("accepts only known sources", () => {
    assert.equal(readSource("hermes"), "hermes");
    assert.equal(readSource("grok"), "grok");
    assert.equal(readSource("everything"), undefined);
    assert.equal(readSource(undefined), undefined);
  });
});
