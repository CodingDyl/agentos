import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-landing-state-"));
process.env.AGENTOS_UI_DIR = state;

const { approveJob, validateJob } = await import("../review");
const { landedAndInterrupted, reconcileInterruptedJobs } = await import("../job-manager");
const { createJobId, readJob, saveJob } = await import("../job-store");
const { changedSinceBranch } = await import("../worktree");

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  run("git", ["-c", "user.email=t@t", "-c", "user.name=T", ...args], { cwd }).then((r) => r.stdout.trim());
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Landing is the one step that cannot be repeated: once the work is on the
 * branch, a restart (landing server files restarts a dev server that watches
 * them) must not turn it into a failed job someone retries.
 */
describe("work that has landed survives a restart", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-landing-"));
  });

  after(() => {
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function repoWithJob(name: string, validationCommands: string[]): Promise<{ job: WorkerJob; repo: string }> {
    const repo = path.join(directory, name);
    fs.mkdirSync(repo, { recursive: true });
    await git(repo, "init", "-q", "-b", "main", ".");
    fs.writeFileSync(path.join(repo, "page.txt"), "one\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "init");
    const base = await git(repo, "rev-parse", "HEAD");

    const id = createJobId();
    const worktree = path.join(directory, `wt-${name}`);
    await git(repo, "worktree", "add", "-q", "-b", `agentos-worker/${id}`, worktree);
    fs.writeFileSync(path.join(worktree, "page.txt"), "one\ntwo\n");

    const job = {
      id,
      worker: "claude-code",
      resolvedWorker: "claude-code",
      project: "site",
      objective: "Change the page",
      status: "awaiting_review",
      createdAt: new Date().toISOString(),
      revision: 1,
      validationCommands,
      worktreePath: worktree,
      sourceRepoPath: repo,
      workerBranch: `agentos-worker/${id}`,
      baseCommit: base,
      targetBranch: "main",
      result: { summary: "Done.", changedFiles: [], tests: [{ command: "true", success: true }] },
      review: { jobId: id, verdict: "pass", summary: "Fine.", issues: [], acceptanceCriteria: [], reviewedAt: new Date().toISOString() },
    } as unknown as WorkerJob;
    await saveJob(job);
    return { job, repo };
  }

  it("records the landing before the check after it finishes", async () => {
    const { job } = await repoWithJob("records", ["sleep 2"]);

    const approving = approveJob(job.id);
    let seen: WorkerJob | undefined;
    for (let i = 0; i < 40 && !seen?.integratedCommit; i += 1) {
      await sleep(100);
      seen = await readJob(job.id);
    }

    assert.equal(seen?.status, "integrating", "still checking");
    assert.match(seen?.integratedCommit ?? "", /^[0-9a-f]{40}$/, "but the landing is already written down");
    assert.equal((await approving).ok, true);
    assert.equal((await readJob(job.id))?.status, "completed");
  });

  it("does not tell the operator to retry work that already landed", async () => {
    const { job, repo } = await repoWithJob("landed", ["true"]);
    const sha = await git(repo, "rev-parse", "HEAD");
    await saveJob({ ...job, status: "integrating", integratedCommit: sha });

    const interrupted = await reconcileInterruptedJobs("Nothing is executing this job");
    const swept = interrupted.find((entry) => entry.id === job.id);

    assert.equal(swept?.status, "failed");
    assert.match(swept?.error ?? "", /landed as/);
    assert.match(swept?.error ?? "", /Do not retry/);
    assert.doesNotMatch(swept?.error ?? "", /start a fresh run/);
    assert.equal(swept?.integratedCommit, sha, "the landing is kept");
    assert.deepEqual(landedAndInterrupted(interrupted).map((entry) => entry.id), [job.id]);
  });

  it("still tells the operator to retry work that never landed", async () => {
    const { job } = await repoWithJob("unlanded", ["true"]);
    await saveJob({ ...job, status: "integrating" });

    const interrupted = await reconcileInterruptedJobs("Nothing is executing this job");
    const swept = interrupted.find((entry) => entry.id === job.id);

    assert.match(swept?.error ?? "", /retry to start a fresh run/);
    assert.deepEqual(landedAndInterrupted([swept!]), []);
  });

  it("completes an interrupted landed job when its check is run again", async () => {
    const { job, repo } = await repoWithJob("recheck", ["true"]);
    assert.equal((await approveJob(job.id)).ok, true);
    const sha = (await readJob(job.id))?.integratedCommit;
    assert.ok(sha);

    // The state a restart leaves: landed, then marked failed by the sweep.
    const landed = await readJob(job.id);
    await saveJob({ ...landed!, status: "failed", error: "cut off", integratedCommit: sha });
    assert.equal(await git(repo, "rev-parse", "HEAD"), sha);

    const result = await validateJob(job.id);
    assert.equal(result.ok, true);
    assert.equal((await readJob(job.id))?.status, "completed");
  });
});

describe("what a checkout holds beyond its branch", () => {
  let directory: string;
  let repo: string;
  let worktree: string;

  before(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-changed-"));
    repo = path.join(directory, "repo");
    worktree = path.join(directory, "wt");
    fs.mkdirSync(repo);
    await git(repo, "init", "-q", "-b", "main", ".");
    fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "init");
    await git(repo, "worktree", "add", "-q", "-b", "agentos-worker/x", worktree);
  });

  after(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("is nothing for an untouched checkout", async () => {
    assert.deepEqual(await changedSinceBranch(worktree, repo), []);
  });

  it("counts work already committed on the checkout's branch, as a retry carrying kept work has", async () => {
    fs.writeFileSync(path.join(worktree, "kept.txt"), "kept\n");
    await git(worktree, "add", "-A");
    await git(worktree, "commit", "-qm", "kept work");

    assert.deepEqual(await changedSinceBranch(worktree, repo), ["kept.txt"]);
  });

  it("adds uncommitted edits to that, and ignores what the branch gained meanwhile", async () => {
    fs.writeFileSync(path.join(worktree, "new.txt"), "new\n");
    fs.writeFileSync(path.join(repo, "elsewhere.txt"), "landed meanwhile\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "sibling landed");

    assert.deepEqual((await changedSinceBranch(worktree, repo)).sort(), ["kept.txt", "new.txt"]);
  });
});
