import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../../../shared/agentos-types";
import type { WorkerJob } from "../../../shared/worker-types";
import { activeJobs, activeRuns, buildActiveWork } from "../active-work";

/**
 * "Active now" is only worth having if it is true now.
 *
 * The two failure modes it must not have: claiming something is running when
 * it stopped, and inferring activity from a record that was never written. A
 * Hermes run's ending is reported by whoever holds its event stream, so a
 * closed tab leaves a start with no end — and that is not evidence.
 */

const NOW = new Date("2026-09-10T10:00:00.000Z");

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: "job_aaaaaaaaaaaaaaaa",
    worker: "grok",
    resolvedWorker: "grok",
    project: "pantry-pilot",
    objective: "Implement recipe search caching",
    status: "running",
    createdAt: "2026-09-10T09:50:00.000Z",
    startedAt: "2026-09-10T09:53:00.000Z",
    ...overrides,
  } as WorkerJob;
}

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "e1",
    timestamp: "2026-09-10T09:58:00.000Z",
    source: "hermes",
    level: "info",
    type: "run.started",
    title: "Hermes run started",
    ...overrides,
  } as ActivityEvent;
}

describe("worker jobs that are executing", () => {
  it("includes work at every stage that is actually doing something", () => {
    const stages = [
      "running",
      "validating",
      "visual_validating",
      "reviewing",
      "integrating",
    ] as const;

    for (const status of stages) {
      assert.equal(activeJobs([job({ status })]).length, 1, status);
    }
  });

  it("excludes work that is waiting on a person", () => {
    // A job parked for review is the operator's problem, not a running one.
    assert.deepEqual(activeJobs([job({ status: "awaiting_review" })]), []);
    assert.deepEqual(activeJobs([job({ status: "changes_required" })]), []);
    assert.deepEqual(activeJobs([job({ status: "completed" })]), []);
  });

  it("names the stage rather than the status word", () => {
    const [item] = activeJobs([job({ status: "visual_validating" })]);

    assert.equal(item.detail, "Photographing the implementation");
    assert.equal(item.actor, "GROK");
  });

  it("marks a job nothing is executing as uncertain", () => {
    // Recorded as running with no live process: the usual cause is a restart,
    // and claiming it is live would be the one lie this section cannot afford.
    const [item] = activeJobs([job()]);

    assert.equal(item.uncertain, true);
  });
});

describe("Hermes runs, inferred from the log", () => {
  it("shows a run that started and has not reported finishing", () => {
    const items = activeRuns(
      [event({ runId: "run_1", description: "Plan the chef flow" })],
      NOW,
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].actor, "HERMES");
    assert.equal(items[0].title, "Plan the chef flow");
  });

  it("drops a run once its ending was reported", () => {
    const items = activeRuns(
      [
        event({ id: "e1", runId: "run_1" }),
        event({ id: "e2", runId: "run_1", type: "run.completed" }),
      ],
      NOW,
    );

    assert.deepEqual(items, []);
  });

  it("drops a run that failed or was cancelled", () => {
    for (const type of ["run.failed", "run.cancelled"]) {
      const items = activeRuns(
        [
          event({ id: "e1", runId: "run_1" }),
          event({ id: "e2", runId: "run_1", type }),
        ],
        NOW,
      );

      assert.deepEqual(items, [], type);
    }
  });

  it("hedges on a run that has been open a long time", () => {
    const items = activeRuns(
      [event({ runId: "run_1", timestamp: "2026-09-10T09:00:00.000Z" })],
      NOW,
    );

    // An hour with no ending is more likely a closed tab than a long run.
    assert.equal(items[0].uncertain, true);
  });

  it("is confident about a run that has just started", () => {
    const items = activeRuns(
      [event({ runId: "run_1", timestamp: "2026-09-10T09:58:00.000Z" })],
      NOW,
    );

    assert.equal(items[0].uncertain, false);
  });

  it("forgets a run old enough that its ending was certainly lost", () => {
    const items = activeRuns(
      [event({ runId: "run_1", timestamp: "2026-09-09T20:00:00.000Z" })],
      NOW,
    );

    // Showing this would be inventing activity, which is worse than omitting it.
    assert.deepEqual(items, []);
  });

  it("ignores a start with no run id, which cannot be paired", () => {
    assert.deepEqual(activeRuns([event({ runId: undefined })], NOW), []);
  });
});

describe("everything running together", () => {
  it("reads newest first — the thing that just started is the news", () => {
    const items = buildActiveWork(
      [job({ startedAt: "2026-09-10T09:30:00.000Z" })],
      [event({ runId: "run_1", timestamp: "2026-09-10T09:55:00.000Z" })],
      NOW,
    );

    assert.deepEqual(
      items.map((item) => item.actor),
      ["HERMES", "GROK"],
    );
  });

  it("is empty when nothing is happening, which is a real answer", () => {
    assert.deepEqual(
      buildActiveWork([job({ status: "completed" })], [], NOW),
      [],
    );
  });
});
