import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

/**
 * The Grok Bot bridge end to end, against temporary folders: a task goes out
 * with only the selected notes, bad results are refused without ending the
 * wait, an unplugged SSD pauses rather than fails, a restart resumes, and a
 * valid result lands in review.
 */

describe("grok bot bridge", () => {
  let directory: string;
  let workspace: string;
  let vault: string;
  let manager: typeof import("../job-manager");
  let store: typeof import("../job-store");
  let bridge: typeof import("../grok-bot-bridge");
  const saved = { ui: process.env.AGENTOS_UI_DIR, poll: process.env.AGENTOS_GROK_BOT_POLL_MS };

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-grok-bridge-"));
    process.env.AGENTOS_UI_DIR = path.join(directory, "ui");
    process.env.AGENTOS_GROK_BOT_POLL_MS = "20";

    workspace = path.join(directory, "ssd", "grok");
    for (const folder of ["memory", "tasks", "results"]) await fs.mkdir(path.join(workspace, folder), { recursive: true });

    vault = path.join(directory, "vault");
    await fs.mkdir(path.join(vault, "projects", "agentos"), { recursive: true });
    await fs.writeFile(path.join(vault, "projects", "agentos", "PROJECT.md"), "# AgentOS\nSelected.\n");
    await fs.writeFile(path.join(vault, "private.md"), "# Not selected\n");

    const settings = await import("../../ai-stack/settings");
    settings.setAiEnabled("grok-bot", true);
    settings.setGrokBotWorkspace(workspace);

    manager = await import("../job-manager");
    store = await import("../job-store");
    bridge = await import("../grok-bot-bridge");
  });

  after(async () => {
    process.env.AGENTOS_UI_DIR = saved.ui;
    if (saved.poll === undefined) delete process.env.AGENTOS_GROK_BOT_POLL_MS;
    else process.env.AGENTOS_GROK_BOT_POLL_MS = saved.poll;
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function until(jobId: string, test: (job: WorkerJob) => boolean, label: string): Promise<WorkerJob> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const job = await store.readJob(jobId);
      if (job && test(job)) return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  it("exports only the selected notes, with source paths and timestamps", async () => {
    const memoryDir = path.join(workspace, "memory", "export-only");
    const job = {
      id: "job_export",
      memoryContext: {
        status: "ok",
        retrievedAt: new Date().toISOString(),
        vaultRoot: vault,
        budgetTokens: 1,
        usedTokens: 1,
        query: "q",
        sources: [
          { path: "projects/agentos/PROJECT.md", hash: "x", modifiedAt: "", reason: "required", chars: 1, truncated: false },
          { path: "projects/agentos/PROJECT.md", heading: "Again", hash: "x", modifiedAt: "", reason: "search", chars: 1, truncated: false },
          { path: "../escape.md", hash: "x", modifiedAt: "", reason: "search", chars: 1, truncated: false },
        ],
        missing: [],
        warnings: [],
        text: "",
      },
    } as unknown as WorkerJob;

    const { notes, skipped } = await bridge.exportNotes(job, memoryDir, "2026-09-30T10:00:00.000Z");

    assert.equal(notes.length, 1);
    assert.equal(notes[0].source, "projects/agentos/PROJECT.md");
    assert.equal(notes[0].exportedAt, "2026-09-30T10:00:00.000Z");
    assert.equal(await fs.readFile(path.join(memoryDir, "projects/agentos/PROJECT.md"), "utf8"), "# AgentOS\nSelected.\n");
    assert.deepEqual(skipped.map((entry) => entry.source), ["../escape.md"]);
    await assert.rejects(fs.access(path.join(memoryDir, "private.md")));

    const manifest = JSON.parse(await fs.readFile(path.join(memoryDir, "manifest.json"), "utf8"));
    assert.equal(manifest.notes[0].source, "projects/agentos/PROJECT.md");
    assert.equal(manifest.notes[0].exportedPath, "projects/agentos/PROJECT.md");
  });

  it("parks, refuses bad results, survives an unplugged SSD and a restart, then imports into review", async () => {
    const { job, error } = await manager.startJob({ worker: "grok-bot", project: "agentos", objective: "Summarise the plan" });
    assert.equal(error, undefined);
    assert.ok(job);

    const parked = await until(job.id, (entry) => entry.status === "waiting" && Boolean(entry.bridge), "parked");
    const info = parked.bridge!;
    const task = JSON.parse(await fs.readFile(info.taskPath, "utf8"));
    assert.equal(task.taskId, info.taskId);
    assert.equal(task.jobId, job.id);
    assert.equal(task.result.path, info.resultPath);
    assert.ok(info.instruction.includes(info.taskPath) && info.instruction.includes(info.resultPath));

    const write = (body: unknown) =>
      fs.writeFile(info.resultPath, typeof body === "string" ? body : JSON.stringify(body));
    const valid = { schemaVersion: 1, taskId: info.taskId, jobId: job.id, status: "completed", reply: "The plan, summarised." };

    // Half-written, then answering the wrong job: both refused, job still waiting.
    await write("{\"schemaVersion\": 1, \"ta");
    await until(job.id, (entry) => /not valid JSON/.test(entry.bridge?.rejection?.reason ?? ""), "invalid refused");
    await write({ ...valid, jobId: "job_someone_else" });
    const refused = await until(job.id, (entry) => /names job job_someone_else/.test(entry.bridge?.rejection?.reason ?? ""), "wrong job refused");
    assert.equal(refused.status, "waiting");
    await fs.rm(info.resultPath);

    // The SSD goes: paused, not failed, and nothing is recreated.
    const unplugged = `${workspace}-unplugged`;
    await fs.rename(workspace, unplugged);
    const paused = await until(job.id, (entry) => Boolean(entry.bridge?.workspaceUnavailableSince), "unavailable");
    assert.equal(paused.status, "waiting");
    await assert.rejects(fs.access(workspace));
    await fs.rename(unplugged, workspace);
    await until(job.id, (entry) => !entry.bridge?.workspaceUnavailableSince, "back");

    // A restart: shutdown leaves it parked, boot resumes the wait.
    await manager.interruptRunningJobs("test restart");
    assert.equal(manager.isRunning(job.id), false);
    assert.equal((await store.readJob(job.id))?.status, "waiting");
    const interrupted = await manager.reconcileInterruptedJobs("test restart");
    assert.ok(!interrupted.some((entry) => entry.id === job.id));
    await until(job.id, () => manager.isRunning(job.id), "resumed");

    // A valid answer lands in review, once.
    await write(valid);
    const done = await until(job.id, (entry) => entry.status === "awaiting_review", "imported");
    assert.equal(done.result?.summary, "The plan, summarised.");
    assert.ok(done.bridge?.importedAt && done.bridge.resultHash);
    assert.equal(done.bridge?.taskId, info.taskId);
  });

  it("never offers Grok Bot to automatic routing", async () => {
    const { routing } = await manager.resolveWorkerId("auto", { objective: "Research local AI tools", project: "agentos" });
    assert.notEqual(routing?.selectedWorker, "grok-bot");
  });
});
