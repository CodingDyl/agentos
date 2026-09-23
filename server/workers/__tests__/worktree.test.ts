import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { changedFiles, isRepository } from "../worktree";

/**
 * What a job reports as changed is read from git, and is the list a person
 * reviews. These check it says what actually changed — every file, named.
 */

const run = promisify(execFile);

describe("what git says changed", () => {
  let directory: string;
  let repo: string;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-worktree-"));
    repo = path.join(directory, "repo");

    await fs.mkdir(repo, { recursive: true });
    await run("git", ["init", "-q", "-b", "main", "."], { cwd: repo });
    await fs.writeFile(path.join(repo, "README.md"), "# Test\n", "utf8");
    await run("git", ["add", "-A"], { cwd: repo });
    await run(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qm", "init"],
      { cwd: repo },
    );
  });

  after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("names every file in a newly created directory", async () => {
    await fs.mkdir(path.join(repo, "tmp/nested"), { recursive: true });
    await fs.writeFile(path.join(repo, "tmp/one.txt"), "one\n", "utf8");
    await fs.writeFile(path.join(repo, "tmp/nested/two.txt"), "two\n", "utf8");

    const changed = await changedFiles(repo);

    // Git collapses untracked directories by default: a job that wrote two
    // files would otherwise report a single `tmp/`, which is not reviewable.
    assert.deepEqual(changed.sort(), ["tmp/nested/two.txt", "tmp/one.txt"]);
  });

  it("includes files that were edited, not only new ones", async () => {
    await fs.writeFile(path.join(repo, "README.md"), "# Changed\n", "utf8");

    assert.ok((await changedFiles(repo)).includes("README.md"));
  });

  it("reports nothing for a clean checkout", async () => {
    const clean = path.join(directory, "clean");
    await fs.mkdir(clean, { recursive: true });
    await run("git", ["init", "-q", "-b", "main", "."], { cwd: clean });

    assert.deepEqual(await changedFiles(clean), []);
  });

  it("does not mistake a plain directory for a repository", async () => {
    assert.equal(await isRepository(directory), false);
    assert.equal(await isRepository(repo), true);
    assert.equal(await isRepository(path.join(directory, "nope")), false);
  });
});
