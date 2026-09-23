import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

/**
 * The repository actions, against real git.
 *
 * These build actual repositories in a temp directory rather than stubbing
 * git, because every interesting case here — a dirty tree refusing a switch,
 * a stash carrying untracked files, a branch name git would read as a flag —
 * is a fact about git's behaviour, and a stub would only assert what this file
 * already believes.
 *
 * The property that matters most: **no action destroys uncommitted work.**
 * Every test that leaves changes behind checks they are still reachable.
 */

const run = promisify(execFile);

describe("repository actions", () => {
  let vault: string;
  let repo: string;
  let previousRoot: string | undefined;
  let repository: typeof import("../repository");
  let gitLayer: typeof import("../git");

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await run("git", args, { cwd: repo });
    return stdout.trim();
  }

  /** Puts the vault's PROJECT.md back to pointing at `repo`. */
  async function linkRepository(target = repo): Promise<void> {
    await fs.writeFile(
      path.join(vault, "projects", "demo", "PROJECT.md"),
      `# Demo\n\n## Connected Systems\n\n- Local repository: ${target}\n`,
    );
  }

  before(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-repo-vault-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-repo-work-"));

    previousRoot = process.env.AGENTOS_ROOT;
    process.env.AGENTOS_ROOT = vault;

    await fs.mkdir(path.join(vault, "projects", "demo"), { recursive: true });
    await linkRepository();

    await git("init", "-b", "main");
    await git("config", "user.email", "test@localhost");
    await git("config", "user.name", "Test");
    await fs.writeFile(path.join(repo, "README.md"), "# Demo\n");
    await git("add", "-A");
    await git("commit", "-m", "first");
    await git("branch", "feature/one");
    // A worker branch, which the view must not offer as somewhere to switch.
    await git("branch", "agentos-worker/job_123");

    repository = await import("../repository");
    gitLayer = await import("../git");
  });

  after(async () => {
    if (previousRoot === undefined) delete process.env.AGENTOS_ROOT;
    else process.env.AGENTOS_ROOT = previousRoot;

    await fs.rm(vault, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("reads the branch, the tree and the branch list", async () => {
    const status = await repository.readRepositoryStatus("demo");

    assert.equal(status.unavailable, undefined);
    assert.equal(status.branch, "main");
    assert.equal(status.workingTree, "clean");
    assert.deepEqual(
      status.branches.map((entry) => entry.name).sort(),
      ["feature/one", "main"],
    );
    assert.equal(status.branches.find((b) => b.name === "main")?.current, true);
  });

  it("keeps worker scratch branches out of the list", async () => {
    const status = await repository.readRepositoryStatus("demo");

    // `agentos-worker/*` is a job's scratch space, not somewhere a person
    // switches to. Listing them would bury the real branches.
    assert.ok(
      !status.branches.some((entry) => entry.name.startsWith("agentos-worker/")),
      "worker branches must not be offered",
    );
  });

  it("switches branches when the tree is clean", async () => {
    const result = await repository.runRepositoryAction("demo", {
      kind: "switch",
      branch: "feature/one",
    });

    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /Switched to feature\/one/);
    assert.equal(await git("branch", "--show-current"), "feature/one");
    // The action returns the new state, so the page does not need a second read.
    assert.equal(result.status?.branch, "feature/one");

    await git("checkout", "main");
  });

  it("refuses to switch with uncommitted changes, and changes nothing", async () => {
    await fs.writeFile(path.join(repo, "README.md"), "# Demo\n\nedited\n");

    const result = await repository.runRepositoryAction("demo", {
      kind: "switch",
      branch: "feature/one",
    });

    assert.equal(result.ok, false);
    assert.match(result.detail, /uncommitted change/);
    assert.equal(await git("branch", "--show-current"), "main");
    // The edit is untouched — refusing is not a reason to clean up after
    // somebody.
    assert.match(await fs.readFile(path.join(repo, "README.md"), "utf8"), /edited/);
  });

  it("stashes tracked and untracked work without losing either", async () => {
    await fs.writeFile(path.join(repo, "untracked.txt"), "new file\n");

    const result = await repository.runRepositoryAction("demo", {
      kind: "stash",
      message: "test stash",
    });

    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /Stashed 2 changes/);
    assert.equal(result.status?.workingTree, "clean");

    // The whole safety claim: nothing was destroyed, both files come back.
    await git("stash", "pop");
    assert.match(await fs.readFile(path.join(repo, "README.md"), "utf8"), /edited/);
    assert.equal(
      await fs.readFile(path.join(repo, "untracked.txt"), "utf8"),
      "new file\n",
    );
  });

  it("commits what is there and says how much", async () => {
    const result = await repository.runRepositoryAction("demo", {
      kind: "commit",
      message: "a real commit",
    });

    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /Committed 2 files on main/);
    assert.equal(await git("log", "-1", "--format=%s"), "a real commit");
    assert.equal(result.status?.workingTree, "clean");
  });

  it("refuses an empty commit and a commit with no message", async () => {
    const empty = await repository.runRepositoryAction("demo", {
      kind: "commit",
      message: "nothing here",
    });
    assert.equal(empty.ok, false);
    assert.match(empty.detail, /nothing to commit/i);

    const unnamed = await repository.runRepositoryAction("demo", {
      kind: "commit",
      message: "   ",
    });
    assert.equal(unnamed.ok, false);
    assert.match(unnamed.detail, /needs a message/);
  });

  it("refuses a stash when the tree is already clean", async () => {
    const result = await repository.runRepositoryAction("demo", { kind: "stash" });

    assert.equal(result.ok, false);
    assert.match(result.detail, /nothing to stash/i);
  });

  it("creates a branch and switches to it", async () => {
    const result = await repository.runRepositoryAction("demo", {
      kind: "branch",
      name: "feature/created-here",
    });

    assert.equal(result.ok, true, result.detail);
    assert.equal(await git("branch", "--show-current"), "feature/created-here");

    await git("checkout", "main");
  });

  it("refuses a branch name git would read as a flag, or that already exists", async () => {
    for (const name of ["--force", "-x", "/leading", "trailing/", "has space", ""]) {
      const result = await repository.runRepositoryAction("demo", {
        kind: "branch",
        name,
      });

      assert.equal(result.ok, false, `"${name}" must be refused`);
    }

    const taken = await repository.runRepositoryAction("demo", {
      kind: "branch",
      name: "feature/one",
    });

    assert.equal(taken.ok, false);
    assert.match(taken.detail, /already exists/);
  });

  it("refuses to switch to a branch that does not exist", async () => {
    const result = await repository.runRepositoryAction("demo", {
      kind: "switch",
      branch: "no/such/branch",
    });

    assert.equal(result.ok, false);
    assert.match(result.detail, /not a local branch/);
  });

  it("explains a project with no linked repository instead of failing", async () => {
    await fs.writeFile(
      path.join(vault, "projects", "demo", "PROJECT.md"),
      "# Demo\n\n## Purpose\n\nNothing linked.\n",
    );

    const status = await repository.readRepositoryStatus("demo");

    assert.match(status.unavailable ?? "", /No local repository is linked/);
    assert.deepEqual(status.branches, []);

    const action = await repository.runRepositoryAction("demo", { kind: "stash" });
    assert.equal(action.ok, false);
    assert.match(action.detail, /No local repository/);

    await linkRepository();
  });

  it("explains a linked path that is not a repository", async () => {
    const notRepo = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-not-repo-"));
    await linkRepository(notRepo);

    const status = await repository.readRepositoryStatus("demo");
    assert.match(status.unavailable ?? "", /not a git repository/);

    await linkRepository();
    await fs.rm(notRepo, { recursive: true, force: true });
  });

  it("reads recent commits newest first", async () => {
    const commits = await gitLayer.readRecentCommits(repo, 5);

    assert.ok(commits.length >= 2);
    assert.equal(commits[0].subject, "a real commit");
    assert.equal(commits[0].author, "Test");
    // ISO 8601, so the UI can sort and format without guessing.
    assert.match(commits[0].date, /^\d{4}-\d{2}-\d{2}T/);
  });
});
