import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ValidationFriction,
  ValidationTask,
  ValidationTaskView,
} from "../../../shared/validation-sprint-types";
import type { WorkerJob } from "../../../shared/worker-types";
import { joinTask, scoreSprint } from "../sprint";

/**
 * The sprint's arithmetic, tested where it could lie.
 *
 * Three failure modes matter, and all three are pure functions fed fixtures:
 * a gap in the evidence reported as a zero, a passing review of revision 3
 * counted as a first-pass success, and an override counted twice because it
 * was both recorded by a person and inferred from the routing.
 */

const task = (over: Partial<ValidationTask> = {}): ValidationTask => ({
  taskId: "vt_000000000001",
  project: "agentos",
  label: "Do the thing",
  startedAt: "2026-09-10T10:00:00.000Z",
  outcome: "in_progress",
  interventions: [],
  ...over,
});

const job = (over: Partial<WorkerJob> = {}): WorkerJob =>
  ({
    id: "job_0000000000000001",
    worker: "auto",
    project: "agentos",
    objective: "Do the thing",
    status: "completed",
    createdAt: "2026-09-10T10:00:00.000Z",
    ...over,
  }) as WorkerJob;

const friction = (over: Partial<ValidationFriction> = {}): ValidationFriction => ({
  id: "fr-1",
  reportedAt: "2026-09-10T10:30:00.000Z",
  category: "too_many_clicks",
  ...over,
});

describe("joining a task to its job", () => {
  it("leaves every derived figure unknown when there is no job", () => {
    const view = joinTask(task(), undefined, []);

    // The whole point: nothing here is `0`. A task nobody has delegated yet
    // has no cost and no duration, and reporting either as zero would say
    // something about the system that the record does not support.
    assert.equal(view.revisions, undefined);
    assert.equal(view.costUsd, undefined);
    assert.equal(view.workerDurationMs, undefined);
    assert.equal(view.totalDurationMs, undefined);
    assert.equal(view.firstPassReview, undefined);
    assert.equal(view.humanInterventions, 0);
  });

  it("counts a pass on the first attempt as a first-pass review", () => {
    const view = joinTask(
      task(),
      job({
        revision: 1,
        review: {
          jobId: "job_0000000000000001",
          verdict: "pass",
          summary: "Fine.",
          issues: [],
          acceptanceCriteria: [],
          reviewedAt: "2026-09-10T10:20:00.000Z",
          revision: 1,
        },
      }),
      [],
    );

    assert.equal(view.firstPassReview, true);
  });

  it("does not count a pass on a later revision as a first-pass review", () => {
    const view = joinTask(
      task(),
      job({
        revision: 3,
        review: {
          jobId: "job_0000000000000001",
          verdict: "pass",
          summary: "Fixed now.",
          issues: [],
          acceptanceCriteria: [],
          reviewedAt: "2026-09-10T11:20:00.000Z",
          revision: 3,
        },
      }),
      [],
    );

    assert.equal(view.firstPassReview, false);
    assert.equal(view.revisions, 3);
  });

  it("reports an override without adding it to the intervention count", () => {
    const view = joinTask(
      task(),
      job({
        resolvedWorker: "claude",
        requestedWorker: "claude",
        routing: {
          selectedWorker: "grok",
          confidence: "medium",
          reasons: ["Grok is faster on small changes"],
          decidedBy: "hermes",
          decidedAt: "2026-09-10T10:01:00.000Z",
        },
      }),
      [],
    );

    assert.equal(view.recommendedWorker, "grok");
    assert.equal(view.worker, "claude");
    assert.equal(view.routingOverridden, true);
    // Inferred, never counted. Mixing what was reported with what was derived
    // would make the headline metric impossible to read back.
    assert.equal(view.humanInterventions, 0);
  });

  it("attaches friction reported against the task or against its job", () => {
    const view = joinTask(
      task({ jobId: "job_0000000000000001" }),
      job(),
      [
        friction({ id: "fr-1", taskId: "vt_000000000001" }),
        friction({ id: "fr-2", jobId: "job_0000000000000001" }),
        friction({ id: "fr-3", taskId: "vt_000000000009" }),
      ],
    );

    assert.deepEqual(
      view.friction.map((entry) => entry.id),
      ["fr-1", "fr-2"],
    );
  });

  it("measures the operator's span and the worker's span separately", () => {
    const view = joinTask(
      task({
        startedAt: "2026-09-10T10:00:00.000Z",
        completedAt: "2026-09-10T10:42:00.000Z",
        outcome: "completed",
      }),
      job({
        startedAt: "2026-09-10T10:20:00.000Z",
        completedAt: "2026-09-10T10:31:00.000Z",
      }),
      [],
    );

    assert.equal(view.totalDurationMs, 42 * 60_000);
    assert.equal(view.workerDurationMs, 11 * 60_000);
  });
});

describe("scoring the sprint", () => {
  const view = (over: Partial<ValidationTaskView>): ValidationTaskView => ({
    ...task(),
    humanInterventions: 0,
    friction: [],
    ...over,
  });

  it("reports no rates at all for a sprint nothing has finished", () => {
    const score = scoreSprint([view({}), view({})], []);

    assert.equal(score.tasksAttempted, 2);
    assert.equal(score.completed, 0);
    assert.equal(score.firstPassReviewRate, undefined);
    assert.equal(score.avgRevisions, undefined);
    assert.equal(score.avgCompletionMs, undefined);
    assert.equal(score.totalCostUsd, undefined);
    assert.equal(score.tasksWithCost, 0);
  });

  it("says how many tasks a cost total actually covers", () => {
    const score = scoreSprint(
      [view({ costUsd: 3.5 }), view({ costUsd: 0.62 }), view({})],
      [],
    );

    assert.equal(score.totalCostUsd, 4.12);
    assert.equal(score.tasksWithCost, 2);
  });

  it("scores routing only over tasks a router actually decided", () => {
    const score = scoreSprint(
      [
        view({ recommendedWorker: "grok", routingOverridden: false }),
        view({ recommendedWorker: "grok", routingOverridden: true }),
        // Hand-picked. Says nothing about whether AUTO routing works.
        view({ worker: "claude" }),
      ],
      [],
    );

    assert.equal(score.routedTasks, 2);
    assert.equal(score.routingFollowed, 1);
  });

  it("tallies friction by category, worst first", () => {
    const score = scoreSprint(
      [],
      [
        friction({ id: "a", category: "missing_context" }),
        friction({ id: "b", category: "missing_context" }),
        friction({ id: "c", category: "too_slow" }),
      ],
    );

    assert.equal(score.frictionReports, 3);
    assert.deepEqual(score.frictionByCategory, [
      { category: "missing_context", count: 2 },
      { category: "too_slow", count: 1 },
    ]);
  });

  it("keeps manual takeover apart from abandonment", () => {
    const score = scoreSprint(
      [
        view({ outcome: "completed" }),
        view({ outcome: "manual_takeover" }),
        view({ outcome: "abandoned" }),
      ],
      [],
    );

    assert.equal(score.completed, 1);
    assert.equal(score.manualTakeover, 1);
    assert.equal(score.abandoned, 1);
  });

  it("sums recorded interventions across the sprint", () => {
    const score = scoreSprint(
      [view({ humanInterventions: 3 }), view({ humanInterventions: 4 })],
      [],
    );

    assert.equal(score.humanInterventions, 7);
  });
});
