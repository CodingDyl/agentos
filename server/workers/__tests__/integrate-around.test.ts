import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import type { WorkerJob } from "../../../shared/worker-types";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-around-state-"));
process.env.AGENTOS_UI_DIR = state;

const { approveJob, integrationBlockerDetails } = await import("../review");
const { createJobId, readJob, saveJob } = await import("../job-store");

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  run("git", ["-c", "user.email=t@t", "-c", "user.name=T", ...args], { cwd }).then((r) => r.stdout.trim());

/**
 * Approving work into a repository the operator is also editing. The vault is
 * exactly that: AgentOS and its operator write journal and task files while a
 * job's reviewed work waits to land.
 */
describe("landing reviewed work next to the operator's own edits", () => {
  let directory: string;
  let repo: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-around-"));
    repo = path.join(directory, "vault");
  });

  after(() => {
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  /** A vault with a site folder, a journal, and a job that has edited the site. */
  async function scenario(name: string, jobWrites: (worktree: string) => void): Promise<WorkerJob> {
    const vault = path.join(repo, name);
    fs.mkdirSync(path.join(vault, "projects/site"), { recursive: true });
    await git(vault, "init", "-q", "-b", "main", ".");
    fs.writeFileSync(path.join(vault, "projects/site/page.txt"), "one\ntwo\nthree\n");
    fs.writeFileSync(path.join(vault, "journal.md"), "# Journal\n");
    await git(vault, "add", "-A");
    await git(vault, "commit", "-qm", "init");
    const base = await git(vault, "rev-parse", "HEAD");

    const id = createJobId();
    const worktree = path.join(directory, `wt-${name}`);
    await git(vault, "worktree", "add", "-q", "-b", `agentos-worker/${id}`, worktree);
    jobWrites(worktree);

    const job = {
      id,
      worker: "claude-code",
      resolvedWorker: "claude-code",
      project: "site",
      objective: "Change the page",
      status: "awaiting_review",
      createdAt: new Date().toISOString(),
      revision: 1,
      validationCommands: ["true"],
      worktreePath: worktree,
      sourceRepoPath: vault,
      workerBranch: `agentos-worker/${id}`,
      baseCommit: base,
      targetBranch: "main",
      result: { summary: "Done.", changedFiles: [], tests: [{ command: "true", success: true }] },
      review: { jobId: id, verdict: "pass", summary: "Fine.", issues: [], acceptanceCriteria: [], reviewedAt: new Date().toISOString() },
    } as unknown as WorkerJob;
    await saveJob(job);
    return job;
  }

  it("is not blocked by uncommitted files the job does not touch", async () => {
    const job = await scenario("unrelated", (wt) => fs.writeFileSync(path.join(wt, "projects/site/page.txt"), "one\nTWO\nthree\n"));
    fs.appendFileSync(path.join(job.sourceRepoPath!, "journal.md"), "today I did things\n");

    assert.deepEqual(await integrationBlockerDetails(job), []);

    const result = await approveJob(job.id);
    assert.equal(result.ok, true);
    assert.match(fs.readFileSync(path.join(job.sourceRepoPath!, "projects/site/page.txt"), "utf8"), /TWO/);
    assert.match(fs.readFileSync(path.join(job.sourceRepoPath!, "journal.md"), "utf8"), /today I did things/, "the operator's edit is untouched");
  });

  it("offers to apply around edits to a file the job also changes, and keeps them", async () => {
    const job = await scenario("overlap", (wt) => fs.writeFileSync(path.join(wt, "projects/site/page.txt"), "ONE\ntwo\nthree\n"));
    // The operator edited a different line of the same file.
    fs.writeFileSync(path.join(job.sourceRepoPath!, "projects/site/page.txt"), "one\ntwo\nTHREE\n");

    const blockers = await integrationBlockerDetails(job);
    assert.equal(blockers.length, 1);
    assert.deepEqual(blockers[0].cure, { kind: "apply-around" });
    assert.match(blockers[0].message, /projects\/site\/page\.txt/);

    const plain = await approveJob(job.id);
    assert.equal(plain.ok, false, "plain approval still refuses rather than overwrite");

    const around = await approveJob(job.id, { aroundLocalChanges: true });
    assert.equal(around.ok, true);

    const merged = fs.readFileSync(path.join(job.sourceRepoPath!, "projects/site/page.txt"), "utf8");
    assert.equal(merged, "ONE\ntwo\nTHREE\n", "the job's change and the operator's both survive");
    assert.equal(await git(job.sourceRepoPath!, "stash", "list"), "", "nothing is left stashed");
    assert.equal((await readJob(job.id))?.status, "completed");
  });

  it("keeps the operator's edits recoverable when both changed the same line", async () => {
    const job = await scenario("conflict", (wt) => fs.writeFileSync(path.join(wt, "projects/site/page.txt"), "ONE\ntwo\nthree\n"));
    fs.writeFileSync(path.join(job.sourceRepoPath!, "projects/site/page.txt"), "uno\ntwo\nthree\n");

    await approveJob(job.id, { aroundLocalChanges: true });

    assert.match(await git(job.sourceRepoPath!, "stash", "list"), /AgentOS: set aside/, "the edit is still in the stash");
    assert.match(fs.readFileSync(path.join(job.sourceRepoPath!, "projects/site/page.txt"), "utf8"), /<<<<<<<|ONE/);
  });

  it("lands a retry that has nothing new to commit", async () => {
    const job = await scenario("clean-retry", () => undefined);
    const wt = job.worktreePath!;
    fs.writeFileSync(path.join(wt, "projects/site/page.txt"), "one\ntwo\nfour\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-qm", "earlier attempt's saved work");

    const result = await approveJob(job.id);

    assert.equal(result.ok, true, result.ok ? "" : (result.error ?? ""));
    assert.match(fs.readFileSync(path.join(job.sourceRepoPath!, "projects/site/page.txt"), "utf8"), /four/);
  });
});
