import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Where a retry starts.
 *
 * Eight jobs once started together, before the task that scaffolds the project
 * had landed. Every one of them was cut from a base without it, and a retry of
 * one that had changed nothing was cut from that same base again, so
 * `npm run build` could never pass. A retry that carries no work must start
 * from where the source branch is now; one that carries work keeps it.
 */
describe("where a retry starts", () => {
  let ui: string;
  let repo: string;
  let previousUi: string | undefined;
  let manager: typeof import("../job-manager");
  let store: typeof import("../job-store");
  let worktrees: typeof import("../worktree");

  const git = async (cwd: string, ...args: string[]) => (await run("git", args, { cwd })).stdout.trim();

  async function failedJobAt(id: string, base: string) {
    const created = await worktrees.createWorktree(repo, id, base);
    await store.saveJob({
      id,
      worker: "mock",
      requestedWorker: "mock",
      resolvedWorker: "mock",
      project: "demo",
      objective: "Do a thing",
      status: "failed",
      revision: 1,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      repoPath: repo,
      sourceRepoPath: repo,
      worktreePath: created.path,
      baseCommit: created.baseRef,
    } as never);
    return created;
  }

  async function settle(id: string) {
    for (let i = 0; i < 200 && manager.isRunning(id); i += 1) await new Promise((r) => setTimeout(r, 50));
  }

  before(async () => {
    ui = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-retry-ui-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-retry-repo-"));
    previousUi = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = ui;

    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "t@localhost");
    await git(repo, "config", "user.name", "T");
    await fs.writeFile(path.join(repo, "index.html"), "old static site");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "static site");

    manager = await import("../job-manager");
    store = await import("../job-store");
    worktrees = await import("../worktree");
  });

  after(async () => {
    if (previousUi === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previousUi;
    await fs.rm(ui, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("starts an attempt that changed nothing from the branch as it is now", async () => {
    const stale = await git(repo, "rev-parse", "HEAD");
    await failedJobAt("job_nowork0000000000", stale);

    // A sibling job lands the scaffold the stale attempt never saw.
    await fs.writeFile(path.join(repo, "package.json"), "{}");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "scaffold");
    const current = await git(repo, "rev-parse", "HEAD");

    const { job: retried, error } = await manager.retryJob("job_nowork0000000000");
    assert.equal(error, undefined);
    assert.ok(retried);
    await settle(retried.id);

    const persisted = await store.readJob(retried.id);
    assert.equal(persisted?.baseCommit, current);
    await fs.access(path.join(persisted!.worktreePath!, "package.json"));
  });

  it("still carries an attempt's unfinished work", async () => {
    const head = await git(repo, "rev-parse", "HEAD");
    const created = await failedJobAt("job_haswork0000000000", head);
    await fs.writeFile(path.join(created.path, "half-done.txt"), "partial work");

    const { job: retried, error } = await manager.retryJob("job_haswork0000000000");
    assert.equal(error, undefined);
    assert.ok(retried);
    await settle(retried.id);

    const persisted = await store.readJob(retried.id);
    assert.notEqual(persisted?.baseCommit, head);
    assert.equal(await fs.readFile(path.join(persisted!.worktreePath!, "half-done.txt"), "utf8"), "partial work");
  });
});
