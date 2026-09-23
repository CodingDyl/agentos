import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Automation } from "@shared/agentos-types";
import {
  commandFor,
  countActive,
  describeAlert,
  formatRunStamp,
  formatRunTime,
  formatSchedule,
  labelFor,
  needsAttention,
  selectAlerts,
  statusFor,
} from "../automations-model";

/**
 * The Automations screen states what Hermes is doing on its own. It must never
 * flatter that state: a failing schedule reads as attention, and a job that was
 * deliberately turned off does not read as a problem.
 */

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "aa7e0f5cc594",
    name: "Morning Brief",
    schedule: "weekdays at 7:30am",
    enabled: true,
    state: "active",
    skill: "start-day",
    skills: ["start-day"],
    warnings: [],
    ...overrides,
  };
}

describe("what needs attention", () => {
  it("leaves a healthy schedule alone", () => {
    assert.equal(
      needsAttention(
        automation({ lastRun: { status: "success", timestamp: "2026-09-07T07:30:00" } }),
      ),
      false,
    );
  });

  it("flags a schedule whose last run failed", () => {
    assert.equal(
      needsAttention(
        automation({ lastRun: { status: "failed", timestamp: "2026-09-07T07:30:00" } }),
      ),
      true,
    );
  });

  it("flags a warning Hermes raised, even when the last run succeeded", () => {
    assert.equal(
      needsAttention(
        automation({
          lastRun: { status: "success", timestamp: "2026-09-07T07:30:00" },
          warnings: ["⚠ Missed scheduled fire"],
        }),
      ),
      true,
    );
  });

  it("does not call a job you turned off a problem", () => {
    const failed = { status: "failed" as const, timestamp: "2026-09-07T07:30:00" };

    assert.equal(needsAttention(automation({ state: "disabled", lastRun: failed })), false);
    assert.equal(needsAttention(automation({ state: "completed", lastRun: failed })), false);
  });

  it("still flags a paused job that failed", () => {
    assert.equal(
      needsAttention(
        automation({
          state: "paused",
          lastRun: { status: "failed", timestamp: "2026-09-07T07:30:00" },
        }),
      ),
      true,
    );
  });

  it("selects only the automations asking for something", () => {
    const alerts = selectAlerts([
      automation({ id: "ok", lastRun: { status: "success", timestamp: "x" } }),
      automation({ id: "bad", lastRun: { status: "failed", timestamp: "x" } }),
    ]);

    assert.deepEqual(
      alerts.map((entry) => entry.id),
      ["bad"],
    );
  });
});

describe("how state reads", () => {
  it("shows a failing schedule as attention, not as active", () => {
    assert.equal(
      statusFor(automation({ lastRun: { status: "failed", timestamp: "x" } })),
      "attention",
    );
  });

  it("keeps paused and disabled apart in words", () => {
    assert.equal(labelFor(automation({ state: "paused" })), "Paused");
    assert.equal(labelFor(automation({ state: "disabled" })), "Disabled");
    assert.equal(labelFor(automation({ state: "completed" })), "Finished");
  });

  it("never labels an attention state 'Active' — the dot must have words", () => {
    assert.equal(
      labelFor(automation({ lastRun: { status: "failed", timestamp: "x" } })),
      "Failing",
    );
    assert.equal(
      labelFor(automation({ warnings: ["⚠ Missed scheduled fire"] })),
      "Attention",
    );
  });

  it("sets Hermes' schedule wording as a sentence", () => {
    assert.equal(formatSchedule("weekdays at 7:30am"), "Weekdays at 7:30am");
    assert.equal(formatSchedule("Every sunday at 6pm"), "Every sunday at 6pm");
    assert.equal(formatSchedule(""), "");
  });

  it("counts only what Hermes will actually run", () => {
    assert.equal(
      countActive([
        automation({ enabled: true }),
        automation({ enabled: false, state: "paused" }),
      ]),
      1,
    );
  });
});

describe("naming a moment", () => {
  const now = new Date(2026, 8, 7, 9, 0); // 7 Sep 2026, 09:00 local

  it("names today, tomorrow and yesterday", () => {
    assert.match(formatRunTime(new Date(2026, 8, 7, 18, 0).toISOString(), now)!, /^Today · /);
    assert.match(formatRunTime(new Date(2026, 8, 8, 7, 30).toISOString(), now)!, /^Tomorrow · /);
    assert.match(formatRunTime(new Date(2026, 8, 6, 18, 0).toISOString(), now)!, /^Yesterday · /);
  });

  it("uses a weekday inside the coming week", () => {
    const label = formatRunTime(new Date(2026, 8, 13, 18, 0).toISOString(), now)!;

    assert.match(label, /^Sun · /);
  });

  it("falls back to a date further out", () => {
    const label = formatRunTime(new Date(2026, 9, 20, 18, 0).toISOString(), now)!;

    assert.ok(label.includes("Oct"), `expected a dated label, got ${label}`);
  });

  it("reports the time in 24-hour form", () => {
    assert.ok(
      formatRunTime(new Date(2026, 8, 8, 7, 30).toISOString(), now)!.endsWith("07:30"),
    );
  });

  it("says nothing when there is nothing to say", () => {
    assert.equal(formatRunTime(undefined, now), undefined);
    assert.equal(formatRunTime("not a timestamp", now), undefined);
  });
});

describe("history stamps", () => {
  const now = new Date(2026, 8, 7, 9, 0);

  it("always carries a date, never a relative word", () => {
    const stamp = formatRunStamp(new Date(2026, 8, 7, 7, 33).toISOString(), now);

    assert.ok(stamp.includes("Sep"), stamp);
    assert.ok(stamp.endsWith("07:33"), stamp);
  });

  it("names the year once a run is from another one", () => {
    const stamp = formatRunStamp(new Date(2025, 11, 24, 7, 30).toISOString(), now);

    assert.ok(stamp.includes("2025"), stamp);
  });

  it("shows an unreadable timestamp rather than hiding it", () => {
    assert.equal(formatRunStamp("whenever", now), "whenever");
  });
});

describe("what Home is told", () => {
  const now = new Date(2026, 8, 7, 9, 0);

  it("says when the failure happened and what Hermes said", () => {
    const alert = describeAlert(
      automation({
        lastRun: {
          status: "failed",
          timestamp: new Date(2026, 8, 7, 7, 33).toISOString(),
          detail: "failed: HTTP 400",
        },
      }),
      now,
    );

    assert.equal(alert.name, "Morning Brief");
    assert.equal(alert.summary, "Last run failed · Today · 07:33");
    assert.equal(alert.detail, "failed: HTTP 400");
  });

  it("links to the automation that failed", () => {
    const alert = describeAlert(automation(), now);

    assert.equal(alert.href, "/automations/aa7e0f5cc594");
  });

  it("falls back to a warning when there is no failed run", () => {
    const alert = describeAlert(
      automation({
        lastRun: { status: "success", timestamp: new Date(2026, 8, 7, 7, 33).toISOString() },
        warnings: ["⚠ Missed scheduled fire"],
      }),
      now,
    );

    assert.equal(alert.summary, "Needs attention");
    assert.equal(alert.detail, "⚠ Missed scheduled fire");
  });
});

describe("running one by hand", () => {
  it("builds the command from the skill Hermes runs", () => {
    assert.equal(commandFor(automation()), "/start-day");
  });

  it("offers no command for a job that runs no skill", () => {
    assert.equal(commandFor(automation({ skill: undefined, skills: [] })), undefined);
  });
});
