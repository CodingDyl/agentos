import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { closeLearningDatabase } from "../../learning/db";
import { advanceBuild, startTaskWith, type BuildDeps } from "../build";
import { createIdea, updateIdea } from "../store";

after(() => closeLearningDatabase());

const plan = [1, 2].map((n) => ({ title: `Task ${n}`, objective: `Do ${n}`, acceptanceCriteria: [`${n} works`] }));

function building(sourceId: string) {
  const idea = createIdea({ id: sourceId, externalId: "dQw4w9WgXcQ", title: sourceId }, "assess");
  return updateIdea(idea.id, { stage: "building", plan, taskIds: ["FEATURE-10", "FEATURE-11"], currentTask: 0 });
}

function fakes(statuses: Record<string, string>) {
  const started: string[] = [];
  const deps: BuildDeps = {
    start: async (taskId) => {
      started.push(taskId);
      return { jobId: `job-${taskId}` };
    },
    status: async (jobId) => statuses[jobId],
    merged: async () => false,
  };
  return { deps, started };
}

describe("the build queue", () => {
  it("starts the first task", async () => {
    const { deps, started } = fakes({});
    const next = await advanceBuild(building("ls-b1"), deps);
    assert.deepEqual(started, ["FEATURE-10"]);
    assert.equal(next.jobId, "job-FEATURE-10");
    assert.equal(next.runs.at(-1)?.taskId, "FEATURE-10");
  });

  it("waits while a task runs or waits for review", async () => {
    for (const status of ["running", "awaiting_review", "approved"]) {
      const { deps, started } = fakes({ "job-FEATURE-10": status });
      const idea = updateIdea(building(`ls-b2-${status}`).id, { jobId: "job-FEATURE-10" });
      const next = await advanceBuild(idea, deps);
      assert.deepEqual(started, []);
      assert.equal(next.stage, "building");
      assert.equal(next.currentTask, 0);
    }
  });

  it("starts the next task only once the last one is merged", async () => {
    const { deps, started } = fakes({ "job-FEATURE-10": "completed" });
    const idea = updateIdea(building("ls-b3").id, { jobId: "job-FEATURE-10" });
    const next = await advanceBuild(idea, deps);
    assert.deepEqual(started, ["FEATURE-11"]);
    assert.equal(next.currentTask, 1);
    assert.equal(next.jobId, "job-FEATURE-11");
  });

  it("is built after the last task merges", async () => {
    const { deps } = fakes({ "job-FEATURE-11": "completed" });
    const idea = updateIdea(building("ls-b4").id, { currentTask: 1, jobId: "job-FEATURE-11" });
    const next = await advanceBuild(idea, deps);
    assert.equal(next.stage, "built");
  });

  it("pauses when a task fails or is cancelled, and starts nothing after it", async () => {
    for (const status of ["failed", "cancelled", "rejected"]) {
      const { deps, started } = fakes({ "job-FEATURE-10": status });
      const idea = updateIdea(building(`ls-b5-${status}`).id, { jobId: "job-FEATURE-10" });
      const next = await advanceBuild(idea, deps);
      assert.deepEqual(started, []);
      assert.equal(next.stage, "failed");
      assert.equal(next.failedAt, "building");
      assert.equal(next.error, `FEATURE-10 stopped (${status}) — retry it from Workers, then press Resume`);
    }
  });

  it("fails when a task cannot be started", async () => {
    const deps: BuildDeps = { start: async () => ({ error: "No worker" }), status: async () => undefined, merged: async () => false };
    const next = await advanceBuild(building("ls-b6"), deps);
    assert.equal(next.stage, "failed");
    assert.equal(next.error, "FEATURE-10 could not start: No worker");
  });

  it("counts a task whose merge restarted the server as done", async () => {
    const { deps, started } = fakes({ "job-FEATURE-10": "failed" });
    deps.merged = async (jobId) => jobId === "job-FEATURE-10";
    const idea = updateIdea(building("ls-b7").id, { jobId: "job-FEATURE-10" });
    const next = await advanceBuild(idea, deps);
    assert.deepEqual(started, ["FEATURE-11"]);
    assert.equal(next.stage, "building");
  });

  it("carries on with a task already merged from Workers instead of building it again", async () => {
    let delegated = false;
    const result = await startTaskWith("FEATURE-10", undefined, {
      active: async () => undefined,
      linked: async () => ({ id: "job-retried", status: "completed" }),
      delegate: async () => {
        delegated = true;
        return { jobId: "job-new" };
      },
    });
    assert.deepEqual(result, { jobId: "job-retried" });
    assert.equal(delegated, false);
  });
});
