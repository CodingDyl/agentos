import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "@shared/agentos-types";
import {
  detailsFor,
  formatDay,
  formatTime,
  groupByDay,
  linksFor,
  toneFor,
} from "../activity-model";

/**
 * The timeline is an audit trail, so how it reads matters as much as what it
 * contains: colour must not overstate, grouping must not reorder, and the
 * expanded view must name what it shows rather than dumping a payload.
 */

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "e1",
    timestamp: new Date(2026, 8, 7, 20, 16).toISOString(),
    source: "hermes",
    level: "info",
    type: "run.completed",
    title: "Hermes run completed",
    ...overrides,
  };
}

describe("how loudly an event reads", () => {
  it("keeps red and green for genuine failure and success", () => {
    assert.equal(toneFor(event({ level: "error" })), "danger");
    assert.equal(toneFor(event({ level: "success" })), "success");
    assert.equal(toneFor(event({ level: "warning" })), "warning");
  });

  it("leaves an ordinary event quiet", () => {
    assert.equal(toneFor(event({ level: "info", type: "vault.committed" })), "quiet");
  });

  it("spends amber only on work still in flight", () => {
    assert.equal(toneFor(event({ type: "run.started", level: "info" })), "active");
    assert.equal(
      toneFor(event({ type: "automation.running", level: "info" })),
      "active",
    );
  });
});

describe("naming a moment", () => {
  const now = new Date(2026, 8, 7, 21, 0);

  it("reads the clock in 24-hour form", () => {
    assert.equal(formatTime(new Date(2026, 8, 7, 20, 16).toISOString()), "20:16");
  });

  it("names today and yesterday", () => {
    assert.equal(formatDay(new Date(2026, 8, 7, 9, 0).toISOString(), now), "Today");
    assert.equal(
      formatDay(new Date(2026, 8, 6, 21, 48).toISOString(), now),
      "Yesterday",
    );
  });

  it("dates anything older", () => {
    const label = formatDay(new Date(2026, 8, 1, 9, 0).toISOString(), now);

    assert.ok(label.includes("Sep"), label);
    assert.ok(!label.includes("Today"), label);
  });

  it("says so rather than guessing at an unreadable timestamp", () => {
    assert.equal(formatDay("whenever", now), "Undated");
    assert.equal(formatTime("whenever"), "");
  });
});

describe("grouping by day", () => {
  const now = new Date(2026, 8, 7, 21, 0);

  it("keeps the order the adapter sorted, and only splits on the day", () => {
    const days = groupByDay(
      [
        event({ id: "a", timestamp: new Date(2026, 8, 7, 20, 16).toISOString() }),
        event({ id: "b", timestamp: new Date(2026, 8, 7, 7, 30).toISOString() }),
        event({ id: "c", timestamp: new Date(2026, 8, 6, 21, 48).toISOString() }),
      ],
      now,
    );

    assert.deepEqual(
      days.map((day) => day.label),
      ["Today", "Yesterday"],
    );
    assert.deepEqual(
      days[0].events.map((entry) => entry.id),
      ["a", "b"],
    );
  });

  it("never re-sorts what it was given", () => {
    // Two events out of order stay out of order: the adapter owns the sort, and
    // a second opinion here would silently reorder an audit trail.
    const days = groupByDay(
      [
        event({ id: "older", timestamp: new Date(2026, 8, 7, 7, 30).toISOString() }),
        event({ id: "newer", timestamp: new Date(2026, 8, 7, 20, 16).toISOString() }),
      ],
      now,
    );

    assert.deepEqual(
      days[0].events.map((entry) => entry.id),
      ["older", "newer"],
    );
  });

  it("groups nothing into nothing", () => {
    assert.deepEqual(groupByDay([], now), []);
  });
});

describe("where an event leads", () => {
  it("opens the project it belongs to", () => {
    assert.deepEqual(linksFor(event({ project: "pantry-pilot" })), [
      { label: "Open workspace", to: "/workspaces/pantry-pilot" },
    ]);
  });

  it("opens the automation that ran", () => {
    const links = linksFor(
      event({ source: "automation", metadata: { automation: "aa7e0f5cc594" } }),
    );

    assert.deepEqual(links, [
      { label: "View automation", to: "/automations/aa7e0f5cc594" },
    ]);
  });

  it("sends a run to the console it belongs to, not to a page that does not exist", () => {
    const links = linksFor(event({ runId: "run_abc123", project: "virtara" }));

    assert.ok(links.some((link) => link.to === "/agent?project=virtara"));
    assert.ok(!links.some((link) => link.to.includes("run_abc123")));
  });

  it("offers nothing when there is nowhere to go", () => {
    assert.deepEqual(linksFor(event({ type: "vault.committed" })), []);
  });
});

describe("the expanded event", () => {
  const now = new Date(2026, 8, 7, 21, 0);

  it("always says when and who", () => {
    const labels = detailsFor(event(), now).map((detail) => detail.label);

    assert.deepEqual(labels.slice(0, 2), ["Time", "Source"]);
  });

  it("names metadata rather than showing its keys", () => {
    const details = detailsFor(
      event({ metadata: { stillOpen: 3, hash: "459bebb1" } }),
      now,
    );

    assert.ok(details.some((detail) => detail.label === "Still open" && detail.value === "3"));
    assert.ok(details.some((detail) => detail.label === "Commit"));
  });

  it("does not render structured metadata as a payload", () => {
    const details = detailsFor(
      event({ metadata: { nested: { a: 1 }, list: [1, 2] } }),
      now,
    );

    assert.ok(!details.some((detail) => detail.value.includes("{")));
    assert.ok(!details.some((detail) => detail.value.includes("[")));
  });
});
