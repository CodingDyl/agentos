import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { clearSidecarBuildCache } from "../../agentos/metadata-files";

const run = promisify(execFile);

describe("a macOS-damaged build cache", () => {
  it("is cleared when sidecar files are inside it, and left alone otherwise", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-cache-"));
    try {
      await fs.mkdir(path.join(dir, ".next", "cache"), { recursive: true });
      await fs.writeFile(path.join(dir, ".next", "cache", "data"), "x");
      assert.equal(await clearSidecarBuildCache(dir), false);
      await fs.access(path.join(dir, ".next", "cache", "data"));

      await fs.writeFile(path.join(dir, ".next", "cache", "._data"), "sidecar");
      assert.equal(await clearSidecarBuildCache(dir), true);
      await assert.rejects(fs.access(path.join(dir, ".next")));
      assert.equal(await clearSidecarBuildCache(dir), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("bringing a reviewed job up to date", () => {
  let ui: string;
  let repo: string;
  let previousUi: string | undefined;
  let review: typeof import("../review");
  let store: typeof import("../job-store");
  let worktrees: typeof import("../worktree");

  const git = async (cwd: string, ...args: string[]) => (await run("git", args, { cwd })).stdout.trim();

  async function waitingJob(id: string, base: string) {
    const created = await worktrees.createWorktree(repo, id, base);
    await store.saveJob({
      id,
      worker: "mock",
      requestedWorker: "mock",
      resolvedWorker: "mock",
      project: "demo",
      objective: "Do a thing",
      status: "awaiting_review",
      revision: 1,
      createdAt: new Date().toISOString(),
      repoPath: repo,
      sourceRepoPath: repo,
      worktreePath: created.path,
      baseCommit: created.baseRef,
      targetBranch: "main",
      review: { jobId: id, verdict: "pass", summary: "ok", issues: [], acceptanceCriteria: [], reviewedAt: new Date().toISOString() },
      validationCommands: [],
    } as never);
    return created;
  }

  async function land(file: string, contents: string) {
    await fs.writeFile(path.join(repo, file), contents);
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", `land ${file}`);
    return git(repo, "rev-parse", "HEAD");
  }

  before(async () => {
    ui = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-update-ui-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-update-repo-"));
    previousUi = process.env.AGENTOS_UI_DIR;
    process.env.AGENTOS_UI_DIR = ui;

    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "t@localhost");
    await git(repo, "config", "user.name", "T");
    await fs.writeFile(path.join(repo, "shared.txt"), "one\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-m", "first");

    review = await import("../review");
    store = await import("../job-store");
    worktrees = await import("../worktree");
  });

  after(async () => {
    if (previousUi === undefined) delete process.env.AGENTOS_UI_DIR;
    else process.env.AGENTOS_UI_DIR = previousUi;
    await fs.rm(ui, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("merges the newer work in, clears the review, and makes the result fast-forwardable", async () => {
    const base = await git(repo, "rev-parse", "HEAD");
    const created = await waitingJob("job_update0000000000", base);
    await fs.writeFile(path.join(created.path, "feature.txt"), "the reviewed change");

    const latest = await land("sibling.txt", "landed by a sibling");
    const result = await review.updateJobToLatest("job_update0000000000");

    assert.ok(result.ok, result.error ?? "");
    const job = await store.readJob("job_update0000000000");
    assert.equal(job?.baseCommit, latest);
    assert.equal(job?.review, undefined);
    assert.equal(job?.reviewHistory?.length, 1);
    assert.equal(job?.status, "awaiting_review");
    await fs.access(path.join(created.path, "feature.txt"));
    await fs.access(path.join(created.path, "sibling.txt"));

    // A second request has nothing to do.
    assert.equal((await review.updateJobToLatest("job_update0000000000")).ok, false);

    // The branch's head is in the job's history, so landing it is a fast-forward.
    await git(repo, "merge", "--ff-only", created.branch);
    assert.equal(await fs.readFile(path.join(repo, "feature.txt"), "utf8"), "the reviewed change");
  });

  it("abandons a conflicting merge and leaves the job as it was", async () => {
    const base = await git(repo, "rev-parse", "HEAD");
    const created = await waitingJob("job_conflict000000000", base);
    await fs.writeFile(path.join(created.path, "shared.txt"), "worker version\n");

    await land("shared.txt", "branch version\n");
    const result = await review.updateJobToLatest("job_conflict000000000");

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /shared\.txt/);
    assert.equal(await fs.readFile(path.join(created.path, "shared.txt"), "utf8"), "worker version\n");
    assert.equal((await git(created.path, "status", "--porcelain")).includes("UU"), false);
    assert.equal((await store.readJob("job_conflict000000000"))?.review?.verdict, "pass");
  });
});
