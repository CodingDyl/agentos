import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDuration,
  isFinished,
  statusLabel,
  toSteps,
  visualAcceptanceProblem,
} from "../workers-model";

/**
 * The activity list is how an operator knows what a worker is doing. Its one
 * obligation is not to flatter: work still in flight must not read as finished,
 * and work that never reported completion must not be quietly ticked.
 */

let counter = 0;

function event(type: string, message?: string) {
  counter += 1;
  return { id: `e${counter}`, type, message };
}

describe("folding events into steps", () => {
  it("collapses a started/completed pair into one line", () => {
    const steps = toSteps(
      [event("validation.started", "npm test"), event("validation.completed", "npm test — passed")],
      true,
    );

    assert.equal(steps.length, 1);
    assert.equal(steps[0].state, "done");
    // The completion is the more informative wording of the two.
    assert.equal(steps[0].label, "npm test — passed");
  });

  it("pairs by family, not by wording", () => {
    // A worker rarely closes a step with the words it opened it with.
    const steps = toSteps(
      [event("tool.started", "Planning the change"), event("tool.completed", "Plan ready")],
      true,
    );

    assert.equal(steps.length, 1);
    assert.equal(steps[0].state, "done");
  });

  it("does not leave the lifecycle marker spinning forever", () => {
    // Nothing ever "completes" job.started, so showing it as running would be
    // a permanent lie.
    const steps = toSteps([event("job.started", "Mock picked up the job")], false);

    assert.equal(steps[0].state, "done");
  });

  it("keeps a step running while it genuinely is", () => {
    const steps = toSteps(
      [event("job.started", "Picked up"), event("tool.started", "Implementing")],
      false,
    );

    assert.equal(steps[1].state, "running");
  });

  it("marks unfinished work as unfinished once the job is over", () => {
    // A job cannot end with work still in flight; the step is shown as never
    // having completed rather than being ticked off.
    const steps = toSteps(
      [event("tool.started", "Implementing"), event("job.cancelled", "Cancelled")],
      true,
    );

    assert.equal(steps[0].state, "failed");
  });

  it("shows a failure as a failure", () => {
    const steps = toSteps([event("job.failed", "Something broke")], true);

    assert.equal(steps[0].state, "failed");
  });

  it("closes the most recent open step of its family", () => {
    const steps = toSteps(
      [
        event("validation.started", "npm run lint"),
        event("validation.completed", "npm run lint — done"),
        event("validation.started", "npm test"),
        event("validation.completed", "npm test — done"),
      ],
      true,
    );

    assert.deepEqual(
      steps.map((step) => step.label),
      ["npm run lint — done", "npm test — done"],
    );
    assert.ok(steps.every((step) => step.state === "done"));
  });

  it("keeps a completion it cannot pair, rather than dropping it", () => {
    const steps = toSteps([event("validation.completed", "npm test — done")], true);

    assert.equal(steps.length, 1);
    assert.equal(steps[0].state, "done");
  });

  it("has nothing to show for a job that has reported nothing", () => {
    assert.deepEqual(toSteps([], false), []);
  });
});

describe("how a job's state reads", () => {
  it("keeps cancellation apart from failure", () => {
    // A cancellation is a decision, not a fault.
    assert.equal(statusLabel("cancelled"), "Cancelled");
    assert.equal(statusLabel("failed"), "Failed");
  });

  it("knows which states are the end of the road", () => {
    assert.equal(isFinished("completed"), true);
    assert.equal(isFinished("cancelled"), true);
    assert.equal(isFinished("running"), false);
    assert.equal(isFinished("queued"), false);
  });
});

describe("how long it took", () => {
  const started = "2026-09-08T10:00:00Z";

  it("counts up while a job is still going", () => {
    assert.equal(
      formatDuration(started, undefined, new Date("2026-09-08T10:00:42Z")),
      "42s",
    );
  });

  it("reports what a finished job actually took", () => {
    assert.equal(formatDuration(started, "2026-09-08T10:03:20Z"), "3m 20s");
    assert.equal(formatDuration(started, "2026-09-08T12:30:00Z"), "2h 30m");
  });

  it("says nothing about a job that never started", () => {
    assert.equal(formatDuration(undefined, undefined), undefined);
  });

  it("says nothing rather than guessing at unreadable times", () => {
    assert.equal(formatDuration("whenever", undefined), undefined);
  });
});

describe("whether a visual contract is ready to send", () => {
  const route = {
    path: "/designs",
    expectedPageId: "designs",
    viewports: [{ name: "desktop", width: 1440, height: 1000 }],
  };

  it("has nothing to say about work that is not being verified", () => {
    assert.equal(visualAcceptanceProblem(undefined), undefined);
    assert.equal(
      visualAcceptanceProblem({ enabled: false, routes: [] }),
      undefined,
    );
  });

  it("passes a contract with a complete route", () => {
    assert.equal(
      visualAcceptanceProblem({ enabled: true, routes: [route] }),
      undefined,
    );
  });

  it("refuses verification that was turned on and left empty", () => {
    const problem = visualAcceptanceProblem({ enabled: true, routes: [] });

    assert.ok(problem);
    assert.match(problem, /no routes/i);
  });

  it("refuses a route with no expected page", () => {
    // The adapter parses this strictly and drops what it cannot read, so an
    // incomplete route would quietly turn verification off rather than fail.
    const problem = visualAcceptanceProblem({
      enabled: true,
      routes: [{ ...route, expectedPageId: "" }],
    });

    assert.ok(problem);
    assert.match(problem, /expected page id/i);
  });

  it("refuses a route with no path", () => {
    const problem = visualAcceptanceProblem({
      enabled: true,
      routes: [{ ...route, path: "   " }],
    });

    assert.ok(problem);
  });

  it("counts how many routes are incomplete", () => {
    const problem = visualAcceptanceProblem({
      enabled: true,
      routes: [route, { ...route, expectedPageId: "" }, { ...route, path: "" }],
    });

    assert.match(problem ?? "", /^2 routes/);
  });
});

describe("jobTitle", () => {
  it("uses the first line of a long brief, cut to a readable length", async () => {
    const { jobTitle } = await import("../workers-model");
    assert.equal(jobTitle("Research how Watergate compares.\n\nClient: Watergate\n- Do not run git commit."), "Research how Watergate compares.");
    assert.equal(jobTitle("x".repeat(200)).length, 140);
    assert.ok(jobTitle("x".repeat(200)).endsWith("…"));
    assert.equal(jobTitle("\n\n  Short objective  "), "Short objective");
  });
});
