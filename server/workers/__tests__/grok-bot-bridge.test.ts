import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import type { WorkerJob } from "../../../shared/worker-types";

const run = promisify(execFile);

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

  describe("with a repository", () => {
    let repo: string;
    const git = (cwd: string, ...args: string[]) => run("git", ["-c", "user.email=t@t", "-c", "user.name=T", ...args], { cwd });

    before(async () => {
      repo = path.join(directory, "repo");
      await fs.mkdir(repo);
      await git(repo, "init", "-q", ".");
      await fs.writeFile(path.join(repo, "app.txt"), "before\n");
      await git(repo, "add", "-A");
      await git(repo, "commit", "-qm", "init");
    });

    /** Starts a job and waits until it is parked, with Grok's side of it to hand. */
    async function parked(extra: Record<string, unknown> = {}) {
      const { job, error } = await manager.startJob({
        worker: "grok-bot",
        project: "agentos",
        objective: "Change app.txt",
        repoPath: repo,
        modelRouteType: "execute",
        validationCommands: ["test -f app.txt"],
        ...extra,
      });
      assert.equal(error, undefined);
      assert.ok(job);
      const waiting = await until(job.id, (entry) => entry.status === "waiting" && Boolean(entry.bridge), "parked");
      return { id: job.id, job: waiting, info: waiting.bridge!, tree: waiting.worktreePath! };
    }

    const answer = (info: { taskId: string; resultPath: string }, jobId: string, reply = "Changed app.txt.") =>
      fs.writeFile(info.resultPath, JSON.stringify({ schemaVersion: 1, taskId: info.taskId, jobId, status: "completed", reply }));

    it("gives an execute job its own worktree, with permission to edit only there", async () => {
      const { id, job, info, tree } = await parked();

      assert.equal(path.dirname(tree), path.join(process.env.AGENTOS_UI_DIR!, "worktrees"));
      assert.equal(job.workerBranch, `agentos-worker/${id}`);
      assert.equal(info.worktree?.access, "read-write");
      assert.equal(info.worktree?.path, tree);

      const task = JSON.parse(await fs.readFile(info.taskPath, "utf8"));
      assert.equal(task.worktree.access, "read-write");
      assert.equal(task.worktree.workingDirectory, tree);
      assert.equal(task.worktree.branch, job.workerBranch);
      assert.ok(task.worktree.rules.some((rule: string) => /only inside it/.test(rule)));
      assert.equal(task.result.path, info.resultPath);

      assert.ok(info.instruction.includes(tree));
      assert.ok(info.instruction.includes(info.resultPath), "the result file is still written");
      assert.match(info.instruction, /Edit files only inside it/);
      assert.match(info.instruction, /Do not hand the work to a cloud agent/);
      assert.doesNotMatch(info.instruction, /Write nothing else/);

      await manager.cancelJob(id);
    });

    it("sends Grok's edits down the normal path: changed files, validation, review", async () => {
      const { id, info, tree } = await parked();

      await fs.writeFile(path.join(tree, "app.txt"), "after\n");
      assert.equal(await fs.readFile(path.join(repo, "app.txt"), "utf8"), "before\n", "the live checkout is untouched");
      await answer(info, id);

      const done = await until(id, (entry) => entry.status === "awaiting_review", "in review");
      assert.deepEqual(done.result?.changedFiles, ["app.txt"]);
      assert.equal(done.result?.worktreePath, tree);
      assert.deepEqual(done.result?.tests?.map((entry) => [entry.command, entry.success]), [["test -f app.txt", true]]);
      assert.equal(done.result?.summary, "Changed app.txt.");
    });

    it("fails an execute job whose reply claims work the worktree does not show", async () => {
      const { id, info } = await parked();
      await answer(info, id, "Done, see the PR.");

      const done = await until(id, (entry) => entry.status === "failed", "failed");
      assert.match(done.error ?? "", /no file changes/);
      assert.equal(done.attempts?.at(-1)?.failureReason, done.error);
    });

    it("fails a job when Grok commits, and keeps the work", async () => {
      const { id, info, tree } = await parked();
      await fs.writeFile(path.join(tree, "app.txt"), "committed\n");
      await git(tree, "add", "-A");
      await git(tree, "commit", "-qm", "not allowed");
      await answer(info, id);

      const done = await until(id, (entry) => entry.status === "failed", "failed");
      assert.match(done.error ?? "", /leave work uncommitted/);
      assert.equal(await fs.readFile(path.join(tree, "app.txt"), "utf8"), "committed\n");
    });

    it("fails a job when Grok leaves the worktree on another branch", async () => {
      const { id, info, tree } = await parked();
      await git(tree, "switch", "-q", "-c", "somewhere-else");
      await answer(info, id);

      const done = await until(id, (entry) => entry.status === "failed", "failed");
      assert.match(done.error ?? "", /on branch somewhere-else/);
    });

    it("keeps a report-only job read-only, and fails it if files change", async () => {
      const clean = await parked({ reportOnly: true });
      assert.equal(clean.info.worktree?.access, "read-only");
      assert.match(clean.info.instruction, /change nothing/);
      assert.match(clean.info.instruction, /Write nothing else/);
      assert.equal(JSON.parse(await fs.readFile(clean.info.taskPath, "utf8")).worktree.access, "read-only");
      await answer(clean.info, clean.id, "The report.");
      const reported = await until(clean.id, (entry) => entry.status === "awaiting_review", "report in review");
      assert.equal(reported.result?.summary, "The report.");

      const dirty = await parked({ reportOnly: true });
      await fs.writeFile(path.join(dirty.tree, "app.txt"), "should not\n");
      await answer(dirty.info, dirty.id, "The report.");
      const failed = await until(dirty.id, (entry) => entry.status === "failed", "report failed");
      assert.match(failed.error ?? "", /report-only/);
    });

    it("exports a new task for a revision instead of re-accepting the old result", async () => {
      const { id, info, tree } = await parked();
      await fs.writeFile(path.join(tree, "app.txt"), "first\n");
      await answer(info, id);
      const reviewed = await until(id, (entry) => entry.status === "awaiting_review", "in review");

      const { ok } = await manager.rerunJob(reviewed, "Please also add a second line.");
      assert.ok(ok);
      const again = await until(id, (entry) => entry.status === "waiting" && entry.bridge?.taskId !== info.taskId, "re-exported");
      const next = again.bridge!;
      assert.equal(next.worktree?.path, tree, "the same checkout");
      assert.equal(next.importedAt, undefined);
      assert.match(JSON.parse(await fs.readFile(next.taskPath, "utf8")).brief, /second line/);

      await fs.writeFile(path.join(tree, "app.txt"), "first\nsecond\n");
      await answer(next, id, "Added the second line.");
      const done = await until(id, (entry) => entry.status === "awaiting_review", "revision in review");
      assert.equal(done.result?.summary, "Added the second line.");
    });

    it("leaves the checkout alone when a restart resumes the wait", async () => {
      const { id, info, tree } = await parked();
      await fs.writeFile(path.join(tree, "app.txt"), "mid-edit\n");

      // The source moves on while Grok is working. A resume must not pull that in.
      await fs.writeFile(path.join(repo, "later.txt"), "later\n");
      await git(repo, "add", "-A");
      await git(repo, "commit", "-qm", "later");

      await manager.interruptRunningJobs("test restart");
      await manager.reconcileInterruptedJobs("test restart");
      await until(id, (entry) => manager.isRunning(id) && entry.status === "waiting", "resumed");
      await assert.rejects(fs.access(path.join(tree, "later.txt")));

      await answer(info, id);
      const done = await until(id, (entry) => entry.status === "awaiting_review", "in review");
      assert.ok(done.result?.changedFiles?.includes("app.txt"));
    });

    it("lands approved work in the source repository", async () => {
      const { id, info, tree } = await parked();
      await fs.writeFile(path.join(tree, "app.txt"), "landed\n");
      await answer(info, id);
      const reviewed = await until(id, (entry) => entry.status === "awaiting_review", "in review");

      // Hermes' verdict is a model call, so it is supplied. What it unlocks is the real path.
      await store.saveJob({
        ...reviewed,
        review: { jobId: id, verdict: "pass", summary: "Fine.", issues: [], acceptanceCriteria: [], reviewedAt: new Date().toISOString() },
      } as WorkerJob);
      const { approveJob } = await import("../review");
      const landed = await approveJob(id);

      assert.equal(landed.ok, true, JSON.stringify(landed));
      assert.equal(await fs.readFile(path.join(repo, "app.txt"), "utf8"), "landed\n");
      assert.equal((await store.readJob(id))?.status, "completed");
    });

    it("refuses to hand Grok a path that is not an AgentOS worktree", async () => {
      await assert.rejects(bridge.worktreeForExport({}, repo, repo), /not an AgentOS worktree/);
    });
  });

  it("gives a job with no repository no worktree, and the original instruction", async () => {
    const { job } = await manager.startJob({ worker: "grok-bot", project: "agentos", objective: "Summarise again" });
    assert.ok(job);
    const waiting = await until(job.id, (entry) => entry.status === "waiting" && Boolean(entry.bridge), "parked");
    assert.equal(waiting.worktreePath, undefined);
    assert.equal(waiting.bridge?.worktree, undefined);
    assert.match(waiting.bridge!.instruction, /Write nothing else/);
    assert.equal(JSON.parse(await fs.readFile(waiting.bridge!.taskPath, "utf8")).worktree, undefined);
    await manager.cancelJob(job.id);
  });

  it("never offers Grok Bot to automatic routing", async () => {
    const { routing } = await manager.resolveWorkerId("auto", { objective: "Research local AI tools", project: "agentos" });
    assert.notEqual(routing?.selectedWorker, "grok-bot");
  });
});
