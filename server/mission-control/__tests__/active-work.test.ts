import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../../../shared/agentos-types";
import type { OperatorRun } from "../../../shared/operator-types";
import type { WorkerJob } from "../../../shared/worker-types";
import { activeJobs, activeOperatorRuns, activeRuns, buildActiveWork } from "../active-work";

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

function operatorRun(overrides: Partial<OperatorRun> = {}): OperatorRun {
  return {
    id: "run_00000000-0000-0000-0000-000000000000",
    input: "Set up a landing page for Pantry Pilot",
    mode: "run",
    objective: "Landing page for Pantry Pilot",
    plan: [],
    risks: [],
    agents: [],
    connectors: [],
    status: "running",
    changes: [],
    memoryProposals: [],
    taskProposals: [],
    jobIds: [],
    errors: [],
    usage: { modelCalls: 0, estimate: "" },
    startedAt: "2026-09-10T09:56:00.000Z",
    ...overrides,
  } as OperatorRun;
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

  it("names the worker by id, so a screen can light the right agent", () => {
    assert.equal(activeJobs([job()])[0].agent, "grok");
    assert.equal(activeJobs([job({ worker: "claude-code", resolvedWorker: undefined })])[0].agent, "claude-code");
  });

  it("points at no agent while the job is still on automatic selection", () => {
    // `auto` is a request for a worker, not one; lighting a node for it would be a guess.
    const [item] = activeJobs([job({ worker: "auto", resolvedWorker: undefined, status: "queued" })]);
    assert.equal(item.agent, undefined);
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
    assert.equal(items[0].agent, "hermes");
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

describe("Operator runs", () => {
  it("shows a run that is planning or running, linked to its own page", () => {
    for (const status of ["planning", "running"] as const) {
      const [item] = activeOperatorRuns([operatorRun({ status })]);
      assert.equal(item.agent, "operator", status);
      assert.equal(item.href, "/operator/runs/run_00000000-0000-0000-0000-000000000000");
      assert.equal(item.title, "Landing page for Pantry Pilot");
    }
  });

  it("leaves out a run that is waiting on a person or finished", () => {
    for (const status of ["awaiting_approval", "blocked", "completed", "failed", "stopped"] as const) {
      assert.deepEqual(activeOperatorRuns([operatorRun({ status })]), [], status);
    }
  });

  it("marks a run this process is not working on as uncertain", () => {
    // Saved as running, but no live copy: the usual cause is a restart.
    assert.equal(activeOperatorRuns([operatorRun()])[0].uncertain, true);
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

  it("includes Operator runs alongside jobs and Hermes runs", () => {
    const items = buildActiveWork(
      [job({ startedAt: "2026-09-10T09:30:00.000Z" })],
      [event({ runId: "run_1", timestamp: "2026-09-10T09:55:00.000Z" })],
      NOW,
      [operatorRun({ startedAt: "2026-09-10T09:59:00.000Z" })],
    );

    assert.deepEqual(
      items.map((item) => item.agent),
      ["operator", "hermes", "grok"],
    );
  });

  it("does not double-count a run whose start appears in two sources", () => {
    const start = event({ runId: "run_1" });
    assert.equal(buildActiveWork([], [start, { ...start, id: "e9" }], NOW).length, 1);
  });

  it("is empty when nothing is happening, which is a real answer", () => {
    assert.deepEqual(
      buildActiveWork([job({ status: "completed" })], [], NOW),
      [],
    );
  });
});
