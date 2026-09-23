import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readAutomationHealth,
  readAutomationRuns,
  readAutomations,
  readLastRun,
} from "../automations";

/**
 * Reading Hermes' scheduled jobs must survive the CLI changing how it prints
 * them. The format is not contractual, so an unfamiliar line is skipped and the
 * rest of the listing still reaches the console — a renamed row must never
 * empty the Automations screen or, worse, report a failing job as healthy.
 */

const LISTING = `
┌─────────────────────────────────────────────────────────────────────────┐
│                         Scheduled Jobs                                  │
└─────────────────────────────────────────────────────────────────────────┘

  aa7e0f5cc594 [active]
    Name:      AgentOS Morning Brief
    Schedule:  weekdays at 7:30am
    Repeat:    ∞
    Next run:  2026-09-08T07:30:00+02:00
    Deliver:   local
    Skills:    start-day, google-workspace
    Workdir:   /Users/dylanpetzer/AgentOS
    Last run:  2026-09-07T07:33:27.914016+02:00  ok
    Dispatch:  on time (scheduled 2026-09-07T07:30:00+02:00)
    Execution: completed  0f560bbb8a1f49f486c17acafc6261d1

  02a22006b25e [active]
    Name:      AgentOS Weekly Review
    Schedule:  every sunday at 6pm
    Repeat:    ∞
    Next run:  2026-09-13T18:00:00+02:00
    Deliver:   local
    Skills:    weekly-review
    Workdir:   /Users/dylanpetzer/AgentOS
    Last run:  2026-09-06T18:00:52.097664+02:00  ok
`;

describe("reading the job listing", () => {
  it("reads every job Hermes lists", () => {
    const automations = readAutomations(LISTING);

    assert.equal(automations.length, 2);
    assert.deepEqual(
      automations.map((automation) => automation.name),
      ["AgentOS Morning Brief", "AgentOS Weekly Review"],
    );
  });

  it("keeps Hermes' own wording for the schedule", () => {
    const [morning] = readAutomations(LISTING);

    assert.equal(morning.schedule, "weekdays at 7:30am");
    assert.equal(morning.nextRun, "2026-09-08T07:30:00+02:00");
  });

  it("reads the skill it runs, and every skill it loads", () => {
    const [morning] = readAutomations(LISTING);

    assert.equal(morning.skill, "start-day");
    assert.deepEqual(morning.skills, ["start-day", "google-workspace"]);
  });

  it("reads a timestamp that contains colons", () => {
    const [morning] = readAutomations(LISTING);

    assert.equal(morning.lastRun?.status, "success");
    assert.equal(morning.lastRun?.timestamp, "2026-09-07T07:33:27.914016+02:00");
  });
});

describe("job state", () => {
  function stateOf(badge: string) {
    return readAutomations(`  abc123 [${badge}]\n    Name:      A job\n`)[0];
  }

  it("reads active, paused, disabled and completed apart", () => {
    assert.equal(stateOf("active").state, "active");
    assert.equal(stateOf("paused").state, "paused");
    assert.equal(stateOf("disabled").state, "disabled");
    assert.equal(stateOf("completed").state, "completed");
  });

  it("only calls a job enabled when Hermes says it is active", () => {
    assert.equal(stateOf("active").enabled, true);
    assert.equal(stateOf("paused").enabled, false);
    assert.equal(stateOf("completed").enabled, false);
  });

  it("never claims an unfamiliar badge is running", () => {
    assert.equal(stateOf("draining").enabled, false);
  });
});

describe("tolerating an unfamiliar listing", () => {
  it("drops a job it cannot name and keeps the rest", () => {
    const automations = readAutomations(
      `  aaa [active]\n    Schedule:  hourly\n\n  bbb [active]\n    Name:      Real job\n`,
    );

    assert.deepEqual(
      automations.map((automation) => automation.id),
      ["bbb"],
    );
  });

  it("says the schedule is unknown rather than inventing one", () => {
    const [job] = readAutomations(`  aaa [active]\n    Name:      A job\n`);

    assert.equal(job.schedule, "Schedule unknown");
    assert.equal(job.nextRun, undefined);
    assert.equal(job.lastRun, undefined);
  });

  it("ignores a `?` placeholder", () => {
    const [job] = readAutomations(
      `  aaa [active]\n    Name:      A job\n    Next run:  ?\n`,
    );

    assert.equal(job.nextRun, undefined);
  });

  it("carries per-job warnings through untouched", () => {
    const [job] = readAutomations(
      `  aaa [active]\n    Name:      A job\n    ⚠ Delivery failed: telegram: 502\n`,
    );

    assert.deepEqual(job.warnings, ["⚠ Delivery failed: telegram: 502"]);
  });
});

describe("reading the last run", () => {
  it("reads `ok` as a success", () => {
    assert.deepEqual(readLastRun("2026-09-07T07:33:27+02:00  ok"), {
      status: "success",
      timestamp: "2026-09-07T07:33:27+02:00",
    });
  });

  it("keeps the failure reason Hermes gave", () => {
    const run = readLastRun(
      "2026-09-05T21:23:26+02:00  failed: HTTP 400: not a valid model ID",
    );

    assert.equal(run?.status, "failed");
    assert.equal(run?.detail, "failed: HTTP 400: not a valid model ID");
  });

  it("treats an undelivered result as a failure, not a success", () => {
    const run = readLastRun(
      "2026-09-01T07:00:00+00:00  delivery_failed: telegram: 502 Bad Gateway",
    );

    assert.equal(run?.status, "failed");
    assert.equal(run?.detail, "delivery_failed: telegram: 502 Bad Gateway");
  });

  it("reports nothing for a job that has never run", () => {
    assert.equal(readLastRun(undefined), undefined);
    assert.equal(readLastRun(""), undefined);
  });
});

describe("reading run history", () => {
  const HISTORY = `0f560bbb8a1f  completed  job=aa7e0f5cc594  source=builtin  2026-09-07T07:32:59+02:00
476f63e51965  failed     job=aa7e0f5cc594  source=direct  2026-09-05T21:23:26+02:00
    RuntimeError: HTTP 400: google/gemini-2.7-flash is not a valid model ID
c1d2e3f40506  running    job=aa7e0f5cc594  source=builtin  2026-09-05T21:20:00+02:00
`;

  it("reads every attempt", () => {
    assert.equal(readAutomationRuns(HISTORY).length, 3);
  });

  it("maps Hermes' execution statuses onto the three the console shows", () => {
    assert.deepEqual(
      readAutomationRuns(HISTORY).map((run) => run.status),
      ["success", "failed", "running"],
    );
  });

  it("attaches an error to the attempt it belongs to", () => {
    const [succeeded, failed] = readAutomationRuns(HISTORY);

    assert.equal(succeeded.error, undefined);
    assert.equal(
      failed.error,
      "RuntimeError: HTTP 400: google/gemini-2.7-flash is not a valid model ID",
    );
  });

  it("does not call an attempt of unknown outcome a success", () => {
    const [run] = readAutomationRuns(
      "abc  unknown  job=aaa  source=builtin  2026-09-05T21:20:00+02:00\n",
    );

    assert.equal(run.status, "failed");
    assert.equal(run.rawStatus, "unknown");
  });

  it("reads nothing from an empty history", () => {
    assert.deepEqual(readAutomationRuns("No cron execution attempts recorded.\n"), []);
  });
});

describe("reading health", () => {
  it("reports healthy only when the doctor says so", () => {
    assert.deepEqual(
      readAutomationHealth("✓ Cron doctor found no issues\n  Checked 2 active job(s).\n"),
      { ok: true, issues: [] },
    );
  });

  it("names the job each issue belongs to", () => {
    const health = readAutomationHealth(
      `Cron doctor found 2 issue(s) across 1 job(s):

  aa7e0f5cc594 AgentOS Morning Brief
    - next run is in the past
    - 3 failures in a row

Next: fix the listed job config, then run \`hermes cron doctor\` again.
`,
    );

    assert.equal(health.ok, false);
    assert.deepEqual(health.issues, [
      "AgentOS Morning Brief: next run is in the past",
      "AgentOS Morning Brief: 3 failures in a row",
    ]);
  });

  it("does not report a clean bill for output it cannot read", () => {
    assert.deepEqual(readAutomationHealth("something unfamiliar\n"), {
      ok: false,
      issues: [],
    });
  });
});
