import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

describe("the task queue", () => {
  let directory: string;
  let previous: string | undefined;
  let queue: typeof import("../milestone-queue");

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-queue-"));
    previous = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = directory;
    queue = await import("../milestone-queue");
  });

  after(async () => {
    if (previous === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  });

  const task = (taskId: string) => ({ taskId }) as never;

  it("holds tasks behind a job, per project", async () => {
    await queue.queueTasks("Bosch", "job_1", [task("BO-002"), task("BO-003")]);

    const held = await queue.readTaskQueue("bosch");
    assert.equal(held?.waitingOn, "job_1");
    assert.deepEqual(held?.pending.map((entry) => entry.taskId), ["BO-002", "BO-003"]);
    assert.equal(await queue.readTaskQueue("croft-co"), undefined);
  });

  it("releases nothing when a different job lands", async () => {
    assert.equal(await queue.releaseNextTask("bosch", "job_other"), undefined);
    assert.equal((await queue.readTaskQueue("bosch"))?.pending.length, 2);
  });

  it("forgets a queue that is emptied or cleared", async () => {
    assert.equal(await queue.clearTaskQueue("bosch"), 2);
    assert.equal(await queue.readTaskQueue("bosch"), undefined);

    await queue.queueTasks("bosch", "job_1", []);
    assert.equal(await queue.readTaskQueue("bosch"), undefined);
  });
});
