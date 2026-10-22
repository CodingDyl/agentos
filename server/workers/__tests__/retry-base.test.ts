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

  it("closes a job that was waiting on review when its replacement starts", async () => {
    const head = await git(repo, "rev-parse", "HEAD");
    await failedJobAt("job_waiting0000000000", head);
    const waiting = await store.readJob("job_waiting0000000000");
    await store.saveJob({ ...waiting!, status: "awaiting_review" } as never);

    const { job: replacement } = await manager.retryJob("job_waiting0000000000");
    assert.ok(replacement);
    await settle(replacement.id);

    assert.equal((await store.readJob("job_waiting0000000000"))?.status, "cancelled");
    assert.ok((await store.readEvents("job_waiting0000000000")).some((event) => event.message?.includes(replacement.id)));
  });

  it("treats a fast-forward pull as a new base, not as the worker's work", async () => {
    const head = await git(repo, "rev-parse", "HEAD");
    const created = await worktrees.createWorktree(repo, "job_pull000000000000", head);

    await fs.writeFile(path.join(repo, "landed.txt"), "from a sibling job");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "sibling landed");
    const latest = await git(repo, "rev-parse", "HEAD");

    assert.equal(await worktrees.pulledBase(created.path, head), undefined);
    await git(created.path, "merge", "--ff-only", latest);
    assert.equal(await worktrees.pulledBase(created.path, head), latest);
    assert.equal(await worktrees.pulledBase(created.path, latest), undefined);
  });

  it("starts from the branch as it is now when the kept work is on a base that has moved", async () => {
    const head = await git(repo, "rev-parse", "HEAD");
    const created = await failedJobAt("job_stale00000000000", head);
    await fs.writeFile(path.join(created.path, "half-done.txt"), "partial work");

    await fs.writeFile(path.join(repo, "later.txt"), "landed after the attempt began");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "landed meanwhile");
    const current = await git(repo, "rev-parse", "HEAD");

    const { job: retried } = await manager.retryJob("job_stale00000000000");
    assert.ok(retried);
    await settle(retried.id);

    const persisted = await store.readJob(retried.id);
    assert.equal(persisted?.baseCommit, current);
    await fs.access(path.join(persisted!.worktreePath!, "later.txt"));
    // The old work is not thrown away; the worker is told where it is.
    assert.ok(persisted?.constraints?.some((line) => line.includes("kept on branch")));
  });

  it("does not keep pinning retries to a stale base when nothing new was kept", async () => {
    const head = await git(repo, "rev-parse", "HEAD");
    const created = await failedJobAt("job_pinned0000000000", head);
    const saved = await store.readJob("job_pinned0000000000");
    // A retry that was itself cut from an earlier attempt's kept work, and then kept nothing.
    await store.saveJob({ ...saved!, baseRef: head } as never);

    await fs.writeFile(path.join(repo, "newer.txt"), "landed afterwards");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "landed again");
    const current = await git(repo, "rev-parse", "HEAD");
    void created;

    const { job: retried } = await manager.retryJob("job_pinned0000000000");
    assert.ok(retried);
    await settle(retried.id);

    assert.equal((await store.readJob(retried.id))?.baseCommit, current);
  });

  it("retries against the project's current Local repository after the folder moved", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-retry-vault-"));
    const currentRepo = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-retry-moved-"));
    const gone = path.join(os.tmpdir(), `agentos-gone-site-${Date.now()}`);
    const previousRoot = process.env.AGENTOS_ROOT;
    try {
      await git(currentRepo, "init", "-b", "main");
      await git(currentRepo, "config", "user.email", "t@localhost");
      await git(currentRepo, "config", "user.name", "T");
      await fs.writeFile(path.join(currentRepo, "README.md"), "# Bosch\n");
      await git(currentRepo, "add", "-A");
      await git(currentRepo, "commit", "-m", "site");

      process.env.AGENTOS_ROOT = vault;
      await fs.mkdir(path.join(vault, "projects", "bosch"), { recursive: true });
      await fs.writeFile(
        path.join(vault, "projects", "bosch", "PROJECT.md"),
        `# Bosch\n\n## Connected Systems\n\n- Local repository: ${currentRepo}\n`,
      );

      await store.saveJob({
        id: "job_moved00000000000",
        worker: "mock",
        requestedWorker: "mock",
        resolvedWorker: "mock",
        project: "bosch",
        objective: "Do a thing",
        status: "failed",
        revision: 1,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        repoPath: gone,
        sourceRepoPath: gone,
      } as never);

      const { job: retried, error } = await manager.retryJob("job_moved00000000000");
      assert.equal(error, undefined);
      assert.ok(retried);
      await settle(retried.id);

      const persisted = await store.readJob(retried.id);
      assert.equal(persisted?.repoPath, path.resolve(currentRepo));
      assert.equal(persisted?.sourceRepoPath, path.resolve(currentRepo));
    } finally {
      if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
      else process.env.AGENTOS_ROOT = previousRoot;
      await fs.rm(vault, { recursive: true, force: true });
      await fs.rm(currentRepo, { recursive: true, force: true });
    }
  });
});
