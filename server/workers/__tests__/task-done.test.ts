import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

const TASKS = `# Tasks

## Now

- [ ] [DM-001] Build the thing
- [ ] [DM-002] Another thing

## Next

## Later

## Done
`;

describe("marking a task done when its job lands", () => {
  let vault: string;
  let ui: string;
  let previous: { root?: string; ui?: string };
  let markTaskDone: typeof import("../task-done").markTaskDone;
  let links: typeof import("../../agentos/task-jobs");

  const job = (id: string, project = "demo") => ({ id, project, objective: "x" }) as unknown as WorkerJob;
  const tasks = () => fs.readFile(path.join(vault, "projects", "demo", "TASKS.md"), "utf8");

  before(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-done-vault-"));
    ui = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-done-ui-"));
    previous = { root: process.env.AGENTOS_ROOT, ui: process.env.AGENTOS_UI_DIR };
    process.env.AGENTOS_ROOT = vault;
    process.env.AGENTOS_UI_DIR = ui;
    await fs.mkdir(path.join(vault, "projects", "demo"), { recursive: true });
    await fs.writeFile(path.join(vault, "projects", "demo", "TASKS.md"), TASKS);

    markTaskDone = (await import("../task-done")).markTaskDone;
    links = await import("../../agentos/task-jobs");
  });

  after(async () => {
    if (previous.root === undefined) delete process.env.AGENTOS_ROOT;
    else process.env.AGENTOS_ROOT = previous.root;
    if (previous.ui === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previous.ui;
    await Promise.all([vault, ui].map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("ticks the delegated task and moves it to Done, leaving the others", async () => {
    await links.saveTaskLink({ project: "demo", taskId: "DM-001", jobId: "job_a", delegatedAt: new Date().toISOString() });

    const result = await markTaskDone(job("job_a"));
    assert.deepEqual(result, { marked: true, taskId: "DM-001" });

    const text = await tasks();
    assert.match(text, /## Done[\s\S]*\[x\] \[DM-001\]/);
    assert.match(text, /## Now[\s\S]*\[ \] \[DM-002\]/);
    assert.ok(!/## Now[\s\S]*DM-001[\s\S]*## Next/.test(text), "DM-001 left Now");
    assert.ok((await links.readTaskLink("demo", "DM-001"))?.completedAt);
  });

  it("is harmless when run twice", async () => {
    const again = await markTaskDone(job("job_a"));
    assert.equal(again.marked, true);
    assert.equal((await tasks()).match(/DM-001/g)?.length, 1);
  });

  it("does nothing for a job that belongs to no task", async () => {
    assert.deepEqual(await markTaskDone(job("job_chat")), { marked: false });
  });

  it("reports a task that is no longer in TASKS.md instead of throwing", async () => {
    await links.saveTaskLink({ project: "demo", taskId: "DM-099", jobId: "job_gone", delegatedAt: new Date().toISOString() });
    const result = await markTaskDone(job("job_gone"));
    assert.equal(result.marked, false);
    assert.match(result.error ?? "", /DM-099/);
  });
});
